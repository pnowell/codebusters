import type { UserSettings } from '../types';
import {
  DEFAULT_UNLOCKED,
  isCipherType,
  IMPLEMENTED_DRILLS,
  getCipherBucket,
  type CipherType,
} from '../data/drills';

const KEYS = {
  settings: 'davinci_settings',
  offsetsBestStreak: 'davinci_offsets_best_streak',
  completedQuotes: 'davinci_completed_quotes',
  offsetsProgress: 'davinci_offsets_progress',
  practiceHistory: 'davinci_cipher_practice_history',
  lastWarmupOffsetsMode: 'davinci_last_warmup_offsets_mode',
} as const;

export const DEFAULT_SETTINGS: UserSettings = {
  studentName: 'Decoder',
  unlockedCiphers: DEFAULT_UNLOCKED,
};

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(KEYS.settings);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      unlockedCiphers: (parsed.unlockedCiphers ?? DEFAULT_SETTINGS.unlockedCiphers).filter(isCipherType),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const saveSettings = (s: UserSettings) =>
  localStorage.setItem(KEYS.settings, JSON.stringify(s));

export const loadBestStreak = () =>
  parseInt(localStorage.getItem(KEYS.offsetsBestStreak) ?? '0', 10) || 0;

export const saveBestStreak = (n: number) =>
  localStorage.setItem(KEYS.offsetsBestStreak, String(n));

export function loadCompletedQuoteIds(): number[] {
  try {
    const raw = localStorage.getItem(KEYS.completedQuotes);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(n => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

export function saveCompletedQuoteId(id: number): void {
  try {
    const current = new Set(loadCompletedQuoteIds());
    if (!current.has(id)) {
      current.add(id);
      localStorage.setItem(KEYS.completedQuotes, JSON.stringify(Array.from(current)));
    }
  } catch {
    // Ignore storage quota or disabled localStorage
  }
}

export function isQuoteCompleted(id: number): boolean {
  return loadCompletedQuoteIds().includes(id);
}

export function clearCompletedQuotes(): void {
  try {
    localStorage.removeItem(KEYS.completedQuotes);
  } catch {
    // Ignore
  }
}

export interface LetterProgress {
  streak: number; // consecutive correct answers
  attempts: number;
  correct: number;
}

export type OffsetsProgress = Record<string, LetterProgress>;

export function loadOffsetsProgress(): OffsetsProgress {
  try {
    const raw = localStorage.getItem(KEYS.offsetsProgress);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveOffsetsProgress(p: OffsetsProgress): void {
  try {
    localStorage.setItem(KEYS.offsetsProgress, JSON.stringify(p));
  } catch {
    // Ignore
  }
}

export function resetOffsetsProgress(): void {
  try {
    localStorage.removeItem(KEYS.offsetsProgress);
  } catch {
    // Ignore
  }
}

export type OffsetsMode = 'letterToNum' | 'numToLetter';

export interface OffsetsModeScores {
  best60s: number;
  bestStreak: number;
}

export type OffsetsScoresByMode = Record<OffsetsMode, OffsetsModeScores>;

const DEFAULT_OFFSETS_SCORES: OffsetsScoresByMode = {
  letterToNum: { best60s: 0, bestStreak: 0 },
  numToLetter: { best60s: 0, bestStreak: 0 },
};

const SCORES_KEY = 'davinci_offsets_mode_scores';

export function loadOffsetsModeScores(mode: OffsetsMode): OffsetsModeScores {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (!raw) {
      // Migrate legacy single best streak to letterToNum if present
      const legacyStreak = loadBestStreak();
      return {
        best60s: 0,
        bestStreak: mode === 'letterToNum' ? legacyStreak : 0,
      };
    }
    const parsed = JSON.parse(raw) as Partial<OffsetsScoresByMode>;
    return {
      ...DEFAULT_OFFSETS_SCORES[mode],
      ...(parsed[mode] || {}),
    };
  } catch {
    return DEFAULT_OFFSETS_SCORES[mode];
  }
}

export function saveOffsetsModeScore(
  mode: OffsetsMode,
  update: Partial<OffsetsModeScores>
): OffsetsModeScores {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    const existing: OffsetsScoresByMode = raw
      ? { ...DEFAULT_OFFSETS_SCORES, ...JSON.parse(raw) }
      : {
          letterToNum: { best60s: 0, bestStreak: loadBestStreak() },
          numToLetter: { best60s: 0, bestStreak: 0 },
        };

    const current = existing[mode] || { best60s: 0, bestStreak: 0 };
    const merged: OffsetsModeScores = {
      best60s: Math.max(current.best60s, update.best60s ?? 0),
      bestStreak: Math.max(current.bestStreak, update.bestStreak ?? 0),
    };

    existing[mode] = merged;
    localStorage.setItem(SCORES_KEY, JSON.stringify(existing));
    return merged;
  } catch {
    return {
      best60s: update.best60s ?? 0,
      bestStreak: update.bestStreak ?? 0,
    };
  }
}

export interface CipherPracticeRecord {
  count: number;
  lastPracticed: number;
}

export type CipherPracticeHistory = Record<string, CipherPracticeRecord>;

export function loadCipherPracticeHistory(): CipherPracticeHistory {
  try {
    const raw = localStorage.getItem(KEYS.practiceHistory);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function recordCipherPractice(cipherId: string): void {
  try {
    const history = loadCipherPracticeHistory();
    const current = history[cipherId] || { count: 0, lastPracticed: 0 };
    history[cipherId] = {
      count: current.count + 1,
      lastPracticed: Date.now(),
    };
    localStorage.setItem(KEYS.practiceHistory, JSON.stringify(history));
  } catch {
    // Ignore
  }
}

/**
 * Option A (Two-Bucket Workout Selection):
 * Returns up to 2 ciphers for a workout round.
 * If both 'speed' and 'analysis' buckets have unlocked/implemented ciphers,
 * picks 1 speed cipher (sprint) + 1 analysis cipher (challenge).
 * Otherwise picks the top 2 least-recently-practiced ciphers.
 */
export function getNextWorkoutCiphers(
  unlockedCiphers: CipherType[],
  excludeCiphers: CipherType[] = []
): CipherType[] {
  // Only look at implemented drills that are not offsets and not in excludeCiphers
  const pool = unlockedCiphers.filter(
    id =>
      id !== 'offsets' &&
      IMPLEMENTED_DRILLS.some(d => d.id === id) &&
      !excludeCiphers.includes(id)
  );

  if (pool.length === 0) {
    // If exclusion left us empty, relax the exclusion
    const relaxed = unlockedCiphers.filter(
      id => id !== 'offsets' && IMPLEMENTED_DRILLS.some(d => d.id === id)
    );
    if (relaxed.length === 0) return [];
    return getNextWorkoutCiphers(relaxed, []);
  }

  const history = loadCipherPracticeHistory();

  // Sort by least practiced: lowest count first, then oldest lastPracticed timestamp
  const sortByLeastPracticed = (list: CipherType[]) => {
    return [...list].sort((a, b) => {
      const recA = history[a] || { count: 0, lastPracticed: 0 };
      const recB = history[b] || { count: 0, lastPracticed: 0 };
      if (recA.count !== recB.count) return recA.count - recB.count;
      return recA.lastPracticed - recB.lastPracticed;
    });
  };

  const speedList = pool.filter(id => getCipherBucket(id) === 'speed');
  const analysisList = pool.filter(id => getCipherBucket(id) === 'analysis');

  // If both buckets are available: 1 speed sprint + 1 analysis challenge
  if (speedList.length > 0 && analysisList.length > 0) {
    const chosenSpeed = sortByLeastPracticed(speedList)[0];
    const chosenAnalysis = sortByLeastPracticed(analysisList)[0];
    return [chosenSpeed, chosenAnalysis];
  }

  // If only one bucket has ciphers (e.g. current stage with only speed ciphers):
  const sorted = sortByLeastPracticed(pool);
  return sorted.slice(0, 2);
}

export function loadLastWarmupOffsetsMode(): OffsetsMode | null {
  try {
    const raw = localStorage.getItem(KEYS.lastWarmupOffsetsMode);
    return raw === 'numToLetter' || raw === 'letterToNum' ? raw : null;
  } catch {
    return null;
  }
}

export function saveLastWarmupOffsetsMode(mode: OffsetsMode): void {
  try {
    localStorage.setItem(KEYS.lastWarmupOffsetsMode, mode);
  } catch {
    // Ignore
  }
}

/**
 * Returns the prescribed offsets mode for a workout round:
 * - Alternates each round within a workout session (Round 1 vs Round 2)
 * - Alternates starting mode across daily sessions (flips last session's warm-up mode)
 */
export function getWorkoutOffsetsMode(round: number): OffsetsMode {
  const lastMode = loadLastWarmupOffsetsMode();
  // If first time ever, default round 1 to 'letterToNum'.
  // Otherwise, alternate from the last practiced mode for round 1.
  const round1Mode: OffsetsMode = lastMode === 'letterToNum' ? 'numToLetter' : 'letterToNum';

  return round % 2 === 1
    ? round1Mode
    : (round1Mode === 'letterToNum' ? 'numToLetter' : 'letterToNum');
}

