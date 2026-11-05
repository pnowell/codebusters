#!/usr/bin/env node
/**
 * Post-Deploy Orphaned Quote Flags Pruner
 *
 * Compares Firestore `/quote_flags/{quoteId}` documents against `src/data/quotes.json`
 * and deletes any flag documents whose quote ID was removed from the database.
 *
 * Designed to run in GitHub Actions immediately after `actions/deploy-pages` succeeds,
 * using a Google Cloud / Firebase service account JSON stored in the
 * `FIREBASE_SERVICE_ACCOUNT` environment variable (requires `Cloud Datastore User` role).
 *
 * Security invariants:
 *   - Uses zero external npm dependencies (Node 22 built-in `node:crypto` + `fetch`).
 *   - Enforces strict HTTPS Google API endpoints and projectId format allow-listing.
 *   - Never logs service account keys, JWT assertions, or OAuth access tokens.
 *   - Resolves `quotes.json` with strict directory-boundary verification.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIR, '..');
const QUOTES_PATH = path.resolve(APP_ROOT, 'src', 'data', 'quotes.json');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{4,30}[a-z0-9]$/;
const COMMIT_BATCH_SIZE = 400;

const isDryRun = process.argv.includes('--dry-run');

function loadValidQuoteIds() {
  if (!QUOTES_PATH.startsWith(APP_ROOT + path.sep)) {
    throw new Error('Resolved quotes.json path escaped app root boundary.');
  }
  const raw = fs.readFileSync(QUOTES_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('quotes.json did not parse as an array.');
  }
  const ids = new Set();
  for (const item of parsed) {
    if (item && typeof item.id === 'number' && Number.isInteger(item.id) && item.id >= 0) {
      ids.add(item.id);
    }
  }
  if (ids.size === 0) {
    throw new Error('Refusing to prune against an empty quotes.json ID set.');
  }
  return ids;
}

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
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

  const projectId = typeof creds?.project_id === 'string' ? creds.project_id.trim() : '';
  const clientEmail = typeof creds?.client_email === 'string' ? creds.client_email.trim() : '';
  const privateKey = typeof creds?.private_key === 'string' ? creds.private_key : '';

  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error('Service account JSON has an invalid or missing project_id.');
  }
  if (!clientEmail.includes('@') || !privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new Error('Service account JSON is missing client_email or private_key.');
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
  if (typeof data?.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('OAuth token response did not contain an access_token.');
  }
  return data.access_token;
}

async function listQuoteFlagDocs(projectId, accessToken) {
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents/quote_flags`;

  const docs = [];
  let pageToken = '';

  do {
    const url = new URL(baseUrl);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to list quote_flags (HTTP ${res.status}).`);
    }

    const data = await res.json();
    if (Array.isArray(data?.documents)) {
      docs.push(...data.documents);
    }
    pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : '';
  } while (pageToken);

  return docs;
}

function extractQuoteId(docEntry) {
  const intVal = docEntry?.fields?.quoteId?.integerValue;
  if (typeof intVal === 'string' && /^\d+$/.test(intVal)) {
    return Number.parseInt(intVal, 10);
  }
  const docName = typeof docEntry?.name === 'string' ? docEntry.name : '';
  const tail = docName.split('/').pop() ?? '';
  if (/^\d+$/.test(tail)) {
    return Number.parseInt(tail, 10);
  }
  return null;
}

async function batchDeleteDocs(projectId, accessToken, docNames) {
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents:commit`;

  for (let i = 0; i < docNames.length; i += COMMIT_BATCH_SIZE) {
    const chunk = docNames.slice(i, i + COMMIT_BATCH_SIZE);
    const res = await fetch(commitUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        writes: chunk.map((name) => ({ delete: name })),
      }),
    });

    if (!res.ok) {
      throw new Error(`Firestore batch delete failed with HTTP ${res.status}.`);
    }
  }
}

async function main() {
  const validQuoteIds = loadValidQuoteIds();
  console.log(`[pruneOrphanedQuoteFlags] Loaded ${validQuoteIds.size} valid quote IDs from quotes.json.`);

  const rawSecret = (process.env.FIREBASE_SERVICE_ACCOUNT ?? '').trim();
  if (!rawSecret) {
    console.warn(
      '::warning::FIREBASE_SERVICE_ACCOUNT secret is not set; skipping post-deploy quote_flags cleanup.'
    );
    return;
  }

  const creds = parseServiceAccount(rawSecret);
  const accessToken = await fetchAccessToken(creds);
  const flagDocs = await listQuoteFlagDocs(creds.projectId, accessToken);

  const orphanedDocNames = [];
  const orphanedIds = [];

  for (const docEntry of flagDocs) {
    if (typeof docEntry?.name !== 'string') continue;
    const qid = extractQuoteId(docEntry);
    if (qid === null || !validQuoteIds.has(qid)) {
      orphanedDocNames.push(docEntry.name);
      orphanedIds.push(qid ?? docEntry.name.split('/').pop());
    }
  }

  if (orphanedDocNames.length === 0) {
    console.log(
      `[pruneOrphanedQuoteFlags] Checked ${flagDocs.length} flag(s); 0 orphaned flags found.`
    );
    return;
  }

  if (isDryRun) {
    console.log(
      `[pruneOrphanedQuoteFlags] [DRY RUN] Would delete ${orphanedDocNames.length} orphaned flag(s): ${orphanedIds.join(', ')}`
    );
    return;
  }

  await batchDeleteDocs(creds.projectId, accessToken, orphanedDocNames);
  console.log(
    `[pruneOrphanedQuoteFlags] Deleted ${orphanedDocNames.length} orphaned flag(s) (of ${flagDocs.length} total): ${orphanedIds.join(', ')}`
  );
}

main().catch((err) => {
  console.error(
    `[pruneOrphanedQuoteFlags] Error: ${err instanceof Error ? err.message : 'Unexpected failure'}`
  );
  process.exit(1);
});
