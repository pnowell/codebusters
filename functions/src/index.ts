import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import type { RawAttemptDoc, RawTestPacketDoc } from './handlers.js';

console.info(
  `[codebusters-functions] Booting target=${process.env.FUNCTION_TARGET ?? 'manifest'} port=${process.env.PORT ?? 'default'}`
);

const ALLOWLIST_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ALLOWLIST_CACHE_SIZE = 500;
const allowlistCache = new Map<
  string,
  { allowed: boolean; expiresAt: number }
>();

let adminReady = false;

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

export const logPracticeEvents = onRequest(
  {
    region: 'us-central1',
    cors: true,
    invoker: 'public',
    maxInstances: 10,
    memory: '512MiB',
    timeoutSeconds: 30,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const authHeader = req.headers.authorization ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Bearer token' });
      return;
    }
    const idToken = authHeader.slice(7).trim();
    if (!idToken) {
      res.status(401).json({ error: 'Empty Bearer token' });
      return;
    }

    try {
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
        res.status(401).json({ error: 'Invalid ID token' });
        return;
      }

      if (!email || !(await isEmailAllowedOnRoster(email))) {
        res.status(403).json({ error: 'User not on active classroom roster' });
        return;
      }

      try {
        const entries = handlersMod.buildServerLogsFromClientBatch(
          req.body,
          uid
        );
        emitStructuredLogsToStdout(entries);
        res.status(200).json({ ok: true, count: entries.length });
      } catch (err) {
        if (err instanceof handlersMod.EventValidationError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        console.error('[logPracticeEvents] Unexpected validation error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    } catch (err) {
      console.error('[logPracticeEvents] Fatal handler error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

export const onTestAttemptCompleted = onDocumentUpdated(
  {
    document: 'test_attempts/{attemptId}',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
  },
  async (event) => {
    const beforeData = event.data?.before.data() as RawAttemptDoc | undefined;
    const afterData = event.data?.after.data() as RawAttemptDoc | undefined;
    if (!beforeData || !afterData) return;

    const wasCompleted =
      beforeData.status === 'submitted' || beforeData.status === 'expired';
    const isNowCompleted =
      afterData.status === 'submitted' || afterData.status === 'expired';

    if (wasCompleted || !isNowCompleted) {
      return;
    }

    const testId =
      typeof afterData.testId === 'string' ? afterData.testId.trim() : '';
    if (!testId) return;

    const [{ db }, handlersMod, quotesMod] = await Promise.all([
      getAdminServices(),
      import('./handlers.js'),
      import('./quotesMapData.js'),
    ]);

    const testSnap = await db.collection('tests').doc(testId).get();
    if (!testSnap.exists) return;

    const testPacket = testSnap.data() as RawTestPacketDoc;
    const entries = handlersMod.buildTestAttemptCompletionLogs(
      event.params.attemptId,
      afterData,
      testPacket,
      quotesMod.QUOTES_MAP
    );
    emitStructuredLogsToStdout(entries);
  }
);
