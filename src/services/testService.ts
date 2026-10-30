import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  query,
  where,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { TestPacket, TestAttempt } from '../types';

const LOCAL_ATTEMPT_PREFIX = 'davinci_test_attempt_';

/**
 * Loads an ongoing or completed test attempt from localStorage
 */
export function getLocalTestAttempt(testId: string): TestAttempt | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_ATTEMPT_PREFIX}${testId}`);
    if (!raw) return null;
    return JSON.parse(raw) as TestAttempt;
  } catch (err) {
    console.warn('[TestService] Failed to load local attempt:', err);
    return null;
  }
}

/**
 * Saves a test attempt to localStorage for instant recovery across tab switches or reloads
 */
export function saveLocalTestAttempt(attempt: TestAttempt): void {
  try {
    localStorage.setItem(`${LOCAL_ATTEMPT_PREFIX}${attempt.testId}`, JSON.stringify(attempt));
  } catch (err) {
    console.warn('[TestService] Failed to persist local attempt:', err);
  }
}

/**
 * Clears local attempt storage after final submission
 */
export function clearLocalTestAttempt(testId: string): void {
  try {
    localStorage.removeItem(`${LOCAL_ATTEMPT_PREFIX}${testId}`);
  } catch {
    // Ignore error
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

/**
 * Subscribes to all active tests configured in Firestore, sorted with newest at the top.
 */
export function subscribeAvailableTests(
  onUpdate: (tests: TestPacket[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!db) {
    onUpdate([]);
    return () => {};
  }

  const testsCol = collection(db, 'tests');
  const q = query(testsCol, where('active', '==', true));

  return onSnapshot(
    q,
    (snap) => {
      const tests: TestPacket[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as TestPacket;
        tests.push({
          ...data,
          testId: data.testId || docSnap.id,
        });
      });
      // Sort descending by creation timestamp (newest on top)
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
 * Resolves the freshest attempt between two candidate records (e.g. Firestore vs. localStorage).
 * Prefers strictly newer runs (by startedAt), completed attempts over in-progress ones for the
 * same run, and the candidate with the most recent submission/start timestamp.
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

function mergeAttemptIntoMap(map: Record<string, TestAttempt>, data: TestAttempt) {
  const testId = data.testId;
  if (!testId) return;

  const resolved = resolveFreshestAttempt(map[testId], data);
  if (resolved) {
    map[testId] = resolved;
  }
}

/**
 * Subscribes to all test attempts made by a specific student (or teams containing the student)
 */
export function subscribeStudentAttempts(
  studentUid: string,
  onUpdate: (attempts: Record<string, TestAttempt>) => void,
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
        const data = docSnap.data() as TestAttempt;
        mergeAttemptIntoMap(attemptsMap, data);
      });
      onUpdate(attemptsMap);
    },
    (err) => {
      console.warn(`[TestService] Error querying attempts for ${studentUid}:`, err);
      onError?.(err);
    }
  );
}

/**
 * Fetches a test by its testId from Firestore
 */
export async function fetchTestById(testId: string): Promise<TestPacket | null> {
  if (!db) return null;
  try {
    const docRef = doc(db, 'tests', testId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    const data = snap.data() as TestPacket;
    return {
      ...data,
      testId: data.testId || snap.id,
    };
  } catch (err) {
    console.warn(`[TestService] Failed to fetch test ${testId}:`, err);
    return null;
  }
}

/**
 * Persists a student attempt to Firestore `/test_attempts/{attemptId}`
 */
export async function saveTestAttemptToFirestore(attempt: TestAttempt): Promise<boolean> {
  if (!db) return false;
  try {
    const docRef = doc(db, 'test_attempts', attempt.attemptId);
    const cleaned = JSON.parse(JSON.stringify(attempt));
    await setDoc(
      docRef,
      {
        ...cleaned,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.warn(`[TestService] Failed to sync attempt ${attempt.attemptId} to Firestore:`, err);
    return false;
  }
}
