import type { Unsubscribe } from 'firebase/firestore';
import type { OffsetsMode } from './storage';
import type { DrillId } from '../types';
import {
  subscribeTeamProfiles,
  upsertPublicProfileScore,
} from './profileService';

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  score: number;      // Best 60-second blitz score
  bestStreak: number; // Best consecutive streak
  updatedAt?: unknown;
}

/**
 * Subscribes to real-time high scores for the specified drill,
 * derived directly from the team's public profiles.
 */
export function subscribeLeaderboard(
  drill: DrillId | OffsetsMode,
  onUpdate: (entries: LeaderboardEntry[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const drillId: DrillId =
    drill === 'letterToNum' ? 'offsetsLetterToNum' : drill === 'numToLetter' ? 'offsetsNumToLetter' : drill;

  return subscribeTeamProfiles(
    (profiles) => {
      const entries: LeaderboardEntry[] = profiles
        .map((p) => {
          const modeScore = p.drillScores?.[drillId];
          return {
            uid: p.uid,
            displayName: p.displayName || 'Decoder',
            score: modeScore?.best60s || 0,
            bestStreak: modeScore?.bestStreak || 0,
            updatedAt: p.updatedAt,
          };
        })
        .filter((e) => e.score > 0 || e.bestStreak > 0);

      // Sort descending by score, tiebreak by streak, then by name
      entries.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.bestStreak !== a.bestStreak) return b.bestStreak - a.bestStreak;
        return a.displayName.localeCompare(b.displayName);
      });

      onUpdate(entries);
    },
    onError
  );
}

/**
 * Pushes or updates the user's personal best score on their public profile.
 * Enforces a strict high-water-mark (Math.max) so scores or streaks can NEVER be downgraded.
 */
export async function updateLeaderboardScore(
  uid: string,
  displayName: string,
  drill: DrillId | OffsetsMode,
  score: number,
  bestStreak: number
): Promise<LeaderboardEntry | null> {
  const drillId: DrillId =
    drill === 'letterToNum' ? 'offsetsLetterToNum' : drill === 'numToLetter' ? 'offsetsNumToLetter' : drill;
  const result = await upsertPublicProfileScore(uid, drillId, score, bestStreak, displayName);
  if (!result) return null;
  return {
    uid,
    displayName,
    score: result.score,
    bestStreak: result.bestStreak,
  };
}
