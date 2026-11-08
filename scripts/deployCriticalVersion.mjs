#!/usr/bin/env node
/**
 * Post-Deploy Critical Version Synchronizer
 *
 * Reads `criticalVersion` from `app/package.json` and ensures Firestore
 * `/classroom_config/app_version` has at least that `criticalVersion` integer.
 *
 * Uses `Math.max(localCriticalVersion, remoteCriticalVersion)` so:
 *   - Initial deploy creates `/classroom_config/app_version` with `{ criticalVersion: 0 }`.
 *   - Bumping `"criticalVersion"` in `app/package.json` (e.g. `0` -> `1`) automatically
 *     raises `/classroom_config/app_version.criticalVersion` after GitHub Pages deploys,
 *     forcing all outdated clients to reload and cutting off stale Firestore access.
 *   - An emergency manual bump directly in the Firestore Web Console is never accidentally
 *     downgraded by an older `package.json` value.
 *
 * Security invariants:
 *   - Uses zero external npm dependencies (Node 22 built-in `node:crypto` + `fetch`).
 *   - Enforces strict HTTPS Google API endpoints and `project_id` format allow-listing.
 *   - Never logs service account keys, JWT assertions, or OAuth access tokens.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIR, '..');
const PKG_PATH = path.resolve(APP_ROOT, 'package.json');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{4,30}[a-z0-9]$/;
const MAX_CRITICAL_VERSION = 1_000_000;

const isDryRun = process.argv.includes('--dry-run');

function loadLocalCriticalVersion() {
  if (!PKG_PATH.startsWith(APP_ROOT + path.sep)) {
    throw new Error('Resolved package.json path escaped app root boundary.');
  }
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const val = pkg?.criticalVersion ?? 0;
  if (
    typeof val !== 'number' ||
    !Number.isSafeInteger(val) ||
    val < 0 ||
    val > MAX_CRITICAL_VERSION
  ) {
    throw new Error(
      `Invalid criticalVersion in package.json: ${String(val)}. Expected integer 0..${MAX_CRITICAL_VERSION}.`
    );
  }
  return val;
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

function appVersionDocUrl(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents/classroom_config/app_version`;
}

async function fetchRemoteCriticalVersion(projectId, accessToken) {
  const res = await fetch(appVersionDocUrl(projectId), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Failed to read /classroom_config/app_version (HTTP ${res.status}).`);
  }

  const doc = await res.json();
  const field = doc?.fields?.criticalVersion;
  if (typeof field?.integerValue === 'string' && /^\d+$/.test(field.integerValue)) {
    return Number.parseInt(field.integerValue, 10);
  }
  if (typeof field?.doubleValue === 'number' && Number.isFinite(field.doubleValue)) {
    return Math.max(0, Math.floor(field.doubleValue));
  }
  return null;
}

async function writeRemoteCriticalVersion(projectId, accessToken, criticalVersion) {
  const url = new URL(appVersionDocUrl(projectId));
  url.searchParams.append('updateMask.fieldPaths', 'criticalVersion');
  url.searchParams.append('updateMask.fieldPaths', 'updatedAt');

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        criticalVersion: { integerValue: String(criticalVersion) },
        updatedAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to update /classroom_config/app_version (HTTP ${res.status}).`);
  }
}

async function main() {
  const localVersion = loadLocalCriticalVersion();
  console.log(`[deployCriticalVersion] Loaded package.json criticalVersion=${localVersion}.`);

  const rawSecret = (process.env.FIREBASE_SERVICE_ACCOUNT ?? '').trim();
  if (!rawSecret) {
    console.warn(
      '::warning::FIREBASE_SERVICE_ACCOUNT secret is not set; skipping /classroom_config/app_version sync.'
    );
    return;
  }

  const creds = parseServiceAccount(rawSecret);
  const accessToken = await fetchAccessToken(creds);
  const remoteVersion = await fetchRemoteCriticalVersion(creds.projectId, accessToken);
  const targetVersion =
    remoteVersion !== null ? Math.max(localVersion, remoteVersion) : localVersion;

  if (remoteVersion !== null && remoteVersion === targetVersion) {
    console.log(
      `[deployCriticalVersion] /classroom_config/app_version already has criticalVersion=${remoteVersion}; skipping write.`
    );
    return;
  }

  if (isDryRun) {
    console.log(
      `[deployCriticalVersion] [DRY RUN] Would set /classroom_config/app_version criticalVersion=${targetVersion} (was ${String(
        remoteVersion
      )}).`
    );
    return;
  }

  await writeRemoteCriticalVersion(creds.projectId, accessToken, targetVersion);
  console.log(
    `[deployCriticalVersion] Set /classroom_config/app_version criticalVersion=${targetVersion} (was ${String(
      remoteVersion
    )}).`
  );
}

main().catch((err) => {
  console.error(
    `[deployCriticalVersion] Error: ${err instanceof Error ? err.message : 'Unexpected failure'}`
  );
  process.exit(1);
});
