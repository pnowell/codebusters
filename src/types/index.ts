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

export type DrillId =
  | 'offsetsLetterToNum'
  | 'offsetsNumToLetter'
  | 'atbash'
  | 'pigpen'
  | 'galactic'
  | 'knights'
  | 'tap';

export interface DrillScore {
  best60s: number;
  bestStreak: number;
}

export interface DrillSessionSample {
  score60s: number;
  timestamp: number;
}

export interface DrillHistoryEntry {
  recentSessions: DrillSessionSample[];
  lastPracticed: number;
}

export interface LetterProgress {
  streak: number;
  attempts: number;
  correct: number;
}

export type DrillProgress = Record<string, LetterProgress>;

export interface UserProfile {
  uid: string;
  email: string;
  unlockedCiphers: CipherType[];
  drillProgress?: Partial<Record<DrillId, DrillProgress>>;
  drillHistory?: Partial<Record<DrillId, DrillHistoryEntry>>;
  completedQuotes?: number[];
  practiceHistory?: Record<string, { count: number; lastPracticed: number }>;
  lastActiveAt?: unknown;
}

export interface QuoteFlag {
  quoteId: number;
  note?: string;
  updatedAt?: unknown;
}

export interface TestQuestion {
  questionNumber: number; // 1-indexed (1, 2, 3...)
  cipher: LookupCipherType;
  quoteId: number;
  points: number;
  isTiebreaker?: boolean;
  description?: string;
}

export interface TestCohort {
  id: string;
  name?: string;
  studentUids: string[];
}

export interface TestPacket {
  testId: string;
  title: string;
  description: string;
  timeLimitSeconds: number;
  active: boolean;
  createdAt?: unknown;
  questions: TestQuestion[];
  cohorts?: TestCohort[];
}

export interface QuestionWorkspace {
  userInputs: string[];
  inputs?: Record<string, string>;
  completed: boolean;
  lastEditedAt: number;
  lastEditedBy?: string;
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
  drillScores?: Partial<Record<DrillId, DrillScore>>;
  updatedAt?: unknown;
}

export type TestAttemptStatus = 'lobby' | 'in_progress' | 'submitted' | 'expired';

export interface MemberPresence {
  activeQIndex: number;
  updatedAt: number;
}

export interface TestAttempt {
  attemptId: string;
  testId: string;
  studentUids: string[];
  readyUids?: string[];
  submitReadyUids?: string[];
  presence?: Record<string, MemberPresence>;
  startedAt: number;
  submittedAt?: number;
  status: TestAttemptStatus;
  workspaces: Record<number, QuestionWorkspace>;
  results?: TestEvaluationResult;
}

export type OffsetsMode = 'letterToNum' | 'numToLetter';

export interface WorkoutStepResult {
  cipherId: CipherType;
  title: string;
  isWarmup?: boolean;
  timeSeconds?: number;
  accuracy?: number;
  author?: string;
  warmup60s?: number;
  offsetsMode?: OffsetsMode;
}

export interface WorkoutSummaryData {
  round: number;
  totalTimeSeconds: number;
  results: WorkoutStepResult[];
}

export interface WorkoutStepContext {
  round: number;
  stepIndex: number;
  totalSteps: number;
  offsetsMode?: OffsetsMode;
  nextCipherTitle?: string;
  isLastStep: boolean;
  onAdvance: (stepResult?: Partial<WorkoutStepResult>) => void;
}

