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
