import type {
  UserSettings,
  DrillId,
  DrillScore,
  DrillHistoryEntry,
  DrillSessionSample,
  LetterProgress,
  DrillProgress,
  OffsetsMode,
} from '../types';
export type { OffsetsMode };
import {
  DEFAULT_UNLOCKED,
  isCipherType,
} from '../data/drills';

const KEYS = {
  settings: 'davinci_settings',
  completedQuotes: 'davinci_completed_quotes',
  drillProgress: 'davinci_drill_progress',
  drillScores: 'davinci_drill_scores',
  drillHistory: 'davinci_drill_history',
  practiceHistory: 'davinci_cipher_practice_history',
} as const;

export const MAX_RECENT_DRILL_SESSIONS = 5;

const DEFAULT_SETTINGS: UserSettings = {
  studentName: 'Decoder',
  unlockedCiphers: DEFAULT_UNLOCKED,
};

type SyncEventType =
  | 'settings'
  | 'completedQuotes'
  | 'drillProgress'
  | 'drillScores'
  | 'drillHistory'
  | 'practiceHistory';

type SyncDispatcher = (type: SyncEventType, data: unknown) => void;

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

function dispatchSync(type: SyncEventType, data: unknown) {
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

export function offsetsModeToDrillId(mode: OffsetsMode): DrillId {
  return mode === 'letterToNum' ? 'offsetsLetterToNum' : 'offsetsNumToLetter';
}

export type DrillProgressRecord = Partial<Record<DrillId, DrillProgress>>;
export type DrillScoresRecord = Partial<Record<DrillId, DrillScore>>;
export type DrillHistoryRecord = Partial<Record<DrillId, DrillHistoryEntry>>;

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
// Generalized Drill Activity & Recent 60s History
// ---------------------------------------------------------------------------

export function sanitizeDrillHistoryEntry(raw: unknown): DrillHistoryEntry {
  if (!raw || typeof raw !== 'object') {
    return { recentSessions: [], lastPracticed: 0 };
  }
  const obj = raw as Partial<DrillHistoryEntry>;
  const sessions: DrillSessionSample[] = [];

  if (Array.isArray(obj.recentSessions)) {
    for (const s of obj.recentSessions) {
      if (
        s &&
        typeof s === 'object' &&
        typeof s.score60s === 'number' &&
        Number.isFinite(s.score60s) &&
        s.score60s >= 0 &&
        typeof s.timestamp === 'number' &&
        Number.isFinite(s.timestamp) &&
        s.timestamp > 0
      ) {
        sessions.push({
          score60s: Math.round(s.score60s),
          timestamp: Math.round(s.timestamp),
        });
      }
    }
  }

  sessions.sort((a, b) => a.timestamp - b.timestamp);
  const trimmed = sessions.slice(-MAX_RECENT_DRILL_SESSIONS);
  const latestSampleTs = trimmed.length > 0 ? trimmed[trimmed.length - 1].timestamp : 0;
  const rawLast =
    typeof obj.lastPracticed === 'number' && Number.isFinite(obj.lastPracticed)
      ? Math.max(0, Math.round(obj.lastPracticed))
      : 0;

  return {
    recentSessions: trimmed,
    lastPracticed: Math.max(rawLast, latestSampleTs),
  };
}

const VALID_DRILL_IDS: ReadonlySet<string> = new Set<DrillId>([
  'offsetsLetterToNum',
  'offsetsNumToLetter',
  'atbash',
  'pigpen',
  'galactic',
  'knights',
  'tap',
]);

export function sanitizeDrillHistoryRecord(raw: unknown): DrillHistoryRecord {
  if (!raw || typeof raw !== 'object') return {};
  const clean: DrillHistoryRecord = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_DRILL_IDS.has(k)) continue;
    const entry = sanitizeDrillHistoryEntry(v);
    if (entry.lastPracticed > 0 || entry.recentSessions.length > 0) {
      clean[k as DrillId] = entry;
    }
  }
  return clean;
}

export function loadAllDrillHistory(): DrillHistoryRecord {
  try {
    const raw = localStorage.getItem(KEYS.drillHistory);
    if (!raw) return {};
    return sanitizeDrillHistoryRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveAllDrillHistory(all: DrillHistoryRecord): void {
  try {
    const clean = sanitizeDrillHistoryRecord(all);
    localStorage.setItem(KEYS.drillHistory, JSON.stringify(clean));
    dispatchSync('drillHistory', clean);
  } catch {
    // Ignore
  }
}

export function recordDrillSession(
  drillId: DrillId,
  session: {
    sessionBest60s: number;
    elapsedMs: number;
    attempts: number;
    forceActivity?: boolean;
  }
): void {
  const { sessionBest60s, elapsedMs, attempts, forceActivity = false } = session;
  if (!forceActivity && attempts < 5) {
    return;
  }

  try {
    const now = Date.now();
    const all = loadAllDrillHistory();
    const current = all[drillId] || { recentSessions: [], lastPracticed: 0 };
    const currentMean =
      current.recentSessions.length > 0
        ? current.recentSessions.reduce((sum, s) => sum + s.score60s, 0) /
          current.recentSessions.length
        : 0;

    const qualifiesFor60sWindow =
      attempts >= 5 &&
      (elapsedMs >= 50_000 ||
        (current.recentSessions.length === 0 && elapsedMs >= 30_000) ||
        sessionBest60s >= currentMean);

    const updatedSessions = qualifiesFor60sWindow
      ? [
          ...current.recentSessions,
          { score60s: Math.max(0, Math.round(sessionBest60s)), timestamp: now },
        ].slice(-MAX_RECENT_DRILL_SESSIONS)
      : current.recentSessions;

    all[drillId] = {
      recentSessions: updatedSessions,
      lastPracticed: Math.max(current.lastPracticed, now),
    };

    saveAllDrillHistory(all);
  } catch {
    // Ignore
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

export function resetDrillProgress(drillId: DrillId): void {
  saveDrillProgress(drillId, {});
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
