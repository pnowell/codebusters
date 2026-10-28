import type { CipherType, LookupCipherType } from '../data/drills';
export type { CipherType, LookupCipherType };

export type QuoteCategory =
  | 'kid_joke'
  | 'kid_science'
  | 'kid_book'
  | 'kid_movie'
  | 'kid_lyric'
  | 'general';

export type CryptanalysisTier = 'easy' | 'medium' | 'hard' | 'short_drill';

export interface Quote {
  id: number;
  quote: string;
  author: string;
  length: number;
  minWordLength: number;
  unique: number;
  chi: number;
  hasApostrophe: boolean;
  hasStandardApostrophe?: boolean;
  hasTrickyApostrophe?: boolean;
  hasOneLetter: boolean;
  isArchaic?: boolean;
  isMisspelled?: boolean;
  category?: QuoteCategory;
  tags?: string[];
  tier: CryptanalysisTier;
}

export interface UserSettings {
  studentName: string;
  unlockedCiphers: CipherType[];
}

export type ScoreTier = 'full' | 'half' | 'none';

export interface EvaluationResult {
  totalChars: number;
  correctChars: number;
  errorCount: number;
  scoreTier: ScoreTier; // 0-2 = full, 3-4 = half, 5+ = none
  isComplete: boolean;
}

export interface AllowedUser {
  email: string;
  displayName: string;
  role: 'student' | 'coach' | 'teacher';
  addedAt?: unknown;
  active: boolean;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: 'student' | 'coach' | 'teacher';
  unlockedCiphers: CipherType[];
  settings?: {
    soundEffects?: boolean;
    highContrast?: boolean;
  };
  offsetsProgress?: Record<string, { streak: number; attempts: number; correct: number; avgLatencyMs?: number }>;
  offsetsScores?: Record<string, { best60s: number; bestStreak: number }>;
  completedQuotes?: number[];
  practiceHistory?: Record<string, { count: number; lastPracticed: number }>;
  lastActiveAt?: unknown;
}
