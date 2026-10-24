export type CipherType =
  | 'offsets'
  | 'atbash'
  | 'pigpen'
  | 'galactic'
  | 'caesar'
  | 'tap'
  | 'knights'
  | 'vigenere'
  | 'aristocrat';

export interface Quote {
  id: number;
  quote: string;
  author: string;
  length: number;
  minWordLength: number;
  unique: number;
  chi: number;
  hasApostrophe: boolean;
  hasOneLetter: boolean;
  tier: 'easy' | 'medium' | 'hard';
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
