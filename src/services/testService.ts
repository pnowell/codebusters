import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { withVersionStamp } from './versionService';
import { isLookupCipher } from '../data/drills';
import type {
  CipherType,
  LookupCipherType,
  Quote,
  TestAttempt,
  TestCohort,
  TestPacket,
  TestQuestion,
} from '../types';
import {
  evaluateTestPacket,
  normalizeTestAttempt,
  normalizeUidList,
  resolveUserCohort,
  type PendingCellOp,
} from '../utils/testSync';

const LOCAL_ATTEMPT_PREFIX = 'davinci_test_attempt_';

/**
 * Loads an ongoing or completed test attempt from localStorage (used for Guest / non-cloud fallback).
 */
export function getLocalTestAttempt(
  attemptId: string,
  legacyTestId?: string
): TestAttempt | null {
  try {
    const raw =
      localStorage.getItem(`${LOCAL_ATTEMPT_PREFIX}${attemptId}`) ??
      (legacyTestId ? localStorage.getItem(`${LOCAL_ATTEMPT_PREFIX}${legacyTestId}`) : null);
    if (!raw) return null;
    return JSON.parse(raw) as TestAttempt;
  } catch (err) {
    console.warn('[TestService] Failed to load local attempt:', err);
    return null;
  }
}

/**
 * Saves a test attempt to localStorage keyed by attemptId.
 */
export function saveLocalTestAttempt(attempt: TestAttempt): void {
  try {
    localStorage.setItem(
      `${LOCAL_ATTEMPT_PREFIX}${attempt.attemptId}`,
      JSON.stringify(attempt)
    );
  } catch (err) {
    console.warn('[TestService] Failed to persist local attempt:', err);
  }
}

/**
 * Clears local attempt storage.
 */
export function clearLocalTestAttempt(attemptId: string, legacyTestId?: string): void {
  try {
    localStorage.removeItem(`${LOCAL_ATTEMPT_PREFIX}${attemptId}`);
    if (legacyTestId) {
      localStorage.removeItem(`${LOCAL_ATTEMPT_PREFIX}${legacyTestId}`);
    }
  } catch {
    // Ignore storage errors
  }
}

function getMillis(timestamp: unknown): number {
  if (!timestamp) return 0;
  if (typeof timestamp === 'number') return timestamp;
  if (typeof (timestamp as { toMillis?: () => number }).toMillis === 'function') {
    return (timestamp as { toMillis: () => number }).toMillis();
  }
  if (typeof (timestamp as { seconds?: number }).seconds === 'number') {
    return (timestamp as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function normalizeCohorts(raw: unknown): TestCohort[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seenStudents = new Set<string>();
  const cohorts: TestCohort[] = [];

  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const obj = item as { id?: unknown; name?: unknown; studentUids?: unknown };
    const uniqueUids = normalizeUidList(
      Array.isArray(obj.studentUids) ? (obj.studentUids as string[]) : []
    ).filter((uid) => {
      if (seenStudents.has(uid)) return false;
      seenStudents.add(uid);
      return true;
    });

    if (uniqueUids.length === 0) return;
    const id =
      typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : `cohort-${index + 1}`;
    const name =
      typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : undefined;

    cohorts.push({
      id,
      ...(name ? { name } : {}),
      studentUids: uniqueUids,
    });
  });

  return cohorts.length > 0 ? cohorts : undefined;
}

function normalizeTestQuestions(raw: unknown): TestQuestion[] {
  if (!Array.isArray(raw)) return [];
  const questions: TestQuestion[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const obj = item as Record<string, unknown>;
    const rawCipher = typeof obj.cipher === 'string' ? (obj.cipher as CipherType) : 'atbash';
    const cipher: LookupCipherType = isLookupCipher(rawCipher) ? rawCipher : 'atbash';
    const quoteId =
      typeof obj.quoteId === 'number' && Number.isInteger(obj.quoteId) && obj.quoteId >= 0
        ? obj.quoteId
        : 0;
    const points =
      typeof obj.points === 'number' && Number.isFinite(obj.points) && obj.points > 0
        ? Math.round(obj.points)
        : 150;
    const description =
      typeof obj.description === 'string' && obj.description.trim().length > 0
        ? obj.description.trim().slice(0, 240)
        : undefined;
    const isTiebreaker = Boolean(obj.isTiebreaker);
    questions.push({
      questionNumber: index + 1,
      cipher,
      quoteId,
      points,
      ...(isTiebreaker ? { isTiebreaker: true } : {}),
      ...(description ? { description } : {}),
    });
  });
  return questions;
}

function normalizeTestPacket(raw: Record<string, unknown>, fallbackId: string): TestPacket {
  const base = raw as unknown as TestPacket;
  const cohorts = normalizeCohorts(raw.cohorts);
  const questions = normalizeTestQuestions(raw.questions);
  return {
    ...base,
    testId: base.testId || fallbackId,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : fallbackId,
    description: typeof raw.description === 'string' ? raw.description : '',
    timeLimitSeconds:
      typeof raw.timeLimitSeconds === 'number' && raw.timeLimitSeconds >= 60
        ? Math.round(raw.timeLimitSeconds)
        : 2100,
    active: Boolean(raw.active),
    questions,
    cohorts,
  };
}

/**
 * Subscribes to practice tests in Firestore, sorted newest at the top.
 * Students receive only `active == true` tests; teachers (`includeInactive: true`) receive all tests.
 */
export function subscribeAvailableTests(
  onUpdate: (tests: TestPacket[]) => void,
  options?: { includeInactive?: boolean },
  onError?: (err: Error) => void
): Unsubscribe {
  if (!db) {
    onUpdate([]);
    return () => {};
  }

  const testsCol = collection(db, 'tests');
  const q = options?.includeInactive
    ? query(testsCol)
    : query(testsCol, where('active', '==', true));

  return onSnapshot(
    q,
    (snap) => {
      const tests: TestPacket[] = [];
      snap.forEach((docSnap) => {
        const raw = docSnap.data() as Record<string, unknown>;
        tests.push(normalizeTestPacket(raw, docSnap.id));
      });
      tests.sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));
      onUpdate(tests);
    },
    (err) => {
      console.warn('[TestService] Error querying available tests:', err);
      onError?.(err);
      onUpdate([]);
    }
  );
}

/**
 * Resolves the freshest attempt between two candidate records.
 */
export function resolveFreshestAttempt(
  cloudAttempt?: TestAttempt | null,
  localAttempt?: TestAttempt | null
): TestAttempt | null {
  if (!cloudAttempt && !localAttempt) return null;
  if (!cloudAttempt) return localAttempt ?? null;
  if (!localAttempt) return cloudAttempt;

  const localIsComplete =
    localAttempt.status === 'submitted' || localAttempt.status === 'expired';
  const cloudIsComplete =
    cloudAttempt.status === 'submitted' || cloudAttempt.status === 'expired';

  const localStart = localAttempt.startedAt || 0;
  const cloudStart = cloudAttempt.startedAt || 0;

  if (localIsComplete && !cloudIsComplete && localStart >= cloudStart) {
    return localAttempt;
  }
  if (cloudIsComplete && !localIsComplete && cloudStart >= localStart) {
    return cloudAttempt;
  }

  if (localStart !== cloudStart) {
    return localStart > cloudStart ? localAttempt : cloudAttempt;
  }

  const localTime = Math.max(localAttempt.submittedAt || 0, localStart);
  const cloudTime = Math.max(cloudAttempt.submittedAt || 0, cloudStart);
  return localTime >= cloudTime ? localAttempt : cloudAttempt;
}

/**
 * Resolves the active/completed TestAttempt for `(testPacket, currentUid)` from the
 * `attemptsByAttemptId` map (authoritative when signed into Firestore, with local fallback for Guest mode).
 */
export function resolveAttemptForTest(
  testPacket: TestPacket,
  currentUid: string | undefined,
  attemptsByAttemptId: Record<string, TestAttempt>
): TestAttempt | null {
  const { attemptId: expectedAttemptId, isCollaborative } = resolveUserCohort(
    testPacket,
    currentUid
  );
  const isCloudUser = Boolean(db && currentUid && currentUid !== 'student');

  let cloudMatch: TestAttempt | null = attemptsByAttemptId[expectedAttemptId] ?? null;

  // Backwards compatibility for legacy solo attempts created with timestamped IDs
  if (!cloudMatch && !isCollaborative && !testPacket.cohorts?.length) {
    for (const candidate of Object.values(attemptsByAttemptId)) {
      if (candidate.testId === testPacket.testId && candidate.studentUids.length <= 1) {
        cloudMatch = resolveFreshestAttempt(cloudMatch, candidate);
      }
    }
  }

  if (isCloudUser) {
    return cloudMatch;
  }

  const localMatch = getLocalTestAttempt(
    expectedAttemptId,
    isCollaborative ? undefined : testPacket.testId
  );
  return resolveFreshestAttempt(cloudMatch, localMatch);
}

/**
 * Subscribes to all test attempts containing `studentUid` in `studentUids`, keyed by `attemptId`.
 */
export function subscribeStudentAttempts(
  studentUid: string,
  onUpdate: (attemptsByAttemptId: Record<string, TestAttempt>) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!db || !studentUid) {
    onUpdate({});
    return () => {};
  }

  const attemptsCol = collection(db, 'test_attempts');
  const q = query(attemptsCol, where('studentUids', 'array-contains', studentUid));

  return onSnapshot(
    q,
    (snap) => {
      const attemptsMap: Record<string, TestAttempt> = {};
      snap.forEach((docSnap) => {
        const raw = docSnap.data() as Record<string, unknown>;
        const attempt = normalizeTestAttempt(raw, docSnap.id);
        attemptsMap[attempt.attemptId] = attempt;
      });
      onUpdate(attemptsMap);
    },
    (err) => {
      console.warn('[TestService] Error querying student attempts:', err);
      onError?.(err);
    }
  );
}

/**
 * Subscribes in real time to a single `/test_attempts/{attemptId}` document.
 * Emits `null` when the document does not exist yet (or after a teacher resets it).
 */
export function subscribeTestAttemptById(
  attemptId: string,
  onUpdate: (attempt: TestAttempt | null) => void,
  options?: {
    questions?: readonly TestQuestion[];
    getQuote?: (quoteId: number) => Quote | undefined;
  },
  onError?: (err: Error) => void
): Unsubscribe {
  if (!db || !attemptId) {
    onUpdate(getLocalTestAttempt(attemptId));
    return () => {};
  }

  const docRef = doc(db, 'test_attempts', attemptId);
  return onSnapshot(
    docRef,
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      const raw = snap.data() as Record<string, unknown>;
      onUpdate(
        normalizeTestAttempt(raw, snap.id, options?.questions, options?.getQuote)
      );
    },
    (err) => {
      console.warn('[TestService] Error subscribing to test attempt:', err);
      onError?.(err);
    }
  );
}

/**
 * Fetches a test by its `testId` from Firestore.
 */
export async function fetchTestById(testId: string): Promise<TestPacket | null> {
  if (!db) return null;
  try {
    const docRef = doc(db, 'tests', testId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return normalizeTestPacket(snap.data() as Record<string, unknown>, snap.id);
  } catch (err) {
    console.warn('[TestService] Failed to fetch test:', err);
    return null;
  }
}

/**
 * Atomically marks `currentUid` as Ready (or Unready) in the cohort's Join Lobby via a
 * Firestore transaction. When all cohort members are Ready (immediately for solo users),
 * transitions the attempt to `status: 'in_progress'` and starts `startedAt` exactly once.
 */
export async function setLobbyReadyState(
  testPacket: TestPacket,
  currentUid: string,
  ready: boolean
): Promise<TestAttempt | null> {
  const { memberUids, attemptId } = resolveUserCohort(testPacket, currentUid);

  // Offline / Guest mode fallback
  if (!db || currentUid === 'student') {
    if (!ready) {
      clearLocalTestAttempt(attemptId, testPacket.testId);
      return null;
    }
    const existing = getLocalTestAttempt(attemptId, testPacket.testId);
    if (existing && existing.status === 'in_progress') {
      return existing;
    }
    const now = Date.now();
    const localAttempt: TestAttempt = {
      attemptId,
      testId: testPacket.testId,
      studentUids: memberUids,
      readyUids: memberUids,
      submitReadyUids: [],
      startedAt: now,
      status: 'in_progress',
      workspaces: {},
    };
    saveLocalTestAttempt(localAttempt);
    return localAttempt;
  }

  const docRef = doc(db, 'test_attempts', attemptId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);

    if (snap.exists()) {
      const existing = normalizeTestAttempt(snap.data() as Record<string, unknown>, snap.id);
      // Never overwrite an attempt that has already started or completed
      if (existing.status !== 'lobby') {
        return existing;
      }

      const prevReady = existing.readyUids ?? [];
      const nextReady = ready
        ? Array.from(new Set([...prevReady, currentUid])).filter((id) =>
            memberUids.includes(id)
          )
        : prevReady.filter((id) => id !== currentUid && memberUids.includes(id));

      const allReady =
        ready &&
        memberUids.length > 0 &&
        memberUids.every((id) => nextReady.includes(id));

      if (allReady) {
        const startedAt = Date.now();
        tx.update(
          docRef,
          withVersionStamp({
            readyUids: nextReady,
            submitReadyUids: [],
            status: 'in_progress',
            startedAt,
            updatedAt: serverTimestamp(),
          })
        );
        return {
          ...existing,
          readyUids: nextReady,
          submitReadyUids: [],
          status: 'in_progress',
          startedAt,
        };
      }

      tx.update(
        docRef,
        withVersionStamp({
          readyUids: nextReady,
          updatedAt: serverTimestamp(),
        })
      );
      return {
        ...existing,
        readyUids: nextReady,
      };
    }

    if (!ready) {
      return null;
    }

    const nextReady = memberUids.includes(currentUid) ? [currentUid] : [];
    const allReady =
      memberUids.length > 0 && memberUids.every((id) => nextReady.includes(id));
    const startedAt = allReady ? Date.now() : 0;
    const status = allReady ? 'in_progress' : 'lobby';

    const payload: Record<string, unknown> = withVersionStamp({
      attemptId,
      testId: testPacket.testId,
      studentUids: memberUids,
      readyUids: nextReady,
      submitReadyUids: [],
      presence: {},
      startedAt,
      status,
      workspaces: {},
      updatedAt: serverTimestamp(),
    });

    tx.set(docRef, payload);

    return {
      attemptId,
      testId: testPacket.testId,
      studentUids: memberUids,
      readyUids: nextReady,
      submitReadyUids: [],
      presence: {},
      startedAt,
      status,
      workspaces: {},
    };
  });
}

/**
 * Flushes granular per-cell workspace updates using dot-notation field paths so
 * concurrent typing across teammates never overwrites other cells or questions.
 */
export async function flushWorkspaceCellOps(
  attemptId: string,
  ops: readonly PendingCellOp[],
  questionMeta: Record<
    number,
    { completed: boolean; lastEditedAt: number; lastEditedBy?: string }
  >
): Promise<boolean> {
  if (!db || ops.length === 0) return false;

  try {
    const docRef = doc(db, 'test_attempts', attemptId);
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };

    const touchedQuestions = new Set<number>();
    for (const op of ops) {
      payload[`workspaces.${op.qIdx}.inputs.${op.charIdx}`] = op.value;
      touchedQuestions.add(op.qIdx);
    }

    for (const qIdx of touchedQuestions) {
      const meta = questionMeta[qIdx];
      if (meta) {
        payload[`workspaces.${qIdx}.completed`] = meta.completed;
        payload[`workspaces.${qIdx}.lastEditedAt`] = meta.lastEditedAt;
        if (meta.lastEditedBy) {
          payload[`workspaces.${qIdx}.lastEditedBy`] = meta.lastEditedBy;
        }
      }
    }

    await updateDoc(docRef, withVersionStamp(payload));
    return true;
  } catch (err) {
    console.warn('[TestService] Failed to flush workspace cell edits:', err);
    return false;
  }
}

/**
 * Updates the current user's active tab presence (`0..N-1` for Q1..QN, `N` for Review, `-1` on exit).
 */
export async function updateMemberPresence(
  attemptId: string,
  uid: string,
  activeQIndex: number
): Promise<void> {
  if (!db || !attemptId || !uid || uid === 'student') return;
  try {
    const docRef = doc(db, 'test_attempts', attemptId);
    await updateDoc(
      docRef,
      withVersionStamp({
        [`presence.${uid}`]: {
          activeQIndex,
          updatedAt: Date.now(),
        },
      })
    );
  } catch {
    // Ignore transient or deleted-attempt presence errors
  }
}

/**
 * Atomically records or withdraws `currentUid`'s early-submit confirmation.
 * When all cohort members confirm, grades the authoritative server workspaces inside
 * the transaction and transitions `status` to `'submitted'`.
 */
export async function setEarlySubmitReadyState(
  testPacket: TestPacket,
  attemptId: string,
  currentUid: string,
  ready: boolean,
  getQuote: (quoteId: number) => Quote | undefined,
  localFallbackAttempt?: TestAttempt
): Promise<TestAttempt | null> {
  if (!db || currentUid === 'student') {
    if (!ready || !localFallbackAttempt) return localFallbackAttempt ?? null;
    const now = Date.now();
    const evaluated = evaluateTestPacket(
      testPacket,
      localFallbackAttempt.workspaces,
      localFallbackAttempt.startedAt,
      getQuote,
      now
    );
    const finalized: TestAttempt = {
      ...localFallbackAttempt,
      submittedAt: now,
      status: 'submitted',
      results: evaluated,
    };
    saveLocalTestAttempt(finalized);
    return finalized;
  }

  const docRef = doc(db, 'test_attempts', attemptId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists()) return null;

    const existing = normalizeTestAttempt(
      snap.data() as Record<string, unknown>,
      snap.id,
      testPacket.questions,
      getQuote
    );

    if (existing.status === 'submitted' || existing.status === 'expired') {
      return existing;
    }
    if (existing.status !== 'in_progress') {
      return existing;
    }

    const memberUids = existing.studentUids;
    const prevVotes = existing.submitReadyUids ?? [];
    const nextVotes = ready
      ? Array.from(new Set([...prevVotes, currentUid])).filter((id) =>
          memberUids.includes(id)
        )
      : prevVotes.filter((id) => id !== currentUid && memberUids.includes(id));

    const allConfirmed =
      ready &&
      memberUids.length > 0 &&
      memberUids.every((id) => nextVotes.includes(id));

    if (allConfirmed) {
      const submittedAt = Date.now();
      const evaluated = evaluateTestPacket(
        testPacket,
        existing.workspaces,
        existing.startedAt,
        getQuote,
        submittedAt
      );
      tx.update(
        docRef,
        withVersionStamp({
          status: 'submitted',
          submittedAt,
          submitReadyUids: nextVotes,
          results: evaluated,
          updatedAt: serverTimestamp(),
        })
      );
      return {
        ...existing,
        status: 'submitted',
        submittedAt,
        submitReadyUids: nextVotes,
        results: evaluated,
      };
    }

    tx.update(
      docRef,
      withVersionStamp({
        submitReadyUids: nextVotes,
        updatedAt: serverTimestamp(),
      })
    );
    return {
      ...existing,
      submitReadyUids: nextVotes,
    };
  });
}

/**
 * Atomically grades and marks a test attempt as `'expired'` when the timer reaches 00:00.
 * Safe if multiple cohort members' timers reach 00:00 simultaneously.
 */
export async function expireTestAttemptTransaction(
  testPacket: TestPacket,
  attemptId: string,
  currentUid: string,
  getQuote: (quoteId: number) => Quote | undefined,
  localFallbackAttempt?: TestAttempt
): Promise<TestAttempt | null> {
  if (!db || currentUid === 'student') {
    if (!localFallbackAttempt) return null;
    const now = Date.now();
    const evaluated = evaluateTestPacket(
      testPacket,
      localFallbackAttempt.workspaces,
      localFallbackAttempt.startedAt,
      getQuote,
      now
    );
    const expired: TestAttempt = {
      ...localFallbackAttempt,
      submittedAt: now,
      status: 'expired',
      results: evaluated,
    };
    saveLocalTestAttempt(expired);
    return expired;
  }

  const docRef = doc(db, 'test_attempts', attemptId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists()) return null;

    const existing = normalizeTestAttempt(
      snap.data() as Record<string, unknown>,
      snap.id,
      testPacket.questions,
      getQuote
    );

    if (existing.status === 'submitted' || existing.status === 'expired') {
      return existing;
    }

    const submittedAt = Date.now();
    const evaluated = evaluateTestPacket(
      testPacket,
      existing.workspaces,
      existing.startedAt,
      getQuote,
      submittedAt
    );

    tx.update(
      docRef,
      withVersionStamp({
        status: 'expired',
        submittedAt,
        results: evaluated,
        updatedAt: serverTimestamp(),
      })
    );

    return {
      ...existing,
      status: 'expired',
      submittedAt,
      results: evaluated,
    };
  });
}

const VALID_TEST_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;

/**
 * Generates a URL-safe, collision-free `testId` slug from a test title.
 */
export function generateUniqueTestId(
  title: string,
  existingIds: ReadonlySet<string>
): string {
  const normalized = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');

  const base =
    normalized && normalized !== 'new' ? normalized : 'practice-test';

  if (!existingIds.has(base)) {
    return base;
  }

  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

/**
 * Teacher API: Creates or updates a full `TestPacket` document in `/tests/{testId}`
 * with strict input validation and zero `undefined` properties.
 */
export async function saveTestPacket(
  packet: TestPacket,
  options?: { isNew?: boolean }
): Promise<{ ok: boolean; testId?: string; error?: string }> {
  if (!db) {
    return { ok: false, error: 'Database connection is not available.' };
  }

  const trimmedTitle = packet.title.trim();
  if (!trimmedTitle || trimmedTitle.length > 120) {
    return { ok: false, error: 'Title must be between 1 and 120 characters.' };
  }

  const timeLimitSeconds = Math.round(packet.timeLimitSeconds);
  if (!Number.isFinite(timeLimitSeconds) || timeLimitSeconds < 60 || timeLimitSeconds > 10800) {
    return { ok: false, error: 'Time limit must be between 1 and 180 minutes.' };
  }

  if (!Array.isArray(packet.questions) || packet.questions.length === 0) {
    return { ok: false, error: 'Add at least one question before saving.' };
  }
  if (packet.questions.length > 50) {
    return { ok: false, error: 'Tests cannot exceed 50 questions.' };
  }

  let resolvedTestId = packet.testId.trim();
  if (!VALID_TEST_ID_RE.test(resolvedTestId) || resolvedTestId.toLowerCase() === 'new') {
    return { ok: false, error: 'Invalid test identifier.' };
  }

  const sanitizedQuestions: TestQuestion[] = [];
  for (let i = 0; i < packet.questions.length; i += 1) {
    const q = packet.questions[i];
    if (!isLookupCipher(q.cipher)) {
      return { ok: false, error: `Question ${i + 1} uses an unsupported cipher.` };
    }
    const quoteId = Math.round(q.quoteId);
    if (!Number.isInteger(quoteId) || quoteId < 0) {
      return { ok: false, error: `Question ${i + 1} has an invalid quote ID.` };
    }
    const points = Math.max(0, Math.min(5000, Math.round(q.points)));
    const cleanDesc =
      typeof q.description === 'string' && q.description.trim().length > 0
        ? q.description.trim().slice(0, 250)
        : undefined;

    sanitizedQuestions.push({
      questionNumber: i + 1,
      cipher: q.cipher,
      quoteId,
      points,
      ...(q.isTiebreaker ? { isTiebreaker: true } : {}),
      ...(cleanDesc ? { description: cleanDesc } : {}),
    });
  }

  const sanitizedCohorts = normalizeCohorts(packet.cohorts) ?? [];
  const cleanDescription = packet.description.trim().slice(0, 400);

  try {
    if (options?.isNew) {
      const baseId = resolvedTestId;
      let attemptIdx = 1;
      while (attemptIdx <= 15) {
        const candidateRef = doc(db, 'tests', resolvedTestId);
        const existingSnap = await getDoc(candidateRef);
        if (!existingSnap.exists()) {
          break;
        }
        attemptIdx += 1;
        resolvedTestId = `${baseId.slice(0, 48)}-${attemptIdx}`;
      }

      const createRef = doc(db, 'tests', resolvedTestId);
      await setDoc(
        createRef,
        withVersionStamp({
          testId: resolvedTestId,
          title: trimmedTitle,
          description: cleanDescription,
          timeLimitSeconds,
          active: Boolean(packet.active),
          questions: sanitizedQuestions,
          cohorts: sanitizedCohorts,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      return { ok: true, testId: resolvedTestId };
    }

    const docRef = doc(db, 'tests', resolvedTestId);
    await setDoc(
      docRef,
      withVersionStamp({
        testId: resolvedTestId,
        title: trimmedTitle,
        description: cleanDescription,
        timeLimitSeconds,
        active: Boolean(packet.active),
        questions: sanitizedQuestions,
        cohorts: sanitizedCohorts,
        updatedAt: serverTimestamp(),
      }),
      { merge: true }
    );
    return { ok: true, testId: resolvedTestId };
  } catch {
    console.warn('[TestService] Failed to save test packet');
    return {
      ok: false,
      error: 'Could not save test. Verify teacher permissions and network connection.',
    };
  }
}

/**
 * Teacher API: Deletes `/tests/{testId}` along with all associated `/test_attempts` documents.
 */
export async function deleteTestPacketAndAttempts(
  testId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!db || !testId || !VALID_TEST_ID_RE.test(testId)) {
    return { ok: false, error: 'Invalid test identifier.' };
  }
  try {
    const attemptsQuery = query(
      collection(db, 'test_attempts'),
      where('testId', '==', testId)
    );
    const snap = await getDocs(attemptsQuery);
    if (!snap.empty) {
      await Promise.all(
        snap.docs.map(async (docSnap) => {
          await deleteDoc(docSnap.ref);
          clearLocalTestAttempt(docSnap.id, testId);
        })
      );
    }
    await deleteDoc(doc(db, 'tests', testId));
    clearLocalTestAttempt(testId);
    return { ok: true };
  } catch {
    console.warn('[TestService] Failed to delete test packet');
    return {
      ok: false,
      error: 'Could not delete test. Verify teacher permissions and network connection.',
    };
  }
}

/**
 * Teacher API: Subscribes to all attempts on a specific `testId` so teachers can monitor
 * cohort statuses or reset attempts during practice.
 */
export function subscribeAttemptsForTest(
  testId: string,
  onUpdate: (attemptsByAttemptId: Record<string, TestAttempt>) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!db || !testId) {
    onUpdate({});
    return () => {};
  }

  const q = query(collection(db, 'test_attempts'), where('testId', '==', testId));
  return onSnapshot(
    q,
    (snap) => {
      const map: Record<string, TestAttempt> = {};
      snap.forEach((docSnap) => {
        const raw = docSnap.data() as Record<string, unknown>;
        const att = normalizeTestAttempt(raw, docSnap.id);
        map[att.attemptId] = att;
      });
      onUpdate(map);
    },
    (err) => {
      console.warn('[TestService] Error querying attempts for test:', err);
      onError?.(err);
    }
  );
}

/**
 * Teacher API: Deletes `/test_attempts/{attemptId}` to reset a cohort's or student's attempt.
 */
export async function deleteTestAttempt(attemptId: string): Promise<boolean> {
  if (!db || !attemptId) return false;
  try {
    await deleteDoc(doc(db, 'test_attempts', attemptId));
    clearLocalTestAttempt(attemptId);
    return true;
  } catch (err) {
    console.warn('[TestService] Failed to delete test attempt:', err);
    return false;
  }
}

/**
 * Legacy helper: persists a full TestAttempt document with merge.
 */
export async function saveTestAttemptToFirestore(attempt: TestAttempt): Promise<boolean> {
  if (!db) return false;
  try {
    const docRef = doc(db, 'test_attempts', attempt.attemptId);
    const cleaned = JSON.parse(JSON.stringify(attempt)) as Record<string, unknown>;
    await setDoc(
      docRef,
      withVersionStamp({
        ...cleaned,
        updatedAt: serverTimestamp(),
      }),
      { merge: true }
    );
    return true;
  } catch (err) {
    console.warn('[TestService] Failed to sync attempt to Firestore:', err);
    return false;
  }
}
