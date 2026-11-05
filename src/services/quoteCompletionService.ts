import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import type { TestPacket } from '../types';

export interface StudentQuoteCompletionsSnapshot {
  /** Map from quoteId -> sorted list of student display names (1 entry per unique student UID) */
  finishedByQuotesMap: ReadonlyMap<number, string[]>;
  /** True if `/users` could not be listed (e.g., before updated `firestore.rules` are published) */
  usersReadBlocked: boolean;
}

let cachedCompletionsMap: ReadonlyMap<number, string[]> = new Map();

/**
 * Returns the most recently fetched map of student quote completions for instant initial render.
 */
export function getCachedStudentQuoteCompletions(): ReadonlyMap<number, string[]> {
  return cachedCompletionsMap;
}

/**
 * Clears the in-memory student quote completions cache on sign-out.
 */
export function resetQuoteCompletionsCache(): void {
  cachedCompletionsMap = new Map();
}

function addQuoteCompletionForUid(
  quoteToUids: Map<number, Set<string>>,
  quoteId: number,
  uid: string
): void {
  if (!Number.isInteger(quoteId) || quoteId < 0 || !uid || uid === 'student') {
    return;
  }
  let set = quoteToUids.get(quoteId);
  if (!set) {
    set = new Set<string>();
    quoteToUids.set(quoteId, set);
  }
  set.add(uid);
}

/**
 * Teacher API: Aggregates unique student completions per quote across both:
 *   1. `/users/{uid}.completedQuotes` (individual cipher drills + synced test completions)
 *   2. `/test_attempts/{attemptId}` (any practice test attempt involving a student)
 *
 * Strictly excludes teacher accounts (`role === 'teacher'` in `/profiles` or `/allowed_users`)
 * and surfaces only non-PII display names.
 */
export async function fetchStudentQuoteCompletions(
  tests: readonly TestPacket[]
): Promise<StudentQuoteCompletionsSnapshot> {
  if (!db) {
    return {
      finishedByQuotesMap: cachedCompletionsMap,
      usersReadBlocked: false,
    };
  }

  const [profilesRes, allowlistRes, usersRes, attemptsRes] = await Promise.allSettled([
    getDocs(collection(db, 'profiles')),
    getDocs(collection(db, 'allowed_users')),
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'test_attempts')),
  ]);

  const teacherUids = new Set<string>();
  const teacherEmails = new Set<string>();
  const uidToDisplayName = new Map<string, string>();
  const emailToDisplayName = new Map<string, string>();

  if (allowlistRes.status === 'fulfilled') {
    allowlistRes.value.forEach((docSnap) => {
      const raw = docSnap.data() as Record<string, unknown>;
      const email = (
        typeof raw.email === 'string' && raw.email.trim()
          ? raw.email
          : docSnap.id
      )
        .trim()
        .toLowerCase();
      if (!email) return;

      if (raw.role === 'teacher') {
        teacherEmails.add(email);
      }
      if (typeof raw.displayName === 'string' && raw.displayName.trim()) {
        emailToDisplayName.set(email, raw.displayName.trim());
      }
    });
  }

  if (profilesRes.status === 'fulfilled') {
    profilesRes.value.forEach((docSnap) => {
      const raw = docSnap.data() as Record<string, unknown>;
      const uid = docSnap.id;
      if (raw.role === 'teacher') {
        teacherUids.add(uid);
      }
      if (typeof raw.displayName === 'string' && raw.displayName.trim()) {
        uidToDisplayName.set(uid, raw.displayName.trim());
      }
    });
  }

  // Track raw completedQuotes per uid first so teacher email identification applies before filtering
  const rawUserCompletions = new Map<string, number[]>();
  let usersReadBlocked = false;

  if (usersRes.status === 'fulfilled') {
    usersRes.value.forEach((docSnap) => {
      const raw = docSnap.data() as Record<string, unknown>;
      const uid = docSnap.id;
      const email =
        typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';

      if (email && teacherEmails.has(email)) {
        teacherUids.add(uid);
      }
      if (!uidToDisplayName.has(uid) && email && emailToDisplayName.has(email)) {
        uidToDisplayName.set(uid, emailToDisplayName.get(email)!);
      }

      if (Array.isArray(raw.completedQuotes)) {
        const cleanIds = raw.completedQuotes.filter(
          (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0
        );
        if (cleanIds.length > 0) {
          rawUserCompletions.set(uid, cleanIds);
        }
      }
    });
  } else {
    usersReadBlocked = true;
    console.warn(
      '[QuoteCompletions] Unable to read /users collection; publish updated firestore.rules to include individual drill completions.'
    );
  }

  const quoteToUids = new Map<number, Set<string>>();

  // 1. Add individual drill + synced test quote completions from `/users/{uid}`
  for (const [uid, quoteIds] of rawUserCompletions.entries()) {
    if (teacherUids.has(uid)) continue;
    for (const quoteId of quoteIds) {
      addQuoteCompletionForUid(quoteToUids, quoteId, uid);
    }
  }

  // 2. Union with `/test_attempts` so shared-device cohort partners and pre-existing attempts are counted
  if (attemptsRes.status === 'fulfilled') {
    const testById = new Map<string, TestPacket>();
    for (const t of tests) {
      testById.set(t.testId, t);
    }

    attemptsRes.value.forEach((docSnap) => {
      const raw = docSnap.data() as Record<string, unknown>;
      if (!Array.isArray(raw.studentUids)) return;

      const studentUids = raw.studentUids.filter(
        (u): u is string =>
          typeof u === 'string' && u.trim().length > 0 && !teacherUids.has(u.trim())
      );
      if (studentUids.length === 0) return;

      const attemptQuoteIds = new Set<number>();
      const testId = typeof raw.testId === 'string' ? raw.testId : '';
      const packet = testById.get(testId);
      if (packet) {
        for (const q of packet.questions) {
          if (Number.isInteger(q.quoteId) && q.quoteId >= 0) {
            attemptQuoteIds.add(q.quoteId);
          }
        }
      }

      const resultsObj = raw.results as { questions?: unknown } | undefined;
      if (resultsObj && Array.isArray(resultsObj.questions)) {
        for (const item of resultsObj.questions) {
          if (item && typeof item === 'object') {
            const qId = (item as { quoteId?: unknown }).quoteId;
            if (typeof qId === 'number' && Number.isInteger(qId) && qId >= 0) {
              attemptQuoteIds.add(qId);
            }
          }
        }
      }

      for (const uid of studentUids) {
        for (const quoteId of attemptQuoteIds) {
          addQuoteCompletionForUid(quoteToUids, quoteId, uid);
        }
      }
    });
  }

  const nextMap = new Map<number, string[]>();
  for (const [quoteId, uidSet] of quoteToUids.entries()) {
    if (uidSet.size === 0) continue;
    const names = Array.from(uidSet)
      .map((uid) => uidToDisplayName.get(uid) || 'Student')
      .sort((a, b) => a.localeCompare(b));
    nextMap.set(quoteId, names);
  }

  cachedCompletionsMap = nextMap;
  return {
    finishedByQuotesMap: nextMap,
    usersReadBlocked,
  };
}
