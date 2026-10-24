import type { UserSettings } from '../types';
import { DEFAULT_UNLOCKED, isCipherType } from '../data/drills';

const KEYS = {
  settings: 'davinci_settings',
  offsetsBestStreak: 'davinci_offsets_best_streak',
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
