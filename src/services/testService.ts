import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  query,
  where,
  limit,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { TestPacket, TestAttempt } from '../types';

export const DEFAULT_PRACTICE_TEST: TestPacket = {
  testId: 'invitational-practice-1',
  title: 'Invitational Practice Test #1',
  description:
    'Science Olympiad Division A Practice Exam. 5 problems covering Pigpen, Galactic, Atbash, and Caesar ciphers. Work carefully — unanswered letters count as errors!',
  timeLimitSeconds: 2100, // 35 minutes
  active: true,
  questions: [
    {
      questionNumber: 1,
      cipher: 'pigpen',
      quoteId: 72, // "Instead of cursing the darkness, light a candle."
      points: 150,
      description: 'Decode this quote encrypted with the Pigpen / Masonic cipher.',
    },
    {
      questionNumber: 2,
      cipher: 'galactic',
      quoteId: 8, // "There was, I found, always more to learn."
      points: 150,
      description: 'Decode this quote written in the Standard Galactic Alphabet.',
    },
    {
      questionNumber: 3,
      cipher: 'atbash',
      quoteId: 4, // "Eternity is a long time, especially towards the end."
      points: 150,
      description: 'Decode this quote using the Atbash cipher (A ↔ Z, B ↔ Y).',
    },
    {
      questionNumber: 4,
      cipher: 'caesar',
      quoteId: 21, // "Do no harm and leave the world a better place than you found it."
      points: 150,
      params: { caesarShift: 2 },
      description: 'Decode this quote encrypted with a Caesar shift of +2 (A → C).',
    },
    {
      questionNumber: 5,
      cipher: 'pigpen',
      quoteId: 77, // "The human foot is a masterpiece of engineering and a work of art."
      points: 200,
      isTiebreaker: true,
      description: '★ TIEBREAKER: Decode this quotation from Leonardo da Vinci using the Pigpen cipher.',
    },
  ],
};

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

/**
 * Subscribes to the active test configured in Firestore.
 * If no test is in Firestore, falls back to null.
 */
export function subscribeActiveTest(
  onUpdate: (test: TestPacket | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!db) {
    onUpdate(null);
    return () => {};
  }

  const testsCol = collection(db, 'tests');
  const q = query(testsCol, where('active', '==', true), limit(1));

  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        onUpdate(null);
        return;
      }
      const docSnap = snap.docs[0];
      const data = docSnap.data() as TestPacket;
      onUpdate({
        ...data,
        testId: data.testId || docSnap.id,
      });
    },
    (err) => {
      console.warn('[TestService] Error querying active test:', err);
      onError?.(err);
      onUpdate(null);
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
 * Seeds or updates a test packet in Firestore `/tests/{testId}`
 */
export async function seedTestPacket(packet: TestPacket): Promise<boolean> {
  if (!db) return false;
  try {
    const docRef = doc(db, 'tests', packet.testId);
    await setDoc(
      docRef,
      {
        ...packet,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.error(`[TestService] Failed to seed test ${packet.testId}:`, err);
    return false;
  }
}

/**
 * Persists a student attempt to Firestore `/test_attempts/{attemptId}`
 */
export async function saveTestAttemptToFirestore(attempt: TestAttempt): Promise<boolean> {
  if (!db) return false;
  try {
    const docRef = doc(db, 'test_attempts', attempt.attemptId);
    await setDoc(
      docRef,
      {
        ...attempt,
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
