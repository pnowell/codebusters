/**
 * One-demand local utility to sync Firestore `/users/{uid}` profiles
 * (`uid`, `display_name`, `email`, `role`) into BigQuery
 * `codebusters_analytics.users` using BigQuery's free batch-load job API
 * (`WRITE_TRUNCATE` — $0.00 SKU, zero streaming-insert charges).
 *
 * Usage (from `app/`):
 *   npm run sync:users
 *   npm run sync:users -- --dry-run
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const DEFAULT_PROJECT_ID = 'codebusters-6599d';
const DATASET_ID = 'codebusters_analytics';
const USERS_TABLE_ID = 'users';

const isDryRun = process.argv.includes('--dry-run');

function resolveGcloudBinary() {
  const candidates = [
    '/Users/pnowell/homebrew/bin/gcloud',
    '/opt/homebrew/bin/gcloud',
    '/usr/local/bin/gcloud',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'gcloud';
}

function getLocalAccessToken() {
  const gcloudBin = resolveGcloudBinary();
  const out = execFileSync(gcloudBin, ['auth', 'print-access-token'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!out) {
    throw new Error(
      'Failed retrieving access token from `gcloud auth print-access-token`. Run `gcloud auth login` first.'
    );
  }
  return out;
}

function getProjectId() {
  const envProj = (process.env.GCLOUD_PROJECT ?? '').trim();
  if (envProj) return envProj;
  try {
    const gcloudBin = resolveGcloudBinary();
    const configured = execFileSync(
      gcloudBin,
      ['config', 'get-value', 'project', '--quiet'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (configured && configured !== '(unset)') {
      return configured;
    }
  } catch {
    // Fall back to default project ID
  }
  return DEFAULT_PROJECT_ID;
}

function readStringField(fieldsObj, key) {
  const v = fieldsObj?.[key]?.stringValue;
  return typeof v === 'string' ? v.trim() : '';
}

async function fetchFirestoreCollection(projectId, accessToken, collectionId) {
  const docs = [];
  let pageToken = '';

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        projectId
      )}/databases/(default)/documents/${encodeURIComponent(collectionId)}`
    );
    url.searchParams.set('pageSize', '300');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-goog-user-project': projectId,
      },
    });

    if (!res.ok) {
      throw new Error(
        `Failed listing Firestore /${collectionId} documents (HTTP ${res.status}).`
      );
    }

    const data = await res.json();
    docs.push(...(data.documents ?? []));
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);

  return docs;
}

async function fetchAllFirestoreUsers(projectId, accessToken) {
  const [profileDocs, userDocs] = await Promise.all([
    fetchFirestoreCollection(projectId, accessToken, 'profiles'),
    fetchFirestoreCollection(projectId, accessToken, 'users'),
  ]);

  const byUid = new Map();

  for (const doc of profileDocs) {
    const nameParts = String(doc.name ?? '').split('/');
    const uid = nameParts[nameParts.length - 1] ?? '';
    if (!uid) continue;

    byUid.set(uid, {
      uid,
      display_name: readStringField(doc.fields, 'displayName') || '',
      email: readStringField(doc.fields, 'email') || '',
      role: readStringField(doc.fields, 'role') || 'student',
    });
  }

  for (const doc of userDocs) {
    const nameParts = String(doc.name ?? '').split('/');
    const uid = nameParts[nameParts.length - 1] ?? '';
    if (!uid) continue;

    const existing = byUid.get(uid) ?? {
      uid,
      display_name: '',
      email: '',
      role: 'student',
    };
    const email = readStringField(doc.fields, 'email');
    const displayName = readStringField(doc.fields, 'displayName');
    const role = readStringField(doc.fields, 'role');

    byUid.set(uid, {
      uid,
      display_name: existing.display_name || displayName || uid,
      email: existing.email || email,
      role: existing.role || role || 'student',
    });
  }

  const users = Array.from(byUid.values()).map((u) => ({
    ...u,
    display_name: u.display_name || u.uid,
  }));

  users.sort((a, b) => a.display_name.localeCompare(b.display_name));
  return users;
}

async function batchLoadUsersToBigQuery(projectId, accessToken, rows) {
  const ndjson = `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
  const metadata = {
    configuration: {
      load: {
        destinationTable: {
          projectId,
          datasetId: DATASET_ID,
          tableId: USERS_TABLE_ID,
        },
        sourceFormat: 'NEWLINE_DELIMITED_JSON',
        writeDisposition: 'WRITE_TRUNCATE',
        createDisposition: 'CREATE_IF_NEEDED',
        schema: {
          fields: [
            { name: 'uid', type: 'STRING', mode: 'REQUIRED' },
            { name: 'display_name', type: 'STRING', mode: 'NULLABLE' },
            { name: 'email', type: 'STRING', mode: 'NULLABLE' },
            { name: 'role', type: 'STRING', mode: 'NULLABLE' },
          ],
        },
      },
    },
  };

  const boundary = `codebusters_bq_load_${Date.now()}`;
  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/octet-stream',
    '',
    ndjson,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const uploadUrl = `https://bigquery.googleapis.com/upload/bigquery/v2/projects/${encodeURIComponent(
    projectId
  )}/jobs?uploadType=multipart`;

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'x-goog-user-project': projectId,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!res.ok) {
    throw new Error(
      `BigQuery batch load job submission failed (HTTP ${res.status}).`
    );
  }

  let job = await res.json();
  const jobId = job?.jobReference?.jobId;
  const location = job?.jobReference?.location ?? 'US';

  for (let poll = 0; poll < 30 && job?.status?.state !== 'DONE'; poll += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const pollUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(
      projectId
    )}/jobs/${encodeURIComponent(jobId)}?location=${encodeURIComponent(
      location
    )}`;
    const pollRes = await fetch(pollUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-goog-user-project': projectId,
      },
    });
    if (!pollRes.ok) break;
    job = await pollRes.json();
  }

  if (job?.status?.errorResult) {
    throw new Error(
      `BigQuery load job failed: ${job.status.errorResult.message ?? 'Unknown error'}`
    );
  }
}

async function main() {
  const projectId = getProjectId();
  const accessToken = getLocalAccessToken();
  const users = await fetchAllFirestoreUsers(projectId, accessToken);

  if (users.length === 0) {
    console.log('[syncUsersToBigQuery] No /users documents found in Firestore.');
    return;
  }

  if (isDryRun) {
    console.log(
      `[syncUsersToBigQuery] [DRY RUN] Would sync ${users.length} user(s) to ${projectId}:${DATASET_ID}.${USERS_TABLE_ID}:`
    );
    for (const u of users) {
      console.log(`  - ${u.display_name} (${u.role}) [${u.uid}]`);
    }
    return;
  }

  await batchLoadUsersToBigQuery(projectId, accessToken, users);
  console.log(
    `[syncUsersToBigQuery] Synced ${users.length} user profile(s) to ${projectId}:${DATASET_ID}.${USERS_TABLE_ID}.`
  );
}

main().catch((err) => {
  console.error(
    `[syncUsersToBigQuery] Error: ${err instanceof Error ? err.message : 'Unexpected failure'}`
  );
  process.exit(1);
});
