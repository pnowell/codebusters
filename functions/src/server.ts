import http from 'node:http';
import type { RawAttemptDoc, RawTestPacketDoc } from './handlers.js';

const MAX_BODY_BYTES = 262_144; // 256 KiB cap
const ALLOWLIST_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ALLOWLIST_CACHE_SIZE = 500;
const allowlistCache = new Map<
  string,
  { allowed: boolean; expiresAt: number }
>();

let adminReady = false;
let oidcClientPromise: Promise<import('google-auth-library').OAuth2Client> | null =
  null;

function getOidcClient() {
  if (!oidcClientPromise) {
    oidcClientPromise = import('google-auth-library').then(
      (m) => new m.OAuth2Client()
    );
  }
  return oidcClientPromise;
}

async function getAdminServices() {
  const [appMod, authMod, firestoreMod] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/auth'),
    import('firebase-admin/firestore'),
  ]);
  if (!adminReady && appMod.getApps().length === 0) {
    appMod.initializeApp();
  }
  adminReady = true;
  return {
    auth: authMod.getAuth(),
    db: firestoreMod.getFirestore(),
  };
}

async function isEmailAllowedOnRoster(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  const now = Date.now();
  const cached = allowlistCache.get(normalized);
  if (cached && cached.expiresAt > now) {
    return cached.allowed;
  }

  const { db } = await getAdminServices();
  const snap = await db.collection('allowed_users').doc(normalized).get();
  const data = snap.data();
  const allowed = Boolean(snap.exists && data?.active !== false);

  if (allowlistCache.size >= MAX_ALLOWLIST_CACHE_SIZE) {
    const oldestKey = allowlistCache.keys().next().value;
    if (oldestKey) allowlistCache.delete(oldestKey);
  }
  allowlistCache.set(normalized, {
    allowed,
    expiresAt: now + ALLOWLIST_CACHE_TTL_MS,
  });
  return allowed;
}

function emitStructuredLogsToStdout(
  entries: readonly Record<string, unknown>[]
): void {
  for (const entry of entries) {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }
}

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '3600');
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>
): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readRawBody(
  req: http.IncomingMessage,
  maxBytes: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      total += chunk.length;
      if (total > maxBytes) {
        rejected = true;
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (err) => {
      if (!rejected) {
        rejected = true;
        reject(err);
      }
    });
  });
}

async function handleLogPracticeEvents(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    sendJson(res, 401, { error: 'Missing Bearer token' });
    return;
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    sendJson(res, 401, { error: 'Empty Bearer token' });
    return;
  }

  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req, MAX_BODY_BYTES);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'Payload Too Large' });
      return;
    }
    sendJson(res, 400, { error: 'Invalid request stream' });
    return;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody.toString('utf8'));
  } catch {
    sendJson(res, 400, { error: 'Malformed JSON body' });
    return;
  }

  const [{ auth }, handlersMod] = await Promise.all([
    getAdminServices(),
    import('./handlers.js'),
  ]);

  let uid = '';
  let email = '';
  try {
    const decoded = await auth.verifyIdToken(idToken);
    uid = decoded.uid;
    email = decoded.email ?? '';
  } catch {
    sendJson(res, 401, { error: 'Invalid ID token' });
    return;
  }

  if (!email || !(await isEmailAllowedOnRoster(email))) {
    sendJson(res, 403, { error: 'User not on active classroom roster' });
    return;
  }

  try {
    const entries = handlersMod.buildServerLogsFromClientBatch(parsedBody, uid);
    emitStructuredLogsToStdout(entries);
    sendJson(res, 200, { ok: true, count: entries.length });
  } catch (err) {
    if (err instanceof handlersMod.EventValidationError) {
      sendJson(res, err.statusCode, { error: err.message });
      return;
    }
    console.error('[logPracticeEvents] Unexpected validation error:', err);
    sendJson(res, 500, { error: 'Internal Server Error' });
  }
}

async function handleTestAttemptCompletedEvent(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  const expectedInvokerSa = (process.env.EVENTARC_INVOKER_SA ?? '').trim();
  if (!expectedInvokerSa) {
    console.error('[onTestAttemptCompleted] EVENTARC_INVOKER_SA is not configured.');
    sendJson(res, 500, { error: 'Misconfigured trigger auth' });
    return;
  }

  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    sendJson(res, 401, { error: 'Missing Eventarc OIDC token' });
    return;
  }
  const oidcToken = authHeader.slice(7).trim();

  try {
    const oidcClient = await getOidcClient();
    const ticket = await oidcClient.verifyIdToken({ idToken: oidcToken });
    const payload = ticket.getPayload();
    if (
      !payload ||
      payload.email_verified !== true ||
      payload.email !== expectedInvokerSa
    ) {
      sendJson(res, 403, { error: 'Unauthorized trigger principal' });
      return;
    }
  } catch {
    sendJson(res, 401, { error: 'Invalid Eventarc OIDC token' });
    return;
  }

  let rawBuf: Buffer;
  try {
    // Firestore workspace snapshots can be up to ~1 MiB
    rawBuf = await readRawBody(req, 4 * 1024 * 1024);
  } catch {
    sendJson(res, 400, { error: 'Failed reading CloudEvent body' });
    return;
  }

  const ceDocument = String(req.headers['ce-document'] ?? '').trim();
  const ceProject = String(
    req.headers['ce-project'] ?? process.env.GCLOUD_PROJECT ?? ''
  ).trim();
  const ceDatabase = String(req.headers['ce-database'] ?? '(default)').trim();
  const contentType = String(
    req.headers['ce-datacontenttype'] ?? req.headers['content-type'] ?? ''
  ).trim();

  const match = /^test_attempts\/([^/]+)$/.exec(ceDocument);
  if (!match) {
    sendJson(res, 200, { ignored: true });
    return;
  }
  const attemptId = match[1];

  const [{ db }, handlersMod, quotesMod, firestoreProvider] = await Promise.all(
    [
      getAdminServices(),
      import('./handlers.js'),
      import('./quotesMapData.js'),
      import('firebase-functions/v2/firestore'),
    ]
  );

  // Decode before/after snapshots using firebase-functions' official protobuf/json decoder
  const internalDecoder = firestoreProvider as unknown as {
    createBeforeSnapshot?: (ev: Record<string, unknown>) => {
      data: () => RawAttemptDoc | undefined;
    };
    createSnapshot?: (ev: Record<string, unknown>) => {
      data: () => RawAttemptDoc | undefined;
    };
  };

  if (
    typeof internalDecoder.createBeforeSnapshot !== 'function' ||
    typeof internalDecoder.createSnapshot !== 'function'
  ) {
    console.error('[onTestAttemptCompleted] Missing snapshot decoders');
    sendJson(res, 500, { error: 'Missing snapshot decoders' });
    return;
  }

  const rawEventObj = {
    datacontenttype: contentType || 'application/protobuf',
    data: rawBuf,
    project: ceProject,
    database: ceDatabase,
    document: ceDocument,
  };

  const beforeData = internalDecoder.createBeforeSnapshot(rawEventObj).data();
  const afterData = internalDecoder.createSnapshot(rawEventObj).data();
  if (!beforeData || !afterData) {
    sendJson(res, 200, { ignored: true });
    return;
  }

  const wasCompleted =
    beforeData.status === 'submitted' || beforeData.status === 'expired';
  const isNowCompleted =
    afterData.status === 'submitted' || afterData.status === 'expired';
  if (wasCompleted || !isNowCompleted) {
    sendJson(res, 200, { ignored: true });
    return;
  }

  const testId =
    typeof afterData.testId === 'string' ? afterData.testId.trim() : '';
  if (!testId) {
    sendJson(res, 200, { ignored: true });
    return;
  }

  const testSnap = await db.collection('tests').doc(testId).get();
  if (!testSnap.exists) {
    sendJson(res, 200, { ignored: true });
    return;
  }

  const testPacket = testSnap.data() as RawTestPacketDoc;
  const entries = handlersMod.buildTestAttemptCompletionLogs(
    attemptId,
    afterData,
    testPacket,
    quotesMod.QUOTES_MAP
  );
  emitStructuredLogsToStdout(entries);
  sendJson(res, 200, { ok: true, count: entries.length });
}

const port = Number.parseInt(process.env.PORT ?? '8080', 10) || 8080;

const server = http.createServer((req, res) => {
  const pathname = (req.url ?? '/').split('?')[0];

  if (pathname === '/healthz' || (pathname === '/' && req.method === 'GET')) {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/logPracticeEvents' || pathname === '/') {
    void handleLogPracticeEvents(req, res).catch((err) => {
      console.error('[server] Unhandled error in logPracticeEvents:', err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Internal Server Error' });
      }
    });
    return;
  }

  if (pathname === '/events/test-attempt-completed') {
    void handleTestAttemptCompletedEvent(req, res).catch((err) => {
      console.error('[server] Unhandled error in test-attempt-completed:', err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Internal Server Error' });
      }
    });
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
});

server.listen(port, '0.0.0.0', () => {
  console.info(`[codebusters-events] Listening on 0.0.0.0:${port}`);
});
