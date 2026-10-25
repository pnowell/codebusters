import type { UserSettings } from '../types';
import { DEFAULT_UNLOCKED, isCipherType } from '../data/drills';

const KEYS = {
  settings: 'davinci_settings',
  offsetsBestStreak: 'davinci_offsets_best_streak',
  completedQuotes: 'davinci_completed_quotes',
  offsetsProgress: 'davinci_offsets_progress',
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

