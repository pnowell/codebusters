#!/usr/bin/env node
/**
 * Automated Firestore Security Rules Deployer
 *
 * Compiles, validates, and deploys `app/firestore.rules` to the default
 * Cloud Firestore release (`cloud.firestore`) via the Firebase Rules REST API v1.
 *
 * Designed to run in GitHub Actions (`deploy.yml`) using a Google Cloud / Firebase
 * service account JSON in `FIREBASE_SERVICE_ACCOUNT` (requires the
 * `Firebase Rules Admin` IAM role: `roles/firebaserules.admin`).
 *
 * Behavior:
 *   1. Reads and validates `firestore.rules` inside the app root boundary.
 *   2. Checks the currently active `cloud.firestore` release; if its ruleset
 *      content already matches `firestore.rules` byte-for-byte, exits 0 without
 *      creating a duplicate ruleset.
 *   3. Validates syntax/semantics via `projects:test` before touching live rules.
 *   4. Creates a new `Ruleset` and updates (or creates) `releases/cloud.firestore`.
 *
 * Security invariants:
 *   - Uses zero external npm dependencies (Node 22 built-in `node:crypto` + `fetch`).
 *   - Enforces strict HTTPS Google API endpoints and `project_id` / `rulesetName` allow-lists.
 *   - Never logs service account credentials, JWT assertions, or OAuth access tokens.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIR, '..');
const RULES_PATH = path.resolve(APP_ROOT, 'firestore.rules');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIREBASE_RULES_BASE_URL = 'https://firebaserules.googleapis.com/v1';
const FIREBASE_RULES_SCOPE =
  'https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform';

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{4,30}[a-z0-9]$/;
const RULESET_NAME_PATTERN = /^projects\/[a-z0-9-]+\/rulesets\/[a-zA-Z0-9_-]+$/;
const FIRESTORE_RELEASE_ID = 'cloud.firestore';

const isDryRun = process.argv.includes('--dry-run');

function loadLocalRules() {
  if (!RULES_PATH.startsWith(APP_ROOT + path.sep)) {
    throw new Error('Resolved firestore.rules path escaped app root boundary.');
  }
  const content = fs.readFileSync(RULES_PATH, 'utf8');
  if (!content.trim() || !content.includes('cloud.firestore')) {
    throw new Error('firestore.rules appears empty or missing cloud.firestore service block.');
  }
  return content;
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
    scope: FIREBASE_RULES_SCOPE,
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

function formatPermissionHint(status, stepLabel) {
  if (status === 403) {
    return `${stepLabel} failed with HTTP 403 (Permission Denied). Grant the "Firebase Rules Admin" role (roles/firebaserules.admin) to the FIREBASE_SERVICE_ACCOUNT in Google Cloud IAM.`;
  }
  return `${stepLabel} failed with HTTP ${status}.`;
}

async function getCurrentReleaseState(projectId, accessToken) {
  const releaseUrl = `${FIREBASE_RULES_BASE_URL}/projects/${encodeURIComponent(
    projectId
  )}/releases/${FIRESTORE_RELEASE_ID}`;

  const res = await fetch(releaseUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 404) {
    return { exists: false, rulesetName: null, content: null };
  }
  if (!res.ok) {
    throw new Error(formatPermissionHint(res.status, 'Fetching current cloud.firestore release'));
  }

  const releaseData = await res.json();
  const rulesetName =
    typeof releaseData?.rulesetName === 'string' ? releaseData.rulesetName : '';
  if (!RULESET_NAME_PATTERN.test(rulesetName)) {
    return { exists: true, rulesetName: null, content: null };
  }

  const rulesetRes = await fetch(`${FIREBASE_RULES_BASE_URL}/${rulesetName}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!rulesetRes.ok) {
    return { exists: true, rulesetName, content: null };
  }

  const rulesetData = await rulesetRes.json();
  const files = Array.isArray(rulesetData?.source?.files) ? rulesetData.source.files : [];
  const activeContent = typeof files[0]?.content === 'string' ? files[0].content : null;

  return { exists: true, rulesetName, content: activeContent };
}

async function validateRulesSyntax(projectId, accessToken, rulesContent) {
  const testUrl = `${FIREBASE_RULES_BASE_URL}/projects/${encodeURIComponent(projectId)}:test`;
  const res = await fetch(testUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: {
        files: [{ name: 'firestore.rules', content: rulesContent }],
      },
      testSuite: { testCases: [] },
    }),
  });

  if (!res.ok) {
    throw new Error(formatPermissionHint(res.status, 'Validating firestore.rules syntax'));
  }

  const data = await res.json();
  const issues = Array.isArray(data?.issues) ? data.issues : [];
  const errors = [];

  for (const issue of issues) {
    const severity = typeof issue?.severity === 'string' ? issue.severity : 'INFO';
    const line = issue?.sourcePosition?.line ?? '?';
    const col = issue?.sourcePosition?.column ?? '?';
    const desc = typeof issue?.description === 'string' ? issue.description : 'Unknown issue';
    const formatted = `firestore.rules:${line}:${col} [${severity}] ${desc}`;
    if (severity === 'ERROR') {
      errors.push(formatted);
    } else {
      console.warn(`[deployFirestoreRules] ${formatted}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`firestore.rules compilation failed:\n  ${errors.join('\n  ')}`);
  }
}

async function createRuleset(projectId, accessToken, rulesContent) {
  const createUrl = `${FIREBASE_RULES_BASE_URL}/projects/${encodeURIComponent(
    projectId
  )}/rulesets`;

  const res = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: {
        files: [{ name: 'firestore.rules', content: rulesContent }],
      },
    }),
  });

  if (!res.ok) {
    throw new Error(formatPermissionHint(res.status, 'Creating new Firestore ruleset'));
  }

  const data = await res.json();
  const rulesetName = typeof data?.name === 'string' ? data.name : '';
  if (!RULESET_NAME_PATTERN.test(rulesetName)) {
    throw new Error('Created ruleset response had an unexpected resource name.');
  }
  return rulesetName;
}

async function activateRelease(projectId, accessToken, rulesetName, releaseExists) {
  const releaseResourceName = `projects/${projectId}/releases/${FIRESTORE_RELEASE_ID}`;

  if (!releaseExists) {
    const createUrl = `${FIREBASE_RULES_BASE_URL}/projects/${encodeURIComponent(
      projectId
    )}/releases`;
    const res = await fetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: releaseResourceName,
        rulesetName,
      }),
    });

    if (!res.ok) {
      throw new Error(formatPermissionHint(res.status, 'Creating cloud.firestore release'));
    }
    return;
  }

  const patchUrl = `${FIREBASE_RULES_BASE_URL}/projects/${encodeURIComponent(
    projectId
  )}/releases/${FIRESTORE_RELEASE_ID}`;
  const res = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      release: {
        name: releaseResourceName,
        rulesetName,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(formatPermissionHint(res.status, 'Updating cloud.firestore release'));
  }
}

async function main() {
  const localRules = loadLocalRules();
  console.log(
    `[deployFirestoreRules] Loaded firestore.rules (${Buffer.byteLength(localRules, 'utf8')} bytes).`
  );

  const rawSecret = (process.env.FIREBASE_SERVICE_ACCOUNT ?? '').trim();
  if (!rawSecret) {
    console.warn(
      '::warning::FIREBASE_SERVICE_ACCOUNT secret is not set; skipping Firestore rules deployment.'
    );
    return;
  }

  const creds = parseServiceAccount(rawSecret);
  const accessToken = await fetchAccessToken(creds);

  const current = await getCurrentReleaseState(creds.projectId, accessToken);
  if (current.content !== null && current.content === localRules) {
    console.log(
      `[deployFirestoreRules] Live ${FIRESTORE_RELEASE_ID} release (${current.rulesetName}) already matches firestore.rules; skipping deploy.`
    );
    return;
  }

  await validateRulesSyntax(creds.projectId, accessToken, localRules);
  console.log('[deployFirestoreRules] Syntax and semantic check passed.');

  if (isDryRun) {
    console.log(
      `[deployFirestoreRules] [DRY RUN] Would deploy updated firestore.rules to projects/${creds.projectId}/releases/${FIRESTORE_RELEASE_ID}.`
    );
    return;
  }

  const newRulesetName = await createRuleset(creds.projectId, accessToken, localRules);
  await activateRelease(creds.projectId, accessToken, newRulesetName, current.exists);

  console.log(
    `[deployFirestoreRules] Deployed ${newRulesetName} -> projects/${creds.projectId}/releases/${FIRESTORE_RELEASE_ID}.`
  );
}

main().catch((err) => {
  console.error(
    `[deployFirestoreRules] Error: ${err instanceof Error ? err.message : 'Unexpected failure'}`
  );
  process.exit(1);
});
