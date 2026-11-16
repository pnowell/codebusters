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

async function ensureArtifactRegistryRepo(projectId, accessToken) {
  const repoId = 'codebusters-services';
  const repoUrl = `https://artifactregistry.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/locations/us-central1/repositories/${repoId}`;

  const getRes = await fetch(repoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (getRes.ok) {
    console.log(
      `[setupAnalyticsSink] Artifact Registry repository ${repoId} already exists.`
    );
    return;
  }
  if (getRes.status !== 404) {
    throw new Error(
      `Failed checking Artifact Registry repository ${repoId} (HTTP ${getRes.status}).`
    );
  }
  if (isDryRun) {
    console.log(
      `[setupAnalyticsSink] [DRY RUN] Would create Artifact Registry repository ${repoId}.`
    );
    return;
  }

  const createUrl = `https://artifactregistry.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/locations/us-central1/repositories?repositoryId=${repoId}`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      format: 'DOCKER',
      description: 'Container images for Codebusters Cloud Run event service',
      cleanupPolicies: {
        'keep-recent-2': {
          id: 'keep-recent-2',
          action: 'KEEP',
          mostRecentVersions: {
            keepCount: 2,
          },
        },
        'delete-older': {
          id: 'delete-older',
          action: 'DELETE',
          condition: {
            tagState: 'ANY',
            olderThan: '86400s',
          },
        },
      },
    }),
  });
  if (!createRes.ok) {
    throw new Error(
      `Failed creating Artifact Registry repository ${repoId} (HTTP ${createRes.status}).`
    );
  }

  let op = await createRes.json();
  for (
    let poll = 0;
    poll < 30 &&
    !op?.done &&
    typeof op?.name === 'string' &&
    /^projects\/[A-Za-z0-9._/-]+$/.test(op.name);
    poll += 1
  ) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(
      `https://artifactregistry.googleapis.com/v1/${op.name}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!pollRes.ok) break;
    op = await pollRes.json();
  }
  console.log(
    `[setupAnalyticsSink] Created Artifact Registry repository ${repoId}.`
  );
}

async function cleanupLegacyCloudFunctionStubs(projectId, accessToken) {
  for (const fnName of ['logPracticeEvents', 'onTestAttemptCompleted']) {
    const fnUrl = `https://cloudfunctions.googleapis.com/v2/projects/${encodeURIComponent(
      projectId
    )}/locations/us-central1/functions/${fnName}`;
    const getRes = await fetch(fnUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!getRes.ok || isDryRun) {
      continue;
    }
    console.log(
      `[setupAnalyticsSink] Removing legacy Cloud Function stub ${fnName}...`
    );
    const delRes = await fetch(fnUrl, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (delRes.ok) {
      let op = await delRes.json();
      for (
        let poll = 0;
        poll < 30 &&
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
  }
}

const JSON_PAYLOAD_FIELDS = [
  { name: 'logtype', type: 'STRING', mode: 'NULLABLE' },
  { name: 'eventtype', type: 'FLOAT', mode: 'NULLABLE' },
  { name: 'eventid', type: 'STRING', mode: 'NULLABLE' },
  { name: 'uid', type: 'STRING', mode: 'NULLABLE' },
  { name: 'clienttimestampms', type: 'FLOAT', mode: 'NULLABLE' },
  {
    name: 'drillsession',
    type: 'RECORD',
    mode: 'NULLABLE',
    fields: [
      { name: 'drillid', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'sessiondurationsec', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'sessionbest60sscore', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'totalanswered', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'totalcorrect', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'source', type: 'FLOAT', mode: 'NULLABLE' },
    ],
  },
  {
    name: 'cipherstarted',
    type: 'RECORD',
    mode: 'NULLABLE',
    fields: [
      { name: 'cipher', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'mode', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'quoteid', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'source', type: 'FLOAT', mode: 'NULLABLE' },
    ],
  },
  {
    name: 'ciphersolved',
    type: 'RECORD',
    mode: 'NULLABLE',
    fields: [
      { name: 'cipher', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'mode', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'quoteid', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'elapsedsec', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'alphacharcount', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'uniquealphacharcount', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'inputmode', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'errorcount', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'correctchars', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'scoretier', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'source', type: 'FLOAT', mode: 'NULLABLE' },
    ],
  },
  {
    name: 'practicetestquestionuser',
    type: 'RECORD',
    mode: 'NULLABLE',
    fields: [
      { name: 'attemptid', type: 'STRING', mode: 'NULLABLE' },
      { name: 'testid', type: 'STRING', mode: 'NULLABLE' },
      { name: 'questionnumber', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'cipher', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'mode', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'quoteid', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'iscollaborative', type: 'BOOLEAN', mode: 'NULLABLE' },
      { name: 'teamsize', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'totaltestelapsedsec', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'activescreentimesec', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'correctgradableinputs', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'totalgradableunits', type: 'FLOAT', mode: 'NULLABLE' },
    ],
  },
];

function buildPracticeEventsViewSql(projectId) {
  return `SELECT
  timestamp,
  TIMESTAMP_MILLIS(CAST(jsonPayload.clienttimestampms AS INT64)) AS client_timestamp,
  jsonPayload.eventid AS event_id,
  jsonPayload.uid AS uid,
  CASE CAST(jsonPayload.eventtype AS INT64)
    WHEN 1 THEN 'drill_session'
    WHEN 2 THEN 'cipher_started'
    WHEN 3 THEN 'cipher_solved'
    WHEN 4 THEN 'practice_test_question_user'
    ELSE 'unspecified'
  END AS event_type,
  CASE CAST(
    COALESCE(
      jsonPayload.drillsession.source,
      jsonPayload.cipherstarted.source,
      jsonPayload.ciphersolved.source
    ) AS INT64
  )
    WHEN 1 THEN 'standalone'
    WHEN 2 THEN 'general_practice'
    WHEN 3 THEN 'shared_link'
    ELSE NULL
  END AS source,
  CASE CAST(jsonPayload.drillsession.drillid AS INT64)
    WHEN 1 THEN 'offsetsLetterToNum'
    WHEN 2 THEN 'offsetsNumToLetter'
    WHEN 3 THEN 'letterMathEasy'
    WHEN 4 THEN 'letterMathHard'
    WHEN 5 THEN 'letterMathLetterEasy'
    WHEN 6 THEN 'letterMathLetterHard'
    WHEN 7 THEN 'atbash'
    WHEN 8 THEN 'pigpen'
    WHEN 9 THEN 'galactic'
    WHEN 10 THEN 'knights'
    WHEN 11 THEN 'tap'
    ELSE NULL
  END AS drill_id,
  jsonPayload.drillsession.sessiondurationsec AS session_duration_sec,
  CAST(jsonPayload.drillsession.sessionbest60sscore AS INT64) AS session_best_60s_score,
  CAST(jsonPayload.drillsession.totalanswered AS INT64) AS total_answered,
  CAST(jsonPayload.drillsession.totalcorrect AS INT64) AS total_correct,
  CASE CAST(
    COALESCE(
      jsonPayload.cipherstarted.cipher,
      jsonPayload.ciphersolved.cipher,
      jsonPayload.practicetestquestionuser.cipher
    ) AS INT64
  )
    WHEN 1 THEN 'atbash'
    WHEN 2 THEN 'pigpen'
    WHEN 3 THEN 'galactic'
    WHEN 4 THEN 'tap'
    WHEN 5 THEN 'knights'
    WHEN 6 THEN 'caesar'
    WHEN 7 THEN 'vigenere'
    WHEN 8 THEN 'aristocrat'
    ELSE NULL
  END AS cipher,
  CASE CAST(
    COALESCE(
      jsonPayload.cipherstarted.mode,
      jsonPayload.ciphersolved.mode,
      jsonPayload.practicetestquestionuser.mode
    ) AS INT64
  )
    WHEN 0 THEN ''
    WHEN 1 THEN 'pm3'
    WHEN 2 THEN 'any'
    WHEN 3 THEN 'easy'
    WHEN 4 THEN 'medium'
    WHEN 5 THEN 'hard'
    ELSE NULL
  END AS mode,
  CAST(
    COALESCE(
      jsonPayload.cipherstarted.quoteid,
      jsonPayload.ciphersolved.quoteid,
      jsonPayload.practicetestquestionuser.quoteid
    ) AS INT64
  ) AS quote_id,
  jsonPayload.ciphersolved.elapsedsec AS elapsed_sec,
  CAST(jsonPayload.ciphersolved.alphacharcount AS INT64) AS alpha_char_count,
  CAST(jsonPayload.ciphersolved.uniquealphacharcount AS INT64) AS unique_alpha_char_count,
  CASE CAST(jsonPayload.ciphersolved.inputmode AS INT64)
    WHEN 0 THEN 'standard'
    WHEN 1 THEN 'linked'
    WHEN 2 THEN 'paper'
    ELSE NULL
  END AS input_mode,
  CAST(jsonPayload.ciphersolved.errorcount AS INT64) AS error_count,
  CAST(jsonPayload.ciphersolved.correctchars AS INT64) AS correct_chars,
  CASE CAST(jsonPayload.ciphersolved.scoretier AS INT64)
    WHEN 1 THEN 'full'
    WHEN 2 THEN 'half'
    WHEN 3 THEN 'zero'
    ELSE NULL
  END AS score_tier,
  jsonPayload.practicetestquestionuser.attemptid AS attempt_id,
  jsonPayload.practicetestquestionuser.testid AS test_id,
  CAST(jsonPayload.practicetestquestionuser.questionnumber AS INT64) AS question_number,
  jsonPayload.practicetestquestionuser.iscollaborative AS is_collaborative,
  CAST(jsonPayload.practicetestquestionuser.teamsize AS INT64) AS team_size,
  jsonPayload.practicetestquestionuser.totaltestelapsedsec AS total_test_elapsed_sec,
  jsonPayload.practicetestquestionuser.activescreentimesec AS active_screen_time_sec,
  CAST(jsonPayload.practicetestquestionuser.correctgradableinputs AS INT64) AS correct_gradable_inputs,
  CAST(jsonPayload.practicetestquestionuser.totalgradableunits AS INT64) AS total_gradable_units
FROM \`${projectId}.${DATASET_ID}.run_googleapis_com_stdout\`
WHERE jsonPayload.logtype = 'codebusters_practice_event'`;
}

async function ensureStdoutTableAndView(projectId, accessToken) {
  const tablesBaseUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(
    projectId
  )}/datasets/${DATASET_ID}/tables`;
  const stdoutTableId = 'run_googleapis_com_stdout';
  const stdoutUrl = `${tablesBaseUrl}/${stdoutTableId}`;

  const getStdoutRes = await fetch(stdoutUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (getStdoutRes.status === 404) {
    if (!isDryRun) {
      const createRes = await fetch(tablesBaseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tableReference: {
            projectId,
            datasetId: DATASET_ID,
            tableId: stdoutTableId,
          },
          timePartitioning: {
            type: 'DAY',
            field: 'timestamp',
          },
          schema: {
            fields: [
              { name: 'logName', type: 'STRING', mode: 'NULLABLE' },
              { name: 'textPayload', type: 'STRING', mode: 'NULLABLE' },
              {
                name: 'jsonPayload',
                type: 'RECORD',
                mode: 'NULLABLE',
                fields: JSON_PAYLOAD_FIELDS,
              },
              { name: 'timestamp', type: 'TIMESTAMP', mode: 'NULLABLE' },
              { name: 'receiveTimestamp', type: 'TIMESTAMP', mode: 'NULLABLE' },
              { name: 'severity', type: 'STRING', mode: 'NULLABLE' },
              { name: 'insertId', type: 'STRING', mode: 'NULLABLE' },
            ],
          },
        }),
      });
      if (!createRes.ok) {
        throw new Error(
          `Failed pre-creating ${stdoutTableId} table (HTTP ${createRes.status}).`
        );
      }
      console.log(
        `[setupAnalyticsSink] Created partitioned BigQuery table ${stdoutTableId}.`
      );
    }
  } else if (getStdoutRes.ok && !isDryRun) {
    const existingTable = await getStdoutRes.json();
    const topFields = Array.isArray(existingTable?.schema?.fields)
      ? [...existingTable.schema.fields]
      : [];
    const jpIdx = topFields.findIndex((f) => f.name === 'jsonPayload');
    let patched = false;
    if (jpIdx >= 0) {
      const existingJpFields = Array.isArray(topFields[jpIdx].fields)
        ? [...topFields[jpIdx].fields]
        : [];
      const existingNames = new Set(existingJpFields.map((f) => f.name));
      for (const reqField of JSON_PAYLOAD_FIELDS) {
        if (!existingNames.has(reqField.name)) {
          existingJpFields.push(reqField);
          patched = true;
        }
      }
      if (patched) {
        topFields[jpIdx] = { ...topFields[jpIdx], fields: existingJpFields };
        const patchRes = await fetch(stdoutUrl, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ schema: { fields: topFields } }),
        });
        if (!patchRes.ok) {
          throw new Error(
            `Failed patching missing jsonPayload fields on ${stdoutTableId} (HTTP ${patchRes.status}).`
          );
        }
        console.log(
          `[setupAnalyticsSink] Added missing jsonPayload sub-fields on ${stdoutTableId}.`
        );
      }
    }
  } else if (!getStdoutRes.ok) {
    throw new Error(
      `Failed inspecting ${stdoutTableId} table (HTTP ${getStdoutRes.status}).`
    );
  }

  // Provision or update the human-readable `practice_events` View
  const viewId = 'practice_events';
  const viewUrl = `${tablesBaseUrl}/${viewId}`;
  const viewQuery = buildPracticeEventsViewSql(projectId);

  if (isDryRun) {
    console.log(
      `[setupAnalyticsSink] [DRY RUN] Would ensure BigQuery view ${DATASET_ID}.${viewId}.`
    );
    return;
  }

  const getViewRes = await fetch(viewUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (getViewRes.status === 404) {
    const createViewRes = await fetch(tablesBaseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tableReference: {
          projectId,
          datasetId: DATASET_ID,
          tableId: viewId,
        },
        description:
          'Flattened, human-readable view decoding compact Protobuf integer enums from run_googleapis_com_stdout',
        view: {
          query: viewQuery,
          useLegacySql: false,
        },
      }),
    });
    if (!createViewRes.ok) {
      throw new Error(
        `Failed creating BigQuery view ${viewId} (HTTP ${createViewRes.status}).`
      );
    }
    console.log(
      `[setupAnalyticsSink] Created BigQuery view ${DATASET_ID}.${viewId}.`
    );
  } else if (getViewRes.ok) {
    const existingView = await getViewRes.json();
    if (existingView?.view?.query !== viewQuery) {
      const patchViewRes = await fetch(viewUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          view: {
            query: viewQuery,
            useLegacySql: false,
          },
        }),
      });
      if (!patchViewRes.ok) {
        throw new Error(
          `Failed updating BigQuery view ${viewId} (HTTP ${patchViewRes.status}).`
        );
      }
      console.log(
        `[setupAnalyticsSink] Updated BigQuery view ${DATASET_ID}.${viewId}.`
      );
    } else {
      console.log(
        `[setupAnalyticsSink] BigQuery view ${DATASET_ID}.${viewId} is already up to date.`
      );
    }
  } else {
    throw new Error(
      `Failed checking BigQuery view ${viewId} (HTTP ${getViewRes.status}).`
    );
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
  await ensureStdoutTableAndView(creds.projectId, accessToken);
  await ensureArtifactRegistryRepo(creds.projectId, accessToken);
  await cleanupLegacyCloudFunctionStubs(creds.projectId, accessToken);
}

main().catch((err) => {
  console.error(
    `[setupAnalyticsSink] Error: ${err instanceof Error ? err.message : 'Unexpected failure'}`
  );
  process.exit(1);
});
