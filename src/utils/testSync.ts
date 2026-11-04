import type {
  MemberPresence,
  QuestionResult,
  QuestionWorkspace,
  Quote,
  TestAttempt,
  TestAttemptStatus,
  TestCohort,
  TestEvaluationResult,
  TestPacket,
  TestQuestion,
} from '../types';
import { evaluateSolution, isLetter } from './ciphers';

export interface ResolvedCohortInfo {
  cohort: TestCohort | null;
  memberUids: string[];
  attemptId: string;
  teamName?: string;
  isCollaborative: boolean;
}

export interface PendingCellOp {
  qIdx: number;
  charIdx: number;
  value: string;
  seq: number;
  editedAt: number;
  editedBy?: string;
}

/** Maximum age (ms) before a teammate's tab presence entry is considered stale */
export const PRESENCE_STALE_MS = 90_000;

/**
 * Sanitizes and deduplicates an array of Firebase Auth UIDs in deterministic sorted order.
 */
export function normalizeUidList(uids: readonly string[] | undefined): string[] {
  if (!Array.isArray(uids)) return [];
  const cleaned = uids
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => id.length > 0 && id !== 'student');
  return Array.from(new Set(cleaned)).sort();
}

/**
 * Resolves the cohort (or solo fallback) and deterministic Firestore attemptId
 * for a user on a given TestPacket.
 */
export function resolveUserCohort(
  testPacket: TestPacket,
  currentUid: string | undefined
): ResolvedCohortInfo {
  const safeUid = currentUid?.trim() || 'student';

  if (safeUid !== 'student' && Array.isArray(testPacket.cohorts)) {
    for (const cohort of testPacket.cohorts) {
      const normalizedMembers = normalizeUidList(cohort.studentUids);
      if (normalizedMembers.includes(safeUid)) {
        return {
          cohort: {
            ...cohort,
            studentUids: normalizedMembers,
          },
          memberUids: normalizedMembers,
          attemptId: `${testPacket.testId}__${normalizedMembers.join('_')}`,
          teamName: cohort.name?.trim() || undefined,
          isCollaborative: normalizedMembers.length > 1,
        };
      }
    }
  }

  return {
    cohort: null,
    memberUids: [safeUid],
    attemptId: `${testPacket.testId}__${safeUid}`,
    teamName: undefined,
    isCollaborative: false,
  };
}

/**
 * Computes the deterministic attemptId for a specific TestCohort on a test.
 */
export function getCohortAttemptId(testId: string, studentUids: readonly string[]): string {
  const sorted = normalizeUidList(studentUids);
  if (sorted.length === 0) return `${testId}__empty`;
  return `${testId}__${sorted.join('_')}`;
}

function sanitizeLetterInput(val: unknown): string {
  if (typeof val !== 'string' || val.length === 0) return '';
  const upper = val.slice(-1).toUpperCase();
  return isLetter(upper) ? upper : '';
}

/**
 * Reconstructs typed QuestionWorkspace objects for all questions on a test from raw
 * Firestore workspace data (supporting both per-cell `inputs` maps and legacy `userInputs` arrays).
 */
export function deserializeWorkspacesFromFirestore(
  rawWorkspaces: unknown,
  questions: readonly TestQuestion[],
  getQuote: (quoteId: number) => Quote | undefined
): Record<number, QuestionWorkspace> {
  const rawMap =
    rawWorkspaces && typeof rawWorkspaces === 'object'
      ? (rawWorkspaces as Record<string, unknown>)
      : {};

  const result: Record<number, QuestionWorkspace> = {};

  questions.forEach((q, idx) => {
    const quote = getQuote(q.quoteId);
    const chars = quote ? quote.quote.toUpperCase().split('') : [];

    const rawEntry = (rawMap[String(idx)] ?? rawMap[idx as unknown as string]) as
      | Record<string, unknown>
      | undefined;

    const rawInputsMap =
      rawEntry?.inputs && typeof rawEntry.inputs === 'object'
        ? (rawEntry.inputs as Record<string, unknown>)
        : null;
    const rawInputsArr = Array.isArray(rawEntry?.userInputs)
      ? (rawEntry.userInputs as unknown[])
      : null;

    let filledAlpha = 0;
    let totalAlpha = 0;
    const inputsRecord: Record<string, string> = {};

    const userInputs = chars.map((ch, cIdx) => {
      if (!isLetter(ch)) {
        return ch;
      }
      totalAlpha += 1;
      const rawVal = rawInputsMap
        ? rawInputsMap[String(cIdx)]
        : rawInputsArr
          ? rawInputsArr[cIdx]
          : '';
      const clean = sanitizeLetterInput(rawVal);
      if (clean !== '') {
        filledAlpha += 1;
        inputsRecord[String(cIdx)] = clean;
      }
      return clean;
    });

    const completed = totalAlpha > 0 && filledAlpha === totalAlpha;
    const lastEditedAt =
      typeof rawEntry?.lastEditedAt === 'number' ? rawEntry.lastEditedAt : 0;
    const lastEditedBy =
      typeof rawEntry?.lastEditedBy === 'string' ? rawEntry.lastEditedBy : undefined;

    result[idx] = {
      userInputs,
      inputs: inputsRecord,
      completed,
      lastEditedAt,
      ...(lastEditedBy ? { lastEditedBy } : {}),
    };
  });

  return result;
}

/**
 * Serializes in-memory workspaces into compact Firestore map structures (`inputs` keyed by charIdx)
 * without arrays so concurrent dot-path updates never overwrite sibling cells.
 */
export function serializeWorkspacesForFirestore(
  workspaces: Record<number, QuestionWorkspace>,
  questions: readonly TestQuestion[],
  getQuote: (quoteId: number) => Quote | undefined
): Record<string, Record<string, unknown>> {
  const serialized: Record<string, Record<string, unknown>> = {};

  questions.forEach((q, idx) => {
    const ws = workspaces[idx];
    if (!ws) return;

    const quote = getQuote(q.quoteId);
    const chars = quote ? quote.quote.toUpperCase().split('') : [];
    const inputs: Record<string, string> = {};
    let filledAlpha = 0;
    let totalAlpha = 0;

    chars.forEach((ch, cIdx) => {
      if (!isLetter(ch)) return;
      totalAlpha += 1;
      const clean = sanitizeLetterInput(ws.userInputs[cIdx]);
      if (clean !== '') {
        inputs[String(cIdx)] = clean;
        filledAlpha += 1;
      }
    });

    const entry: Record<string, unknown> = {
      inputs,
      completed: totalAlpha > 0 && filledAlpha === totalAlpha,
      lastEditedAt: ws.lastEditedAt || 0,
    };
    if (ws.lastEditedBy) {
      entry.lastEditedBy = ws.lastEditedBy;
    }
    serialized[String(idx)] = entry;
  });

  return serialized;
}

/**
 * Computes character-level diffs between two `userInputs` arrays for a single question.
 */
export function diffQuestionInputs(
  prevInputs: readonly string[],
  nextInputs: readonly string[]
): Array<{ charIdx: number; value: string }> {
  const maxLen = Math.max(prevInputs.length, nextInputs.length);
  const diffs: Array<{ charIdx: number; value: string }> = [];

  for (let i = 0; i < maxLen; i += 1) {
    const prev = prevInputs[i] ?? '';
    const next = nextInputs[i] ?? '';
    if (prev !== next) {
      diffs.push({ charIdx: i, value: sanitizeLetterInput(next) });
    }
  }

  return diffs;
}

/**
 * Overlays still-unflushed / in-flight local cell edits onto a remote workspace snapshot
 * so rapid local typing never flickers or drops characters when earlier snapshots arrive.
 */
export function applyPendingCellOps(
  baseWorkspaces: Record<number, QuestionWorkspace>,
  pendingOps: Iterable<PendingCellOp>,
  questions: readonly TestQuestion[],
  getQuote: (quoteId: number) => Quote | undefined
): Record<number, QuestionWorkspace> {
  const opsList = Array.from(pendingOps);
  if (opsList.length === 0) return baseWorkspaces;

  const cloned: Record<number, QuestionWorkspace> = { ...baseWorkspaces };
  const touchedQuestions = new Set<number>();

  for (const op of opsList) {
    const existing = cloned[op.qIdx];
    if (!existing) continue;
    if (!touchedQuestions.has(op.qIdx)) {
      cloned[op.qIdx] = {
        ...existing,
        userInputs: [...existing.userInputs],
        inputs: { ...(existing.inputs ?? {}) },
      };
      touchedQuestions.add(op.qIdx);
    }
    const target = cloned[op.qIdx];
    if (op.charIdx >= 0 && op.charIdx < target.userInputs.length) {
      target.userInputs[op.charIdx] = op.value;
      if (target.inputs) {
        if (op.value) {
          target.inputs[String(op.charIdx)] = op.value;
        } else {
          delete target.inputs[String(op.charIdx)];
        }
      }
      target.lastEditedAt = Math.max(target.lastEditedAt, op.editedAt);
      if (op.editedBy) {
        target.lastEditedBy = op.editedBy;
      }
    }
  }

  for (const qIdx of touchedQuestions) {
    const q = questions[qIdx];
    const ws = cloned[qIdx];
    if (!q || !ws) continue;
    const quote = getQuote(q.quoteId);
    const chars = quote ? quote.quote.toUpperCase().split('') : [];
    let totalAlpha = 0;
    let filledAlpha = 0;
    chars.forEach((ch, idx) => {
      if (isLetter(ch)) {
        totalAlpha += 1;
        if (ws.userInputs[idx]) filledAlpha += 1;
      }
    });
    ws.completed = totalAlpha > 0 && filledAlpha === totalAlpha;
  }

  return cloned;
}

/**
 * Evaluates a full TestPacket against normalized workspaces under Science Olympiad Division A rules.
 */
export function evaluateTestPacket(
  testPacket: TestPacket,
  workspaces: Record<number, QuestionWorkspace>,
  startedAt: number,
  getQuote: (quoteId: number) => Quote | undefined,
  now: number = Date.now()
): TestEvaluationResult {
  const questionResults: QuestionResult[] = testPacket.questions.map((q, idx) => {
    const quote = getQuote(q.quoteId);
    const targetPlaintext = quote ? quote.quote : '';
    const ws = workspaces[idx];
    const studentInput = ws ? ws.userInputs.join('') : '';

    const evalRes = evaluateSolution(targetPlaintext, studentInput);
    let pointsEarned = 0;
    if (evalRes.scoreTier === 'full') {
      pointsEarned = q.points;
    } else if (evalRes.scoreTier === 'half') {
      pointsEarned = Math.round(q.points / 2);
    }

    return {
      questionNumber: q.questionNumber,
      cipher: q.cipher,
      quoteId: q.quoteId,
      pointsEarned,
      maxPoints: q.points,
      errorCount: evalRes.errorCount,
      scoreTier: evalRes.scoreTier,
      isTiebreaker: Boolean(q.isTiebreaker),
      targetPlaintext,
      studentInput,
    };
  });

  const totalScore = questionResults.reduce((sum, q) => sum + q.pointsEarned, 0);
  const maxPossibleScore = questionResults.reduce((sum, q) => sum + q.maxPoints, 0);
  const timeSpentSeconds =
    startedAt > 0
      ? Math.min(testPacket.timeLimitSeconds, Math.max(0, Math.round((now - startedAt) / 1000)))
      : 0;

  return {
    totalScore,
    maxPossibleScore,
    timeSpentSeconds,
    questions: questionResults,
  };
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function normalizePresenceMap(raw: unknown): Record<string, MemberPresence> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, MemberPresence> = {};
  for (const [uid, val] of Object.entries(raw as Record<string, unknown>)) {
    if (val && typeof val === 'object') {
      const entry = val as { activeQIndex?: unknown; updatedAt?: unknown };
      if (typeof entry.activeQIndex === 'number' && typeof entry.updatedAt === 'number') {
        out[uid] = {
          activeQIndex: entry.activeQIndex,
          updatedAt: entry.updatedAt,
        };
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Normalizes a raw Firestore TestAttempt document into a clean TestAttempt object.
 * If `questions` and `getQuote` are provided, workspaces are fully hydrated with `userInputs`.
 */
export function normalizeTestAttempt(
  raw: Record<string, unknown>,
  fallbackAttemptId: string,
  questions?: readonly TestQuestion[],
  getQuote?: (quoteId: number) => Quote | undefined
): TestAttempt {
  const statusRaw = raw.status;
  const status: TestAttemptStatus =
    statusRaw === 'lobby' ||
    statusRaw === 'in_progress' ||
    statusRaw === 'submitted' ||
    statusRaw === 'expired'
      ? statusRaw
      : 'in_progress';

  const workspaces: Record<number, QuestionWorkspace> =
    questions && getQuote
      ? deserializeWorkspacesFromFirestore(raw.workspaces, questions, getQuote)
      : ((raw.workspaces as Record<number, QuestionWorkspace> | undefined) ?? {});

  return {
    attemptId: typeof raw.attemptId === 'string' && raw.attemptId ? raw.attemptId : fallbackAttemptId,
    testId: typeof raw.testId === 'string' ? raw.testId : '',
    cohortId: typeof raw.cohortId === 'string' ? raw.cohortId : undefined,
    teamName: typeof raw.teamName === 'string' ? raw.teamName : undefined,
    studentUids: toStringArray(raw.studentUids),
    readyUids: toStringArray(raw.readyUids),
    submitReadyUids: toStringArray(raw.submitReadyUids),
    presence: normalizePresenceMap(raw.presence),
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : 0,
    submittedAt: typeof raw.submittedAt === 'number' ? raw.submittedAt : undefined,
    status,
    workspaces,
    results: raw.results as TestEvaluationResult | undefined,
  };
}

/**
 * Returns active teammate UIDs (excluding `currentUid`) who are currently viewing `tabIndex`
 * and whose presence heartbeat is fresh.
 */
export function getActiveTeammateUidsForTab(
  presence: Record<string, MemberPresence> | undefined,
  memberUids: readonly string[],
  currentUid: string,
  tabIndex: number,
  now: number = Date.now()
): string[] {
  if (!presence) return [];
  return memberUids.filter((uid) => {
    if (uid === currentUid) return false;
    const entry = presence[uid];
    if (!entry) return false;
    return entry.activeQIndex === tabIndex && now - entry.updatedAt <= PRESENCE_STALE_MS;
  });
}
