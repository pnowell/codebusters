#!/usr/bin/env node
/**
 * Legacy `drillHistory.*.recentSessions` Firestore Cleanup Script
 *
 * Scans `/users/*` documents after `criticalVersion >= 1` is deployed:
 *   - For any drill entry in `drillHistory` that still contains a legacy
 *     `recentSessions` array, computes `ema60s` from `recentSessions` (if
 *     `ema60s` is not already present) and removes `recentSessions`.
 *
 * Security invariants:
 *   - Zero external npm dependencies (Node 22 built-in `node:crypto` + `fetch`).
 *   - Enforces strict HTTPS Google API endpoints and `project_id` format allow-listing.
 *   - Never logs service account keys, JWT assertions, or OAuth access tokens.
 */

import crypto from 'node:crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{4,30}[a-z0-9]$/;
const COMMIT_BATCH_SIZE = 200;

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
    scope: FIRESTORE_SCOPE,
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

function readNumericFirestoreValue(valObj) {
  if (!valObj || typeof valObj !== 'object') return null;
  if (typeof valObj.doubleValue === 'number' && Number.isFinite(valObj.doubleValue)) {
    return valObj.doubleValue;
  }
  if (typeof valObj.integerValue === 'string') {
    const parsed = Number(valObj.integerValue);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function buildCleanedDrillHistoryField(rawDrillHistoryField) {
  const fields = rawDrillHistoryField?.mapValue?.fields;
  if (!fields || typeof fields !== 'object') return null;

  let mutated = false;
  const cleanedFields = {};

  for (const [drillId, entryVal] of Object.entries(fields)) {
    const entryFields = entryVal?.mapValue?.fields;
    if (!entryFields || typeof entryFields !== 'object') {
      cleanedFields[drillId] = entryVal;
      continue;
    }

    if (!('recentSessions' in entryFields)) {
      cleanedFields[drillId] = entryVal;
      continue;
    }

    mutated = true;
    let ema60s = readNumericFirestoreValue(entryFields.ema60s);
    let lastPracticed = readNumericFirestoreValue(entryFields.lastPracticed) ?? 0;

    const arrValues = entryFields.recentSessions?.arrayValue?.values;
    if (Array.isArray(arrValues)) {
      const scores = [];
      for (const item of arrValues) {
        const itemFields = item?.mapValue?.fields;
        const score = readNumericFirestoreValue(itemFields?.score60s);
        const ts = readNumericFirestoreValue(itemFields?.timestamp);
        if (score !== null && score >= 0) {
          scores.push(score);
        }
        if (ts !== null && ts > lastPracticed) {
          lastPracticed = Math.round(ts);
        }
      }
      if ((ema60s === null || ema60s <= 0) && scores.length > 0) {
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (mean > 0) {
          ema60s = Math.round(mean * 10) / 10;
        }
      }
    }

    const nextEntryFields = { ...entryFields };
    delete nextEntryFields.recentSessions;
    if (ema60s !== null && ema60s > 0) {
      nextEntryFields.ema60s = { doubleValue: ema60s };
    }
    nextEntryFields.lastPracticed = {
      integerValue: String(Math.max(0, Math.round(lastPracticed))),
    };

    cleanedFields[drillId] = {
      mapValue: {
        fields: nextEntryFields,
      },
    };
  }

  if (!mutated) return null;
  return {
    mapValue: {
      fields: cleanedFields,
    },
  };
}

async function listUserDocs(projectId, accessToken) {
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents/users`;

  const docs = [];
  let pageToken = '';

  do {
    const url = new URL(baseUrl);
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to list users (HTTP ${res.status}).`);
    }

    const data = await res.json();
    if (Array.isArray(data?.documents)) {
      docs.push(...data.documents);
    }
    pageToken =
      typeof data?.nextPageToken === 'string' ? data.nextPageToken : '';
  } while (pageToken);

  return docs;
}

async function commitDrillHistoryUpdates(projectId, accessToken, updates) {
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents:commit`;

  for (let i = 0; i < updates.length; i += COMMIT_BATCH_SIZE) {
    const chunk = updates.slice(i, i + COMMIT_BATCH_SIZE);
    const writes = chunk.map(({ docName, cleanedDrillHistory }) => ({
      update: {
        name: docName,
        fields: {
          drillHistory: cleanedDrillHistory,
        },
      },
      updateMask: {
        fieldPaths: ['drillHistory'],
      },
    }));

    const res = await fetch(commitUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ writes }),
    });

    if (!res.ok) {
      throw new Error(
        `Firestore batch drillHistory cleanup failed with HTTP ${res.status}.`
      );
    }
  }
}

async function main() {
  const rawSecret = (process.env.FIREBASE_SERVICE_ACCOUNT ?? '').trim();
  if (!rawSecret) {
    console.warn(
      '::warning::FIREBASE_SERVICE_ACCOUNT secret is not set; skipping recentSessions cleanup.'
    );
    return;
  }

  const creds = parseServiceAccount(rawSecret);
  const accessToken = await fetchAccessToken(creds);
  const userDocs = await listUserDocs(creds.projectId, accessToken);

  const pendingUpdates = [];
  for (const docEntry of userDocs) {
    if (typeof docEntry?.name !== 'string') continue;
    const cleaned = buildCleanedDrillHistoryField(
      docEntry.fields?.drillHistory
    );
    if (cleaned) {
      pendingUpdates.push({
        docName: docEntry.name,
        cleanedDrillHistory: cleaned,
      });
    }
  }

  if (pendingUpdates.length === 0) {
    console.log(
      `[pruneDrillRecentSessions] Checked ${userDocs.length} user document(s); 0 legacy recentSessions arrays found.`
    );
    return;
  }

  if (isDryRun) {
    console.log(
      `[pruneDrillRecentSessions] [DRY RUN] Would migrate & remove legacy recentSessions on ${pendingUpdates.length} user document(s).`
    );
    return;
  }

  await commitDrillHistoryUpdates(creds.projectId, accessToken, pendingUpdates);
  console.log(
    `[pruneDrillRecentSessions] Migrated & removed legacy recentSessions on ${pendingUpdates.length} of ${userDocs.length} user document(s).`
  );
}

main().catch((err) => {
  console.error(
    `[pruneDrillRecentSessions] Error: ${err instanceof Error ? err.message : 'Unexpected failure'}`
  );
  process.exit(1);
});
