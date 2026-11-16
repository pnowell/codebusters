import type {
  AristocratCornerTuple,
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
import {
  ALPHABET_LETTERS,
  aristocratEncryptText,
  deriveReplacementsFromInputs,
  deserializeCornerTuple,
  deterministicAristocratAlphabet,
  isValidAristocratAlphabet,
  serializeCornerTuple,
} from './aristocrat';
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
  row?: 'plain' | 'key';
  fieldKey?: string;
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

/**
 * Resolves the live team display name from `testPacket.cohorts` for an exact member UID group.
 */
export function resolveTeamNameForMembers(
  testPacket: TestPacket,
  studentUids: readonly string[] | undefined
): string | undefined {
  const target = normalizeUidList(studentUids);
  if (target.length === 0 || !Array.isArray(testPacket.cohorts)) return undefined;

  for (const cohort of testPacket.cohorts) {
    const members = normalizeUidList(cohort.studentUids);
    if (
      members.length === target.length &&
      members.every((uid, idx) => uid === target[idx])
    ) {
      return cohort.name?.trim() || undefined;
    }
  }
  return undefined;
}

function sanitizeLetterInput(val: unknown): string {
  if (typeof val !== 'string' || val.length === 0) return '';
  const upper = val.slice(-1).toUpperCase();
  return isLetter(upper) ? upper : '';
}

export function getCellInputFieldKey(
  charIdx: number,
  row: 'plain' | 'key' = 'plain'
): string {
  return row === 'key' ? `k${charIdx}` : String(charIdx);
}

export function resolveQuestionAristocratAlphabet(
  q: TestQuestion,
  qIdx: number
): string {
  return isValidAristocratAlphabet(q.aristocratAlphabet)
    ? q.aristocratAlphabet
    : deterministicAristocratAlphabet(q.quoteId + qIdx);
}

/**
 * Strips all Aristocrat corner candidate notes across all workspaces (invoked upon submission).
 */
export function clearCornersInWorkspaces(
  workspaces: Record<number, QuestionWorkspace>
): Record<number, QuestionWorkspace> {
  const cleaned: Record<number, QuestionWorkspace> = {};
  for (const [key, ws] of Object.entries(workspaces)) {
    const qIdx = Number(key);
    if (!ws) continue;
    const nextInputs = ws.inputs
      ? Object.fromEntries(
          Object.entries(ws.inputs).filter(([k]) => !k.startsWith('cor_'))
        )
      : undefined;
    const nextAuthors = ws.inputAuthors
      ? Object.fromEntries(
          Object.entries(ws.inputAuthors).filter(([k]) => !k.startsWith('cor_'))
        )
      : undefined;
    cleaned[qIdx] = {
      ...ws,
      ...(ws.aristocratCorners !== undefined ? { aristocratCorners: {} } : {}),
      ...(nextInputs ? { inputs: nextInputs } : {}),
      ...(nextAuthors ? { inputAuthors: nextAuthors } : {}),
    };
  }
  return cleaned;
}

function sanitizeInputAuthorsMap(
  raw: unknown,
  validInputKeys: ReadonlySet<string>,
  clearCorners?: boolean
): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [fieldKey, uidVal] of Object.entries(
    raw as Record<string, unknown>
  )) {
    if (clearCorners && fieldKey.startsWith('cor_')) continue;
    if (!validInputKeys.has(fieldKey)) continue;
    if (typeof uidVal === 'string' && uidVal.trim().length > 0 && uidVal.length <= 128) {
      out[fieldKey] = uidVal.trim();
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeActiveScreenMsMap(
  raw: unknown
): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [uid, msVal] of Object.entries(raw as Record<string, unknown>)) {
    if (
      uid.trim().length > 0 &&
      uid.length <= 128 &&
      typeof msVal === 'number' &&
      Number.isFinite(msVal) &&
      msVal >= 0
    ) {
      out[uid.trim()] = Math.trunc(msVal);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Reconstructs typed QuestionWorkspace objects for all questions on a test from raw
 * Firestore workspace data (supporting both per-cell `inputs` maps and legacy `userInputs` arrays).
 */
export function deserializeWorkspacesFromFirestore(
  rawWorkspaces: unknown,
  questions: readonly TestQuestion[],
  getQuote: (quoteId: number) => Quote | undefined,
  options?: { clearCorners?: boolean }
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
    const rawKeyInputsArr = Array.isArray(rawEntry?.keyInputs)
      ? (rawEntry.keyInputs as unknown[])
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

    const keyInputs =
      q.cipher === 'vigenere'
        ? chars.map((ch, cIdx) => {
            if (!isLetter(ch)) {
              return ch;
            }
            const rawKeyVal = rawInputsMap
              ? rawInputsMap[`k${cIdx}`]
              : rawKeyInputsArr
                ? rawKeyInputsArr[cIdx]
                : '';
            const cleanKey = sanitizeLetterInput(rawKeyVal);
            if (cleanKey !== '') {
              inputsRecord[`k${cIdx}`] = cleanKey;
            }
            return cleanKey;
          })
        : undefined;

    let aristocratReplacements: Partial<Record<string, string>> | undefined;
    let aristocratCorners: Partial<Record<string, AristocratCornerTuple>> | undefined;

    if (q.cipher === 'aristocrat') {
      const alpha = resolveQuestionAristocratAlphabet(q, idx);
      const cipherChars = quote
        ? aristocratEncryptText(quote.quote, alpha).split('')
        : [];
      const explicitReps: Partial<Record<string, string>> = {};
      const cornersMap: Partial<Record<string, AristocratCornerTuple>> = {};

      if (rawInputsMap) {
        for (const cCh of ALPHABET_LETTERS) {
          const repField = `rep_${cCh}`;
          if (repField in rawInputsMap) {
            const cleanRep = sanitizeLetterInput(rawInputsMap[repField]);
            explicitReps[cCh] = cleanRep;
            if (cleanRep) {
              inputsRecord[repField] = cleanRep;
            }
          }
          if (!options?.clearCorners) {
            const corField = `cor_${cCh}`;
            const parsedCorners = deserializeCornerTuple(rawInputsMap[corField]);
            if (parsedCorners) {
              cornersMap[cCh] = parsedCorners;
              inputsRecord[corField] = serializeCornerTuple(parsedCorners);
            }
          }
        }
      }

      aristocratReplacements = deriveReplacementsFromInputs(
        userInputs,
        cipherChars,
        explicitReps
      );
      aristocratCorners = options?.clearCorners ? {} : cornersMap;
    }

    const inputAuthors = sanitizeInputAuthorsMap(
      rawEntry?.inputAuthors,
      new Set(Object.keys(inputsRecord)),
      options?.clearCorners
    );
    const activeScreenMs = sanitizeActiveScreenMsMap(rawEntry?.activeScreenMs);

    const completed = totalAlpha > 0 && filledAlpha === totalAlpha;
    const lastEditedAt =
      typeof rawEntry?.lastEditedAt === 'number' ? rawEntry.lastEditedAt : 0;
    const lastEditedBy =
      typeof rawEntry?.lastEditedBy === 'string' ? rawEntry.lastEditedBy : undefined;

    result[idx] = {
      userInputs,
      ...(keyInputs ? { keyInputs } : {}),
      ...(aristocratReplacements ? { aristocratReplacements } : {}),
      ...(aristocratCorners ? { aristocratCorners } : {}),
      inputs: inputsRecord,
      ...(inputAuthors ? { inputAuthors } : {}),
      ...(activeScreenMs ? { activeScreenMs } : {}),
      completed,
      lastEditedAt,
      ...(lastEditedBy ? { lastEditedBy } : {}),
    };
  });

  return result;
}

/**
 * Serializes in-memory workspaces into compact Firestore map structures (`inputs` keyed by charIdx / `k${charIdx}` / `rep_${C}` / `cor_${C}`)
 * without arrays so concurrent dot-path updates never overwrite sibling cells.
 */
export function serializeWorkspacesForFirestore(
  workspaces: Record<number, QuestionWorkspace>,
  questions: readonly TestQuestion[],
  getQuote: (quoteId: number) => Quote | undefined,
  options?: { clearCorners?: boolean }
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
      if (q.cipher === 'vigenere' && ws.keyInputs) {
        const cleanKey = sanitizeLetterInput(ws.keyInputs[cIdx]);
        if (cleanKey !== '') {
          inputs[`k${cIdx}`] = cleanKey;
        }
      }
    });

    if (q.cipher === 'aristocrat') {
      if (ws.aristocratReplacements) {
        for (const cCh of ALPHABET_LETTERS) {
          const cleanRep = sanitizeLetterInput(ws.aristocratReplacements[cCh]);
          if (cleanRep) {
            inputs[`rep_${cCh}`] = cleanRep;
          }
        }
      }
      if (!options?.clearCorners && ws.aristocratCorners) {
        for (const cCh of ALPHABET_LETTERS) {
          const encoded = serializeCornerTuple(ws.aristocratCorners[cCh]);
          if (encoded) {
            inputs[`cor_${cCh}`] = encoded;
          }
        }
      }
    }

    const inputAuthors = sanitizeInputAuthorsMap(
      ws.inputAuthors,
      new Set(Object.keys(inputs)),
      options?.clearCorners
    );
    const activeScreenMs = sanitizeActiveScreenMsMap(ws.activeScreenMs);

    const entry: Record<string, unknown> = {
      inputs,
      ...(inputAuthors ? { inputAuthors } : {}),
      ...(activeScreenMs ? { activeScreenMs } : {}),
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
 * Computes character-level diffs between two character input arrays for a single question.
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
      const q = questions[op.qIdx];
      const quote = q ? getQuote(q.quoteId) : undefined;
      const chars = quote ? quote.quote.toUpperCase().split('') : [];
      cloned[op.qIdx] = {
        ...existing,
        userInputs: [...existing.userInputs],
        ...(existing.keyInputs
          ? { keyInputs: [...existing.keyInputs] }
          : q?.cipher === 'vigenere'
            ? { keyInputs: chars.map((ch) => (isLetter(ch) ? '' : ch)) }
            : {}),
        ...(existing.aristocratReplacements || q?.cipher === 'aristocrat'
          ? { aristocratReplacements: { ...(existing.aristocratReplacements ?? {}) } }
          : {}),
        ...(existing.aristocratCorners || q?.cipher === 'aristocrat'
          ? { aristocratCorners: { ...(existing.aristocratCorners ?? {}) } }
          : {}),
        inputs: { ...(existing.inputs ?? {}) },
        inputAuthors: { ...(existing.inputAuthors ?? {}) },
        ...(existing.activeScreenMs
          ? { activeScreenMs: { ...existing.activeScreenMs } }
          : {}),
      };
      touchedQuestions.add(op.qIdx);
    }

    const target = cloned[op.qIdx];
    const rowKind = op.row ?? 'plain';
    const fieldKey = op.fieldKey ?? getCellInputFieldKey(op.charIdx, rowKind);

    if (fieldKey.startsWith('rep_')) {
      const cCh = fieldKey.slice(4).toUpperCase();
      if (isLetter(cCh) && target.aristocratReplacements) {
        const cleanVal = sanitizeLetterInput(op.value);
        if (cleanVal) {
          target.aristocratReplacements[cCh] = cleanVal;
          if (target.inputs) target.inputs[fieldKey] = cleanVal;
          if (op.editedBy && target.inputAuthors) {
            target.inputAuthors[fieldKey] = op.editedBy;
          }
        } else {
          delete target.aristocratReplacements[cCh];
          if (target.inputs) delete target.inputs[fieldKey];
          if (target.inputAuthors) delete target.inputAuthors[fieldKey];
        }
        target.lastEditedAt = Math.max(target.lastEditedAt, op.editedAt);
        if (op.editedBy) target.lastEditedBy = op.editedBy;
      }
    } else if (fieldKey.startsWith('cor_')) {
      const cCh = fieldKey.slice(4).toUpperCase();
      if (isLetter(cCh) && target.aristocratCorners) {
        const parsed = deserializeCornerTuple(op.value);
        if (parsed) {
          target.aristocratCorners[cCh] = parsed;
          if (target.inputs) target.inputs[fieldKey] = serializeCornerTuple(parsed);
          if (op.editedBy && target.inputAuthors) {
            target.inputAuthors[fieldKey] = op.editedBy;
          }
        } else {
          delete target.aristocratCorners[cCh];
          if (target.inputs) delete target.inputs[fieldKey];
          if (target.inputAuthors) delete target.inputAuthors[fieldKey];
        }
        target.lastEditedAt = Math.max(target.lastEditedAt, op.editedAt);
        if (op.editedBy) target.lastEditedBy = op.editedBy;
      }
    } else if (rowKind === 'key') {
      if (target.keyInputs && op.charIdx >= 0 && op.charIdx < target.keyInputs.length) {
        target.keyInputs[op.charIdx] = op.value;
        if (target.inputs) {
          if (op.value) {
            target.inputs[fieldKey] = op.value;
            if (op.editedBy && target.inputAuthors) {
              target.inputAuthors[fieldKey] = op.editedBy;
            }
          } else {
            delete target.inputs[fieldKey];
            if (target.inputAuthors) delete target.inputAuthors[fieldKey];
          }
        }
        target.lastEditedAt = Math.max(target.lastEditedAt, op.editedAt);
        if (op.editedBy) {
          target.lastEditedBy = op.editedBy;
        }
      }
    } else if (op.charIdx >= 0 && op.charIdx < target.userInputs.length) {
      target.userInputs[op.charIdx] = op.value;
      if (target.inputs) {
        if (op.value) {
          target.inputs[fieldKey] = op.value;
          if (op.editedBy && target.inputAuthors) {
            target.inputAuthors[fieldKey] = op.editedBy;
          }
        } else {
          delete target.inputs[fieldKey];
          if (target.inputAuthors) delete target.inputAuthors[fieldKey];
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

  const isDone = status === 'submitted' || status === 'expired';
  const workspaces: Record<number, QuestionWorkspace> =
    questions && getQuote
      ? deserializeWorkspacesFromFirestore(raw.workspaces, questions, getQuote, {
          clearCorners: isDone,
        })
      : ((raw.workspaces as Record<number, QuestionWorkspace> | undefined) ?? {});

  return {
    attemptId: typeof raw.attemptId === 'string' && raw.attemptId ? raw.attemptId : fallbackAttemptId,
    testId: typeof raw.testId === 'string' ? raw.testId : '',
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

export interface QuestionUserAttribution {
  uid: string;
  activeScreenTimeSec: number;
  correctGradableInputs: number;
  totalGradableUnits: number;
}

/**
 * Computes per-student active screen time and correct gradable inputs on a single
 * practice test question:
 * - Linked Aristocrat: counts unique ciphertext-letter replacement mappings (`0..uniqueAlphaCharCount`)
 *   last entered by `uid` that resolve to the correct plaintext letter.
 * - All other ciphers: counts `A–Z` plaintext cells (`0..alphaCharCount`) last entered by `uid`
 *   that match the target quote character (excluding Vigenère `k*` and Aristocrat `cor_*` scratchpad keys).
 */
export function computeQuestionUserAttributions(
  question: TestQuestion,
  qIdx: number,
  workspace: QuestionWorkspace | undefined,
  quote: Quote | undefined,
  studentUids: readonly string[]
): QuestionUserAttribution[] {
  const cleanUids = normalizeUidList(studentUids);
  if (cleanUids.length === 0) return [];

  const targetUpper = (quote?.quote ?? '').toUpperCase();
  const targetChars = targetUpper.split('');
  const correctByUid = new Map<string, number>();
  for (const uid of cleanUids) {
    correctByUid.set(uid, 0);
  }

  const authors = workspace?.inputAuthors ?? {};
  let totalGradableUnits = 0;

  if (question.cipher === 'aristocrat') {
    const alphabet = resolveQuestionAristocratAlphabet(question, qIdx);
    const cipherChars = aristocratEncryptText(targetUpper, alphabet).split('');
    const expectedPlainByCipher = new Map<string, string>();
    const firstTileIndexByCipher = new Map<string, number>();

    for (let i = 0; i < targetChars.length; i += 1) {
      const plainCh = targetChars[i];
      const cipherCh = cipherChars[i];
      if (isLetter(plainCh) && cipherCh && isLetter(cipherCh)) {
        if (!expectedPlainByCipher.has(cipherCh)) {
          expectedPlainByCipher.set(cipherCh, plainCh);
          firstTileIndexByCipher.set(cipherCh, i);
        }
      }
    }

    totalGradableUnits = expectedPlainByCipher.size;

    for (const [cipherCh, expectedPlain] of expectedPlainByCipher.entries()) {
      const firstIdx = firstTileIndexByCipher.get(cipherCh);
      const guessedPlain =
        sanitizeLetterInput(workspace?.aristocratReplacements?.[cipherCh]) ||
        (firstIdx !== undefined
          ? sanitizeLetterInput(workspace?.userInputs?.[firstIdx])
          : '');
      if (guessedPlain !== expectedPlain) continue;

      const authorUid =
        authors[`rep_${cipherCh}`] ??
        (firstIdx !== undefined ? authors[String(firstIdx)] : undefined) ??
        (cleanUids.length === 1 ? cleanUids[0] : undefined);
      if (authorUid && correctByUid.has(authorUid)) {
        correctByUid.set(authorUid, (correctByUid.get(authorUid) ?? 0) + 1);
      }
    }
  } else {
    for (let i = 0; i < targetChars.length; i += 1) {
      const expectedPlain = targetChars[i];
      if (!isLetter(expectedPlain)) continue;
      totalGradableUnits += 1;

      const guessedPlain = sanitizeLetterInput(workspace?.userInputs?.[i]);
      if (guessedPlain !== expectedPlain) continue;

      const authorUid =
        authors[String(i)] ??
        (cleanUids.length === 1 ? cleanUids[0] : undefined);
      if (authorUid && correctByUid.has(authorUid)) {
        correctByUid.set(authorUid, (correctByUid.get(authorUid) ?? 0) + 1);
      }
    }
  }

  return cleanUids.map((uid) => {
    const rawMs = workspace?.activeScreenMs?.[uid] ?? 0;
    const activeScreenTimeSec =
      Math.round((Math.max(0, rawMs) / 1000) * 10) / 10;
    return {
      uid,
      activeScreenTimeSec,
      correctGradableInputs: correctByUid.get(uid) ?? 0,
      totalGradableUnits,
    };
  });
}

