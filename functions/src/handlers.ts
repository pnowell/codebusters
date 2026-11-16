import { create, fromJson, toJson, type JsonValue } from '@bufbuild/protobuf';
import {
  PracticeEventBatchSchema,
  PracticeTestQuestionUserEventSchema,
  ServerLoggedPracticeEventSchema,
} from './proto/events_pb.js';

export const LOG_TYPE_TAG = 'codebusters_practice_event';
export const MAX_EVENTS_PER_BATCH = 50;

const VALID_DRILL_IDS = new Set([
  'offsetsLetterToNum',
  'offsetsNumToLetter',
  'letterMathEasy',
  'letterMathHard',
  'letterMathLetterEasy',
  'letterMathLetterHard',
  'atbash',
  'pigpen',
  'galactic',
  'knights',
  'tap',
]);

const VALID_TESTABLE_CIPHERS = new Set([
  'atbash',
  'pigpen',
  'galactic',
  'tap',
  'knights',
  'caesar',
  'vigenere',
  'aristocrat',
]);

const EVENT_ID_RE = /^[0-9a-zA-Z_-]{8,64}$/;
const SAFE_MODE_RE = /^[a-zA-Z0-9_-]{0,24}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALPHABET_LETTERS = ALPHABET.split('');

function isUpperLetter(ch: string): boolean {
  return ch.length === 1 && ch >= 'A' && ch <= 'Z';
}

function sanitizeLetter(val: unknown): string {
  if (typeof val !== 'string' || val.length === 0) return '';
  const ch = val.slice(-1).toUpperCase();
  return isUpperLetter(ch) ? ch : '';
}

function isValidAristocratAlphabet(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length !== 26) return false;
  const seen = new Set<string>();
  for (let i = 0; i < 26; i += 1) {
    const ch = raw[i];
    if (!isUpperLetter(ch)) return false;
    if (ch === ALPHABET[i]) return false;
    if (seen.has(ch)) return false;
    seen.add(ch);
  }
  return seen.size === 26;
}

function createMulberry32(seed: number): () => number {
  let state = (Math.trunc(seed) ^ 0x9e3779b9) >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deterministicAristocratAlphabet(seed: number): string {
  const rng = createMulberry32(Math.trunc(seed) * 2654435761 + 1013904223);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const arr = [...ALPHABET_LETTERS];
    for (let i = 25; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    let isDerangement = true;
    for (let i = 0; i < 26; i += 1) {
      if (arr[i] === ALPHABET[i]) {
        isDerangement = false;
        break;
      }
    }
    if (isDerangement) {
      return arr.join('');
    }
  }
  return 'BCDEFGHIJKLMNOPQRSTUVWXYZA';
}

function aristocratEncryptText(plaintext: string, alphabet: string): string {
  const upper = plaintext.toUpperCase();
  let out = '';
  for (let i = 0; i < upper.length; i += 1) {
    const ch = upper[i];
    if (isUpperLetter(ch)) {
      out += alphabet[ch.charCodeAt(0) - 65] ?? ch;
    } else {
      out += ch;
    }
  }
  return out;
}

export class EventValidationError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Validates a decoded `PracticeEventBatch` from a client request, stamps `uid`,
 * and returns structured Cloud Logging JSON objects ready for stdout emission.
 */
export function buildServerLogsFromClientBatch(
  rawBody: unknown,
  verifiedUid: string
): Record<string, unknown>[] {
  if (!verifiedUid || typeof verifiedUid !== 'string') {
    throw new EventValidationError('Missing authenticated user ID.', 401);
  }
  if (!rawBody || typeof rawBody !== 'object') {
    throw new EventValidationError('Request body must be a JSON object.', 400);
  }

  let batch;
  try {
    batch = fromJson(PracticeEventBatchSchema, rawBody as JsonValue, {
      ignoreUnknownFields: true,
    });
  } catch {
    throw new EventValidationError(
      'Malformed PracticeEventBatch payload.',
      400
    );
  }

  if (batch.events.length === 0) {
    throw new EventValidationError('Event batch cannot be empty.', 400);
  }
  if (batch.events.length > MAX_EVENTS_PER_BATCH) {
    throw new EventValidationError(
      `Event batch exceeds maximum of ${MAX_EVENTS_PER_BATCH} events.`,
      400
    );
  }

  const nowMs = Date.now();
  const entries: Record<string, unknown>[] = [];

  for (const ev of batch.events) {
    if (!EVENT_ID_RE.test(ev.eventId)) {
      throw new EventValidationError('Invalid eventId format.', 400);
    }

    const clientTs =
      Number.isFinite(ev.clientTimestampMs) && ev.clientTimestampMs > 0
        ? Math.min(ev.clientTimestampMs, nowMs + 300_000)
        : nowMs;

    switch (ev.payload.case) {
      case 'drillSession': {
        const d = ev.payload.value;
        if (!VALID_DRILL_IDS.has(d.drillId)) {
          throw new EventValidationError(`Invalid drillId: ${d.drillId}`, 400);
        }
        if (
          !Number.isFinite(d.sessionDurationSec) ||
          d.sessionDurationSec < 0 ||
          d.sessionDurationSec > 86_400
        ) {
          throw new EventValidationError('Invalid sessionDurationSec.', 400);
        }
        if (d.totalAnswered < 1 || d.totalAnswered > 50_000) {
          throw new EventValidationError('Invalid totalAnswered.', 400);
        }
        if (d.totalCorrect > d.totalAnswered) {
          throw new EventValidationError(
            'totalCorrect cannot exceed totalAnswered.',
            400
          );
        }
        const serverMsg = create(ServerLoggedPracticeEventSchema, {
          logType: LOG_TYPE_TAG,
          eventType: 'drill_session',
          eventId: ev.eventId,
          uid: verifiedUid,
          clientTimestampMs: clientTs,
          payload: { case: 'drillSession', value: d },
        });
        const jsonObj = toJson(ServerLoggedPracticeEventSchema, serverMsg, {
          alwaysEmitImplicit: true,
        }) as Record<string, unknown>;
        entries.push({ severity: 'INFO', ...jsonObj });
        break;
      }

      case 'cipherStarted': {
        const cs = ev.payload.value;
        if (!VALID_TESTABLE_CIPHERS.has(cs.cipher)) {
          throw new EventValidationError(`Invalid cipher: ${cs.cipher}`, 400);
        }
        if (!SAFE_MODE_RE.test(cs.mode)) {
          throw new EventValidationError('Invalid cipher mode.', 400);
        }
        if (cs.quoteId > 1_000_000) {
          throw new EventValidationError('Invalid quoteId.', 400);
        }
        const serverMsg = create(ServerLoggedPracticeEventSchema, {
          logType: LOG_TYPE_TAG,
          eventType: 'cipher_started',
          eventId: ev.eventId,
          uid: verifiedUid,
          clientTimestampMs: clientTs,
          payload: { case: 'cipherStarted', value: cs },
        });
        const jsonObj = toJson(ServerLoggedPracticeEventSchema, serverMsg, {
          alwaysEmitImplicit: true,
        }) as Record<string, unknown>;
        entries.push({ severity: 'INFO', ...jsonObj });
        break;
      }

      case 'cipherSolved': {
        const solved = ev.payload.value;
        if (!VALID_TESTABLE_CIPHERS.has(solved.cipher)) {
          throw new EventValidationError(
            `Invalid cipher: ${solved.cipher}`,
            400
          );
        }
        if (!SAFE_MODE_RE.test(solved.mode)) {
          throw new EventValidationError('Invalid cipher mode.', 400);
        }
        if (!SAFE_MODE_RE.test(solved.inputMode)) {
          throw new EventValidationError('Invalid inputMode.', 400);
        }
        if (
          !Number.isFinite(solved.elapsedSec) ||
          solved.elapsedSec < 0 ||
          solved.elapsedSec > 86_400
        ) {
          throw new EventValidationError('Invalid elapsedSec.', 400);
        }
        if (solved.quoteId > 1_000_000 || solved.alphaCharCount > 5_000) {
          throw new EventValidationError('Invalid quote dimensions.', 400);
        }
        const serverMsg = create(ServerLoggedPracticeEventSchema, {
          logType: LOG_TYPE_TAG,
          eventType: 'cipher_solved',
          eventId: ev.eventId,
          uid: verifiedUid,
          clientTimestampMs: clientTs,
          payload: { case: 'cipherSolved', value: solved },
        });
        const jsonObj = toJson(ServerLoggedPracticeEventSchema, serverMsg, {
          alwaysEmitImplicit: true,
        }) as Record<string, unknown>;
        entries.push({ severity: 'INFO', ...jsonObj });
        break;
      }

      case 'practiceTestQuestionUser': {
        throw new EventValidationError(
          'practice_test_question_user events are generated exclusively on the server.',
          400
        );
      }

      default:
        throw new EventValidationError('Missing PracticeEvent payload.', 400);
    }
  }

  return entries;
}

export interface RawTestQuestionDoc {
  questionNumber?: number;
  cipher?: string;
  quoteId?: number;
  caesarOffset?: number;
  aristocratAlphabet?: string;
}

export interface RawTestPacketDoc {
  testId?: string;
  timeLimitSeconds?: number;
  questions?: RawTestQuestionDoc[];
}

export interface RawAttemptDoc {
  attemptId?: string;
  testId?: string;
  status?: string;
  studentUids?: unknown;
  startedAt?: number;
  submittedAt?: number;
  workspaces?: Record<string, unknown>;
}

/**
 * Builds structured `practice_test_question_user` log objects for every participating
 * student across every question on a newly completed (`submitted` or `expired`) test attempt.
 */
export function buildTestAttemptCompletionLogs(
  attemptId: string,
  attempt: RawAttemptDoc,
  testPacket: RawTestPacketDoc,
  quotesLookup: Readonly<Record<number, { q: string; t?: string }>>
): Record<string, unknown>[] {
  const rawUids = Array.isArray(attempt.studentUids)
    ? attempt.studentUids
        .filter((u): u is string => typeof u === 'string' && u.trim().length > 0 && u !== 'student')
        .map((u) => u.trim())
    : [];
  const studentUids = Array.from(new Set(rawUids)).sort();
  if (studentUids.length === 0) return [];

  const questions = Array.isArray(testPacket.questions)
    ? testPacket.questions
    : [];
  if (questions.length === 0) return [];

  const testId =
    (typeof attempt.testId === 'string' && attempt.testId) ||
    testPacket.testId ||
    '';
  const startedAt = typeof attempt.startedAt === 'number' ? attempt.startedAt : 0;
  const submittedAt =
    typeof attempt.submittedAt === 'number' && attempt.submittedAt > 0
      ? attempt.submittedAt
      : Date.now();
  const timeLimitSec =
    typeof testPacket.timeLimitSeconds === 'number' && testPacket.timeLimitSeconds > 0
      ? testPacket.timeLimitSeconds
      : 3000;
  const totalTestElapsedSec =
    startedAt > 0
      ? Math.min(
          timeLimitSec,
          Math.max(0, Math.round(((submittedAt - startedAt) / 1000) * 10) / 10)
        )
      : 0;

  const isCollaborative = studentUids.length > 1;
  const teamSize = studentUids.length;
  const rawWorkspaces =
    attempt.workspaces && typeof attempt.workspaces === 'object'
      ? attempt.workspaces
      : {};

  const logs: Record<string, unknown>[] = [];

  questions.forEach((q, qIdx) => {
    const cipher = typeof q.cipher === 'string' ? q.cipher : '';
    const quoteId = typeof q.quoteId === 'number' ? q.quoteId : -1;
    if (!VALID_TESTABLE_CIPHERS.has(cipher) || quoteId < 0) return;

    const quoteInfo = quotesLookup[quoteId];
    if (!quoteInfo) return;

    const targetUpper = quoteInfo.q.toUpperCase();
    const targetChars = targetUpper.split('');
    const wsRaw = (rawWorkspaces[String(qIdx)] ?? {}) as Record<string, unknown>;
    const inputsMap =
      wsRaw.inputs && typeof wsRaw.inputs === 'object'
        ? (wsRaw.inputs as Record<string, unknown>)
        : {};
    const authorsMap =
      wsRaw.inputAuthors && typeof wsRaw.inputAuthors === 'object'
        ? (wsRaw.inputAuthors as Record<string, unknown>)
        : {};
    const activeMsMap =
      wsRaw.activeScreenMs && typeof wsRaw.activeScreenMs === 'object'
        ? (wsRaw.activeScreenMs as Record<string, unknown>)
        : {};

    const correctByUid = new Map<string, number>();
    for (const uid of studentUids) {
      correctByUid.set(uid, 0);
    }

    let totalGradableUnits = 0;
    let mode = '';
    if (cipher === 'aristocrat') {
      mode = quoteInfo.t ?? '';
      const alpha = isValidAristocratAlphabet(q.aristocratAlphabet)
        ? q.aristocratAlphabet
        : deterministicAristocratAlphabet(quoteId + qIdx);
      const cipherChars = aristocratEncryptText(targetUpper, alpha).split('');
      const expectedPlainByCipher = new Map<string, string>();
      const firstTileIndexByCipher = new Map<string, number>();

      for (let i = 0; i < targetChars.length; i += 1) {
        const plainCh = targetChars[i];
        const cipherCh = cipherChars[i];
        if (isUpperLetter(plainCh) && cipherCh && isUpperLetter(cipherCh)) {
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
          sanitizeLetter(inputsMap[`rep_${cipherCh}`]) ||
          (firstIdx !== undefined
            ? sanitizeLetter(inputsMap[String(firstIdx)])
            : '');
        if (guessedPlain !== expectedPlain) continue;

        const rawAuthor =
          authorsMap[`rep_${cipherCh}`] ??
          (firstIdx !== undefined ? authorsMap[String(firstIdx)] : undefined) ??
          (studentUids.length === 1 ? studentUids[0] : undefined);
        if (typeof rawAuthor === 'string' && correctByUid.has(rawAuthor)) {
          correctByUid.set(rawAuthor, (correctByUid.get(rawAuthor) ?? 0) + 1);
        }
      }
    } else {
      if (cipher === 'caesar' && typeof q.caesarOffset === 'number') {
        const normShift = ((q.caesarOffset % 26) + 26) % 26;
        mode = normShift <= 3 || normShift >= 23 ? 'pm3' : 'any';
      }
      for (let i = 0; i < targetChars.length; i += 1) {
        const expectedPlain = targetChars[i];
        if (!isUpperLetter(expectedPlain)) continue;
        totalGradableUnits += 1;

        const guessedPlain = sanitizeLetter(inputsMap[String(i)]);
        if (guessedPlain !== expectedPlain) continue;

        const rawAuthor =
          authorsMap[String(i)] ??
          (studentUids.length === 1 ? studentUids[0] : undefined);
        if (typeof rawAuthor === 'string' && correctByUid.has(rawAuthor)) {
          correctByUid.set(rawAuthor, (correctByUid.get(rawAuthor) ?? 0) + 1);
        }
      }
    }

    const qNum =
      typeof q.questionNumber === 'number' && q.questionNumber > 0
        ? q.questionNumber
        : qIdx + 1;

    for (const uid of studentUids) {
      const rawMs = activeMsMap[uid];
      const activeScreenTimeSec =
        typeof rawMs === 'number' && Number.isFinite(rawMs) && rawMs > 0
          ? Math.round((rawMs / 1000) * 10) / 10
          : 0;

      const ptEvent = create(PracticeTestQuestionUserEventSchema, {
        attemptId,
        testId,
        questionNumber: qNum,
        cipher,
        mode,
        quoteId,
        isCollaborative,
        teamSize,
        totalTestElapsedSec,
        activeScreenTimeSec,
        correctGradableInputs: correctByUid.get(uid) ?? 0,
        totalGradableUnits,
      });

      const eventId = `ptqu_${attemptId}_${qNum}_${uid}`.slice(0, 128);
      const serverMsg = create(ServerLoggedPracticeEventSchema, {
        logType: LOG_TYPE_TAG,
        eventType: 'practice_test_question_user',
        eventId,
        uid,
        clientTimestampMs: submittedAt,
        payload: { case: 'practiceTestQuestionUser', value: ptEvent },
      });

      const jsonObj = toJson(ServerLoggedPracticeEventSchema, serverMsg, {
        alwaysEmitImplicit: true,
      }) as Record<string, unknown>;
      logs.push({ severity: 'INFO', ...jsonObj });
    }
  });

  return logs;
}
