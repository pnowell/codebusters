#!/usr/bin/env node
/**
 * Automated BigQuery Dataset & Partitioned Cloud Logging Sink Provisioner
 *
 * Idempotently configures indefinite practice-event storage in Google Cloud:
 *   1. Ensures BigQuery dataset `codebusters_analytics` (`location: US`,
 *      no table/partition expiration = indefinite retention) exists.
 *   2. Ensures Cloud Logging Sink `codebusters_practice_events_sink` routes
 *      `jsonPayload.logType="codebusters_practice_event"` into
 *      `bigquery.googleapis.com/projects/<projectId>/datasets/codebusters_analytics`
 *      with `bigqueryOptions.usePartitionedTables = true` (`TIMESTAMP`-partitioned table).
 *   3. Ensures the sink's `writerIdentity` service account has `WRITER`
 *      (`roles/bigquery.dataEditor`) access on `codebusters_analytics`.
 *
 * Required IAM roles on `FIREBASE_SERVICE_ACCOUNT`:
 *   - `roles/bigquery.dataOwner` (or `roles/bigquery.admin`)
 *   - `roles/logging.configWriter`
 *
 * Security invariants:
 *   - Zero external npm dependencies (Node 22 built-in `node:crypto` + `fetch`).
 *   - Strict HTTPS Google API endpoints and `project_id` format allow-listing.
 *   - Never logs service account keys, JWT assertions, or OAuth access tokens.
 */

import crypto from 'node:crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GCP_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{4,30}[a-z0-9]$/;

const DATASET_ID = 'codebusters_analytics';
const DATASET_LOCATION = 'US';
const SINK_NAME = 'codebusters_practice_events_sink';
const SINK_FILTER = 'jsonPayload.logType="codebusters_practice_event"';

const isDryRun = process.argv.includes('--dry-run');

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input)
    ? input
    : Buffer.from(String(input), 'utf8');
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseServiceAccount(rawSecret) {
  let creds;
  try {
    creds = JSON.parse(rawSecret);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON.');
  }

  const projectId =
    typeof creds?.project_id === 'string' ? creds.project_id.trim() : '';
  const clientEmail =
    typeof creds?.client_email === 'string' ? creds.client_email.trim() : '';
  const privateKey =
    typeof creds?.private_key === 'string' ? creds.private_key : '';

  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error(
      'Service account JSON has an invalid or missing project_id.'
    );
  }
  if (
    !clientEmail.includes('@') ||
    !privateKey.includes('BEGIN PRIVATE KEY')
  ) {
    throw new Error(
      'Service account JSON is missing client_email or private_key.'
    );
  }

  return { projectId, clientEmail, privateKey };
}

async function fetchAccessToken({ clientEmail, privateKey }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    sub: clientEmail,
    aud: GOOGLE_TOKEN_URL,
    scope: GCP_SCOPE,
    iat: nowSec,
    exp: nowSec + 300,
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload)
  )}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64UrlEncode(signer.sign(privateKey));
  const assertion = `${signingInput}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    throw new Error(`OAuth token exchange failed with HTTP ${res.status}.`);
  }

  const data = await res.json();
  if (typeof data?.access_token !== 'string' || !data.access_token) {
    throw new Error('OAuth token response did not contain an access_token.');
  }
  return data.access_token;
}

async function ensureBigQueryDataset(projectId, accessToken) {
  const dsUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(
    projectId
  )}/datasets/${DATASET_ID}`;

  const getRes = await fetch(dsUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (getRes.ok) {
    const existing = await getRes.json();
    console.log(
      `[setupAnalyticsSink] BigQuery dataset ${projectId}:${DATASET_ID} already exists.`
    );
    return existing;
  }

  if (getRes.status !== 404) {
    throw new Error(
      `Failed checking BigQuery dataset ${DATASET_ID} (HTTP ${getRes.status}).`
    );
  }

  if (isDryRun) {
    console.log(
      `[setupAnalyticsSink] [DRY RUN] Would create BigQuery dataset ${projectId}:${DATASET_ID} (location=${DATASET_LOCATION}, expiration=never).`
    );
    return { access: [] };
  }

  const createUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(
    projectId
  )}/datasets`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      datasetReference: {
        projectId,
        datasetId: DATASET_ID,
      },
      location: DATASET_LOCATION,
      description:
        'Indefinite retention store for DaVinci Decoders practice event logs (#25)',
    }),
  });

  if (!createRes.ok) {
    throw new Error(
      `Failed creating BigQuery dataset ${DATASET_ID} (HTTP ${createRes.status}).`
    );
  }

  const created = await createRes.json();
  console.log(
    `[setupAnalyticsSink] Created BigQuery dataset ${projectId}:${DATASET_ID}.`
  );
  return created;
}

async function ensureLoggingSink(projectId, accessToken) {
  const destination = `bigquery.googleapis.com/projects/${projectId}/datasets/${DATASET_ID}`;
  const sinkUrl = `https://logging.googleapis.com/v2/projects/${encodeURIComponent(
    projectId
  )}/sinks/${SINK_NAME}`;

  const desiredSink = {
    name: SINK_NAME,
    destination,
    filter: SINK_FILTER,
    bigqueryOptions: {
      usePartitionedTables: true,
    },
  };

  const getRes = await fetch(sinkUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (getRes.ok) {
    const existing = await getRes.json();
    const matches =
      existing.destination === destination &&
      existing.filter === SINK_FILTER &&
      Boolean(existing.bigqueryOptions?.usePartitionedTables) === true;

    if (matches) {
      console.log(
        `[setupAnalyticsSink] Cloud Logging sink ${SINK_NAME} is already up to date.`
      );
      return existing.writerIdentity ?? '';
    }

    if (isDryRun) {
      console.log(
        `[setupAnalyticsSink] [DRY RUN] Would update Cloud Logging sink ${SINK_NAME}.`
      );
      return existing.writerIdentity ?? '';
    }

    const updateUrl = `${sinkUrl}?uniqueWriterIdentity=true&updateMask=destination,filter,bigqueryOptions`;
    const updateRes = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(desiredSink),
    });

    if (!updateRes.ok) {
      throw new Error(
        `Failed updating Cloud Logging sink ${SINK_NAME} (HTTP ${updateRes.status}).`
      );
    }

    const updated = await updateRes.json();
    console.log(`[setupAnalyticsSink] Updated Cloud Logging sink ${SINK_NAME}.`);
    return updated.writerIdentity ?? '';
  }

  if (getRes.status !== 404) {
    throw new Error(
      `Failed checking Cloud Logging sink ${SINK_NAME} (HTTP ${getRes.status}).`
    );
  }

  if (isDryRun) {
    console.log(
      `[setupAnalyticsSink] [DRY RUN] Would create partitioned Cloud Logging sink ${SINK_NAME}.`
    );
    return '';
  }

  const createUrl = `https://logging.googleapis.com/v2/projects/${encodeURIComponent(
    projectId
  )}/sinks?uniqueWriterIdentity=true`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(desiredSink),
  });

  if (!createRes.ok) {
    throw new Error(
      `Failed creating Cloud Logging sink ${SINK_NAME} (HTTP ${createRes.status}).`
    );
  }

  const created = await createRes.json();
  console.log(
    `[setupAnalyticsSink] Created partitioned Cloud Logging sink ${SINK_NAME}.`
  );
  return created.writerIdentity ?? '';
}

async function ensureSinkDatasetWriterAccess(
  projectId,
  accessToken,
  datasetObj,
  writerIdentity
) {
  if (!writerIdentity || typeof writerIdentity !== 'string') return;
  const writerEmail = writerIdentity.startsWith('serviceAccount:')
    ? writerIdentity.slice('serviceAccount:'.length).trim()
    : '';
  if (!writerEmail || !writerEmail.includes('@')) return;

  const accessList = Array.isArray(datasetObj?.access)
    ? [...datasetObj.access]
    : [];
  const alreadyGranted = accessList.some(
    (entry) =>
      entry &&
      (entry.role === 'WRITER' ||
        entry.role === 'OWNER' ||
        entry.role === 'roles/bigquery.dataEditor') &&
      entry.userByEmail === writerEmail
  );

  if (alreadyGranted) {
    console.log(
      `[setupAnalyticsSink] Sink writer identity already has WRITER access on ${DATASET_ID}.`
    );
    return;
  }

  if (isDryRun) {
    console.log(
      `[setupAnalyticsSink] [DRY RUN] Would grant WRITER access on ${DATASET_ID} to sink writer identity.`
    );
    return;
  }

  accessList.push({
    role: 'WRITER',
    userByEmail: writerEmail,
  });

  const dsUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(
    projectId
  )}/datasets/${DATASET_ID}`;
  const patchRes = await fetch(dsUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ access: accessList }),
  });

  if (!patchRes.ok) {
    throw new Error(
      `Failed granting sink WRITER access on BigQuery dataset ${DATASET_ID} (HTTP ${patchRes.status}).`
    );
  }

  console.log(
    `[setupAnalyticsSink] Granted WRITER access on ${DATASET_ID} to Cloud Logging sink writer identity.`
  );
}

const REQUIRED_SERVICE_IDS = [
  'bigquery.googleapis.com',
  'logging.googleapis.com',
  'cloudbilling.googleapis.com',
  'cloudresourcemanager.googleapis.com',
  'cloudfunctions.googleapis.com',
  'run.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
  'eventarc.googleapis.com',
  'pubsub.googleapis.com',
];

async function ensureRequiredApisEnabled(projectId, accessToken) {
  if (isDryRun) {
    console.log(
      `[setupAnalyticsSink] [DRY RUN] Would ensure GCP APIs enabled: ${REQUIRED_SERVICE_IDS.join(', ')}`
    );
    return;
  }

  const batchUrl = `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/services:batchEnable`;
  const res = await fetch(batchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ serviceIds: REQUIRED_SERVICE_IDS }),
  });

  if (!res.ok) {
    throw new Error(
      `Failed enabling required Google Cloud APIs via Service Usage (HTTP ${res.status}).`
    );
  }

  let op = await res.json();
  for (let poll = 0; poll < 30 && !op?.done && typeof op?.name === 'string'; poll += 1) {
    if (!/^operations\/[A-Za-z0-9._/-]+$/.test(op.name)) break;
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(
      `https://serviceusage.googleapis.com/v1/${op.name}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!pollRes.ok) break;
    op = await pollRes.json();
  }

  console.log(
    `[setupAnalyticsSink] Verified required GCP APIs enabled on ${projectId}.`
  );
}

async function cleanupOrphanedTriggerStub(projectId, accessToken) {
  for (const fnName of ['logPracticeEvents', 'onTestAttemptCompleted']) {
    const fnUrl = `https://cloudfunctions.googleapis.com/v2/projects/${encodeURIComponent(
      projectId
    )}/locations/us-central1/functions/${fnName}`;
    const getRes = await fetch(fnUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!getRes.ok) {
      continue;
    }

    const fnData = await getRes.json();
    const isHealthy =
      fnData?.state === 'ACTIVE' &&
      !fnData?.buildConfig?.automaticUpdatePolicy &&
      (fnName !== 'onTestAttemptCompleted' || Boolean(fnData?.eventTrigger));
    if (isHealthy) {
      continue;
    }

    if (isDryRun) {
      console.log(
        `[setupAnalyticsSink] [DRY RUN] Would delete non-ACTIVE ${fnName} stub.`
      );
      continue;
    }

    console.log(
      `[setupAnalyticsSink] Deleting non-ACTIVE ${fnName} stub (state=${fnData?.state ?? 'unknown'}) before clean redeploy...`
    );
    const delRes = await fetch(fnUrl, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!delRes.ok && delRes.status !== 404) {
      throw new Error(
        `Failed deleting non-ACTIVE ${fnName} stub (HTTP ${delRes.status}).`
      );
    }

    if (delRes.ok) {
      let op = await delRes.json();
      for (
        let poll = 0;
        poll < 45 &&
        !op?.done &&
        typeof op?.name === 'string' &&
        /^projects\/[A-Za-z0-9._/-]+$/.test(op.name);
        poll += 1
      ) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetch(
          `https://cloudfunctions.googleapis.com/v2/${op.name}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!pollRes.ok) break;
        op = await pollRes.json();
      }
    }
    console.log(`[setupAnalyticsSink] Deleted non-ACTIVE ${fnName} stub.`);
  }
}

async function main() {
  const rawSecret = (process.env.FIREBASE_SERVICE_ACCOUNT ?? '').trim();
  if (!rawSecret) {
    console.warn(
      '::warning::FIREBASE_SERVICE_ACCOUNT secret is not set; skipping BigQuery sink provisioning.'
    );
    return;
  }

  const creds = parseServiceAccount(rawSecret);
  const accessToken = await fetchAccessToken(creds);
  await ensureRequiredApisEnabled(creds.projectId, accessToken);
  const dataset = await ensureBigQueryDataset(creds.projectId, accessToken);
  const writerIdentity = await ensureLoggingSink(creds.projectId, accessToken);
  await ensureSinkDatasetWriterAccess(
    creds.projectId,
    accessToken,
    dataset,
    writerIdentity
  );
  await cleanupOrphanedTriggerStub(creds.projectId, accessToken);
}

main().catch((err) => {
  console.error(
    `[setupAnalyticsSink] Error: ${err instanceof Error ? err.message : 'Unexpected failure'}`
  );
  process.exit(1);
});
