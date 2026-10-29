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
  role: 'student' | 'teacher';
  addedAt?: unknown;
  active: boolean;
}

export interface UserProfile {
  uid: string;
  email: string;
  unlockedCiphers: CipherType[];
  settings?: {
    soundEffects?: boolean;
    highContrast?: boolean;
  };
  offsetsProgress?: Record<string, unknown>;
  completedQuotes?: number[];
  practiceHistory?: Record<string, { count: number; lastPracticed: number }>;
  lastActiveAt?: unknown;
}

export interface TestCipherParams {
  caesarShift?: number;
  vigenereKey?: string;
  alphabetMapping?: Record<string, string>;
  hint?: string;
}

export interface TestQuestion {
  questionNumber: number; // 1-indexed (1, 2, 3...)
  cipher: CipherType;
  quoteId: number;
  points: number;
  isTiebreaker?: boolean;
  description?: string;
  params?: TestCipherParams;
}

export interface TestPacket {
  testId: string;
  title: string;
  description: string;
  timeLimitSeconds: number;
  active: boolean;
  createdAt?: unknown;
  questions: TestQuestion[];
}

export interface QuestionWorkspace {
  userInputs: string[];
  completed: boolean;
  lastEditedAt: number;
}

export interface QuestionResult {
  questionNumber: number;
  cipher: CipherType;
  quoteId: number;
  pointsEarned: number;
  maxPoints: number;
  errorCount: number;
  scoreTier: ScoreTier;
  isTiebreaker: boolean;
  targetPlaintext: string;
  studentInput: string;
}

export interface TestEvaluationResult {
  totalScore: number;
  maxPossibleScore: number;
  timeSpentSeconds: number;
  questions: QuestionResult[];
}

export interface PublicProfile {
  uid: string;
  displayName: string;
  role: 'student' | 'teacher';
  offsetsScores?: Record<string, { best60s: number; bestStreak: number }>;
  updatedAt?: unknown;
}

export interface TestAttempt {
  attemptId: string;
  testId: string;
  studentUids: string[];
  teamName?: string;
  startedAt: number;
  submittedAt?: number;
  status: 'in_progress' | 'submitted' | 'expired';
  workspaces: Record<number, QuestionWorkspace>;
  results?: TestEvaluationResult;
}
