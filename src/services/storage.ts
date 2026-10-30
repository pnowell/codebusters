import type { UserSettings, DrillId, DrillScore, LetterProgress, DrillProgress } from '../types';
import {
  DEFAULT_UNLOCKED,
  isCipherType,
  IMPLEMENTED_DRILLS,
  getCipherBucket,
  type CipherType,
} from '../data/drills';

const KEYS = {
  settings: 'davinci_settings',
  completedQuotes: 'davinci_completed_quotes',
  drillProgress: 'davinci_drill_progress',
  drillScores: 'davinci_drill_scores',
  practiceHistory: 'davinci_cipher_practice_history',
  lastWarmupOffsetsMode: 'davinci_last_warmup_offsets_mode',
} as const;

export const DEFAULT_SETTINGS: UserSettings = {
  studentName: 'Decoder',
  unlockedCiphers: DEFAULT_UNLOCKED,
};

export type SyncDispatcher = (
  type: 'settings' | 'completedQuotes' | 'drillProgress' | 'drillScores' | 'practiceHistory',
  data: unknown
) => void;

let globalSyncDispatcher: SyncDispatcher | null = null;
let isSyncSuppressed = false;

export function registerSyncDispatcher(dispatcher: SyncDispatcher): void {
  globalSyncDispatcher = dispatcher;
}

export function withoutSyncDispatch<T>(fn: () => T): T {
  const prev = isSyncSuppressed;
  isSyncSuppressed = true;
  try {
    return fn();
  } finally {
    isSyncSuppressed = prev;
  }
}

function dispatchSync(
  type: 'settings' | 'completedQuotes' | 'drillProgress' | 'drillScores' | 'practiceHistory',
  data: unknown
) {
  if (isSyncSuppressed) return;
  globalSyncDispatcher?.(type, data);
}

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

export const saveSettings = (s: UserSettings) => {
  localStorage.setItem(KEYS.settings, JSON.stringify(s));
  dispatchSync('settings', s);
};

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
      const arr = Array.from(current);
      localStorage.setItem(KEYS.completedQuotes, JSON.stringify(arr));
      dispatchSync('completedQuotes', arr);
    }
  } catch {
    // Ignore storage quota or disabled localStorage
  }
}

export function saveCompletedQuoteIds(ids: number[]): void {
  try {
    const current = new Set(loadCompletedQuoteIds());
    let added = false;
    for (const id of ids) {
      if (!current.has(id)) {
        current.add(id);
        added = true;
      }
    }
    if (added) {
      const arr = Array.from(current);
      localStorage.setItem(KEYS.completedQuotes, JSON.stringify(arr));
      dispatchSync('completedQuotes', arr);
    }
  } catch {
    // Ignore
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

export type OffsetsMode = 'letterToNum' | 'numToLetter';

export function offsetsModeToDrillId(mode: OffsetsMode): DrillId {
  return mode === 'letterToNum' ? 'offsetsLetterToNum' : 'offsetsNumToLetter';
}

export function drillIdToOffsetsMode(id: DrillId): OffsetsMode | null {
  if (id === 'offsetsLetterToNum') return 'letterToNum';
  if (id === 'offsetsNumToLetter') return 'numToLetter';
  return null;
}

export type OffsetsProgress = Record<string, LetterProgress>;
export type OffsetsProgressByMode = Record<OffsetsMode, OffsetsProgress>;

export type DrillProgressRecord = Partial<Record<DrillId, DrillProgress>>;
export type DrillScoresRecord = Partial<Record<DrillId, DrillScore>>;

export function sanitizeProgressDict(raw: unknown): DrillProgress {
  if (!raw || typeof raw !== 'object') return {};
  const clean: DrillProgress = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v && typeof v === 'object') {
      const item = v as Partial<LetterProgress>;
      clean[k] = {
        streak: typeof item.streak === 'number' ? item.streak : 0,
        attempts: typeof item.attempts === 'number' ? item.attempts : 0,
        correct: typeof item.correct === 'number' ? item.correct : 0,
      };
    }
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Generalized Drill Scores
// ---------------------------------------------------------------------------

export function loadAllDrillScores(): DrillScoresRecord {
  try {
    const raw = localStorage.getItem(KEYS.drillScores);
    if (raw) {
      return JSON.parse(raw) as DrillScoresRecord;
    }
    return {};
  } catch {
    return {};
  }
}

export function loadDrillScore(drillId: DrillId): DrillScore {
  const all = loadAllDrillScores();
  return all[drillId] || { best60s: 0, bestStreak: 0 };
}

export function saveDrillScore(
  drillId: DrillId,
  update: Partial<DrillScore>
): DrillScore {
  try {
    const all = loadAllDrillScores();
    const current = all[drillId] || { best60s: 0, bestStreak: 0 };
    const merged: DrillScore = {
      best60s: Math.max(current.best60s, update.best60s ?? 0),
      bestStreak: Math.max(current.bestStreak, update.bestStreak ?? 0),
    };
    all[drillId] = merged;
    localStorage.setItem(KEYS.drillScores, JSON.stringify(all));

    dispatchSync('drillScores', { drillId, score: merged, allScores: all });
    return merged;
  } catch {
    return {
      best60s: update.best60s ?? 0,
      bestStreak: update.bestStreak ?? 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Generalized Drill Progress
// ---------------------------------------------------------------------------

export function loadAllDrillProgress(): DrillProgressRecord {
  try {
    const raw = localStorage.getItem(KEYS.drillProgress);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const clean: DrillProgressRecord = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          clean[k as DrillId] = sanitizeProgressDict(v);
        }
        return clean;
      }
    }
    return {};
  } catch {
    return {};
  }
}

export function loadDrillProgress(drillId: DrillId): DrillProgress {
  const all = loadAllDrillProgress();
  return all[drillId] || {};
}

export function saveDrillProgress(drillId: DrillId, p: DrillProgress): void {
  try {
    const all = loadAllDrillProgress();
    all[drillId] = sanitizeProgressDict(p);
    localStorage.setItem(KEYS.drillProgress, JSON.stringify(all));
    dispatchSync('drillProgress', all);
  } catch {
    // Ignore
  }
}

export function saveAllDrillProgress(all: DrillProgressRecord): void {
  try {
    localStorage.setItem(KEYS.drillProgress, JSON.stringify(all));
    dispatchSync('drillProgress', all);
  } catch {
    // Ignore
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible Offsets Drill Wrappers
// ---------------------------------------------------------------------------

export type OffsetsModeScores = DrillScore;
export type OffsetsScoresByMode = Record<OffsetsMode, OffsetsModeScores>;

export function loadOffsetsModeScores(mode: OffsetsMode): OffsetsModeScores {
  return loadDrillScore(offsetsModeToDrillId(mode));
}

export function saveOffsetsModeScore(
  mode: OffsetsMode,
  update: Partial<OffsetsModeScores>
): OffsetsModeScores {
  return saveDrillScore(offsetsModeToDrillId(mode), update);
}

export function loadAllOffsetsProgress(): OffsetsProgressByMode {
  const all = loadAllDrillProgress();
  return {
    letterToNum: all.offsetsLetterToNum || {},
    numToLetter: all.offsetsNumToLetter || {},
  };
}

export function loadOffsetsProgress(mode: OffsetsMode = 'letterToNum'): OffsetsProgress {
  return loadDrillProgress(offsetsModeToDrillId(mode));
}

export function saveOffsetsProgress(mode: OffsetsMode, p: OffsetsProgress): void {
  saveDrillProgress(offsetsModeToDrillId(mode), p);
}

export function saveAllOffsetsProgress(all: OffsetsProgressByMode): void {
  const drillProgress = loadAllDrillProgress();
  drillProgress.offsetsLetterToNum = sanitizeProgressDict(all.letterToNum);
  drillProgress.offsetsNumToLetter = sanitizeProgressDict(all.numToLetter);
  saveAllDrillProgress(drillProgress);
}

export function resetOffsetsProgress(mode?: OffsetsMode): void {
  try {
    if (!mode) {
      const drillProgress = loadAllDrillProgress();
      delete drillProgress.offsetsLetterToNum;
      delete drillProgress.offsetsNumToLetter;
      saveAllDrillProgress(drillProgress);
    } else {
      saveDrillProgress(offsetsModeToDrillId(mode), {});
    }
  } catch {
    // Ignore
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
    dispatchSync('practiceHistory', history);
  } catch {
    // Ignore
  }
}

export function saveCipherPracticeHistory(history: CipherPracticeHistory): void {
  try {
    localStorage.setItem(KEYS.practiceHistory, JSON.stringify(history));
    dispatchSync('practiceHistory', history);
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

