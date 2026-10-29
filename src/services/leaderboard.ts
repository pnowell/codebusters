import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { OffsetsMode } from './storage';

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  score: number;      // Best 60-second blitz score
  bestStreak: number; // Best consecutive streak
  updatedAt?: unknown;
}

/**
 * Returns the collection name for a given offsets mode
 */
export const getLeaderboardBoardId = (mode: OffsetsMode): string => `offsets_${mode}`;

/**
 * Subscribes to real-time high scores for the specified offsets mode
 */
export function subscribeLeaderboard(
  mode: OffsetsMode,
  onUpdate: (entries: LeaderboardEntry[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!db) {
    onUpdate([]);
    return () => {};
  }

  const boardId = getLeaderboardBoardId(mode);
  const entriesCol = collection(db, 'leaderboards', boardId, 'entries');
  // Order by score descending, limit to top 50
  const q = query(entriesCol, orderBy('score', 'desc'), limit(50));

  return onSnapshot(
    q,
    (snap) => {
      const entries: LeaderboardEntry[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as LeaderboardEntry;
        entries.push({
          uid: data.uid || docSnap.id,
          displayName: data.displayName || 'Decoder',
          score: data.score || 0,
          bestStreak: data.bestStreak || 0,
          updatedAt: data.updatedAt,
        });
      });

      // Secondary client-side tiebreaker sort: highest bestStreak, then name
      entries.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.bestStreak !== a.bestStreak) return b.bestStreak - a.bestStreak;
        return a.displayName.localeCompare(b.displayName);
      });

      onUpdate(entries);
    },
    (err) => {
      console.warn(`[Leaderboard] Error subscribing to ${boardId}:`, err);
      onError?.(err);
    }
  );
}

/**
 * Pushes or updates the user's personal best score on the team leaderboard.
 * Enforces a strict high-water-mark (Math.max) so scores or streaks can NEVER be downgraded.
 */
export async function updateLeaderboardScore(
  uid: string,
  displayName: string,
  mode: OffsetsMode,
  score: number,
  bestStreak: number
): Promise<LeaderboardEntry | null> {
  if (!db || !uid) return null;
  // Don't post empty scores
  if (score <= 0 && bestStreak <= 0) return null;

  const boardId = getLeaderboardBoardId(mode);
  const entryRef = doc(db, 'leaderboards', boardId, 'entries', uid);

  try {
    const snap = await getDoc(entryRef);
    const existing = snap.exists() ? (snap.data() as Partial<LeaderboardEntry>) : null;

    const targetScore = Math.max(existing?.score ?? 0, score);
    const targetStreak = Math.max(existing?.bestStreak ?? 0, bestStreak);
    const targetName = displayName || existing?.displayName || 'Decoder';

    // If existing score and streak are already >= target and name unchanged, do not rewrite
    if (
      existing &&
      existing.score === targetScore &&
      existing.bestStreak === targetStreak &&
      existing.displayName === targetName
    ) {
      return {
        uid,
        displayName: targetName,
        score: targetScore,
        bestStreak: targetStreak,
      };
    }

    const updatedEntry: LeaderboardEntry = {
      uid,
      displayName: targetName,
      score: targetScore,
      bestStreak: targetStreak,
    };

    await setDoc(
      entryRef,
      {
        ...updatedEntry,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return updatedEntry;
  } catch (err) {
    console.warn(`[Leaderboard] Failed to update score for ${uid} on ${boardId}:`, err);
    return null;
  }
}
