import type {
  CaesarRangeMode,
  EvaluationResult,
  LetterMathMode,
  ScoreTier,
} from '../types';

export const isLetter = (c: string): boolean => c.length === 1 && c >= 'A' && c <= 'Z';

export function letterToOffset(letter: string): number {
  const upper = letter.toUpperCase();
  if (isLetter(upper)) {
    return upper.charCodeAt(0) - 65;
  }
  return -1;
}

export function offsetToLetter(offset: number): string {
  if (offset < 0 || offset > 25) return '';
  return String.fromCharCode(65 + offset);
}

/** Index of the next (dir=1) or previous (dir=-1) letter after `start`; returns `start` if none. */
export function findLetterIndex(chars: readonly string[], start: number, dir: 1 | -1): number {
  for (let i = start + dir; i >= 0 && i < chars.length; i += dir) {
    if (isLetter(chars[i])) return i;
  }
  return start;
}

/** Splits characters into words on spaces, keeping each char's original index. */
export function groupIntoWords(chars: readonly string[]): { char: string; index: number }[][] {
  const words: { char: string; index: number }[][] = [];
  let cur: { char: string; index: number }[] = [];
  chars.forEach((char, index) => {
    if (char === ' ') {
      if (cur.length) {
        words.push(cur);
        cur = [];
      }
    } else {
      cur.push({ char, index });
    }
  });
  if (cur.length) words.push(cur);
  return words;
}

/**
 * Atbash mapping: A <-> Z, B <-> Y, C <-> X, etc.
 * Mathematical equivalent: offset = 25 - offset
 */
export function atbashChar(char: string): string {
  const off = letterToOffset(char);
  if (off === -1) return char;
  return offsetToLetter(25 - off);
}

/** Allowed non-zero Caesar shifts for Division A (±3). */
export const CAESAR_PM3_OFFSETS = [-3, -2, -1, 1, 2, 3] as const;

/** All 25 non-zero Caesar shifts modulo 26 (-12..-1, +1..+13). */
export const CAESAR_ANY_OFFSETS: readonly number[] = [
  -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1,
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
];

export function isValidCaesarPm3Offset(val: unknown): val is number {
  return (
    typeof val === 'number' &&
    Number.isInteger(val) &&
    val >= -3 &&
    val <= 3 &&
    val !== 0
  );
}

export function isValidCaesarAnyOffset(val: unknown): val is number {
  return (
    typeof val === 'number' &&
    Number.isInteger(val) &&
    val >= -13 &&
    val <= 13 &&
    val !== 0
  );
}

/**
 * Caesar mapping: shifts A-Z by `offset` modulo 26 (`cipher = (plain + offset) mod 26`).
 * Non-alphabetic characters are returned unchanged.
 */
export function caesarChar(char: string, offset: number): string {
  const off = letterToOffset(char);
  if (off === -1) return char;
  const shift = Number.isFinite(offset) ? Math.trunc(offset) : 0;
  const shifted = (((off + shift) % 26) + 26) % 26;
  return offsetToLetter(shifted);
}

/**
 * Deterministic non-zero Caesar shift derived from an integer seed (e.g. `quoteId`),
 * used as a stable fallback when no explicit offset was persisted.
 */
export function deterministicCaesarOffset(
  seed: number,
  range: CaesarRangeMode = 'pm3'
): number {
  const pool = range === 'any' ? CAESAR_ANY_OFFSETS : CAESAR_PM3_OFFSETS;
  const idx = Math.abs(Math.trunc(seed * 7 + 3)) % pool.length;
  return pool[idx];
}

/**
 * Picks a random non-zero Caesar offset for the requested range, optionally avoiding `excludeOffset`.
 */
export function pickRandomCaesarOffset(
  range: CaesarRangeMode = 'pm3',
  excludeOffset?: number,
  rng: () => number = Math.random
): number {
  const pool = range === 'any' ? CAESAR_ANY_OFFSETS : CAESAR_PM3_OFFSETS;
  const filtered =
    excludeOffset !== undefined ? pool.filter((o) => o !== excludeOffset) : pool;
  const candidates = filtered.length > 0 ? filtered : pool;
  return candidates[Math.floor(rng() * candidates.length)];
}

export function formatSignedOffset(offset: number): string {
  if (offset > 0) return `+${offset}`;
  return String(offset);
}

export type ArithmeticOperandKind = 'number' | 'letter';

export interface LetterMathProblem {
  key: string;
  baseOffset: number;
  baseLetter: string;
  op: '+' | '-';
  delta: number;
  bottomOperandLabel: string;
  bottomOperandOffsetHint?: number;
  answerOffset: number;
  answerLetter: string;
}

/**
 * Generates a modulo-26 letter arithmetic card (`ABC ± #` or future `ABC ± ABC`).
 * - `easy`: non-zero delta in `1..3`
 * - `hard`: non-zero delta in `1..25`
 */
export function generateLetterMathProblem(
  mode: LetterMathMode,
  operandKind: ArithmeticOperandKind = 'number',
  excludeKey?: string,
  rng: () => number = Math.random
): LetterMathProblem {
  const maxDelta = mode === 'easy' ? 3 : 25;
  let candidate: LetterMathProblem | null = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const baseOffset = Math.floor(rng() * 26);
    const op: '+' | '-' = rng() < 0.5 ? '+' : '-';
    const delta = 1 + Math.floor(rng() * maxDelta);
    const signedDelta = op === '+' ? delta : -delta;
    const answerOffset = (((baseOffset + signedDelta) % 26) + 26) % 26;
    const baseLetter = offsetToLetter(baseOffset);
    const answerLetter = offsetToLetter(answerOffset);

    const bottomOperandLabel =
      operandKind === 'letter' ? offsetToLetter(delta) : String(delta);
    const bottomOperandOffsetHint =
      operandKind === 'letter' ? delta : undefined;
    const key = `${baseLetter}${op}${bottomOperandLabel}`;

    candidate = {
      key,
      baseOffset,
      baseLetter,
      op,
      delta,
      bottomOperandLabel,
      bottomOperandOffsetHint,
      answerOffset,
      answerLetter,
    };

    if (!excludeKey || key !== excludeKey) {
      break;
    }
  }

  return candidate!;
}

/**
 * Standard 5x5 Tap Code grid (C and K share row 1, col 3).
 * Column 1 (A, F, L, Q, V) serves as the row-anchor shortcut.
 */
export const TAP_CODE_GRID: readonly (readonly string[])[] = [
  ['A', 'B', 'C/K', 'D', 'E'],
  ['F', 'G', 'H', 'I', 'J'],
  ['L', 'M', 'N', 'O', 'P'],
  ['Q', 'R', 'S', 'T', 'U'],
  ['V', 'W', 'X', 'Y', 'Z'],
];

/**
 * Maps an English letter A-Z to its 1-indexed [row, col] Tap Code pair (1..5, 1..5).
 * Both 'C' and 'K' map to [1, 3]. Returns null for non-letters.
 */
export function letterToTapPair(char: string): readonly [number, number] | null {
  const upper = char.toUpperCase();
  if (!isLetter(upper)) return null;
  if (upper === 'K') return [1, 3];
  const off = letterToOffset(upper);
  const cellIndex = off > 10 ? off - 1 : off;
  const row = Math.floor(cellIndex / 5) + 1;
  const col = (cellIndex % 5) + 1;
  return [row, col];
}

/**
 * Returns true if two letters share the exact same Tap Code representation
 * (identical letters, or 'C' and 'K' which both map to [1, 3]).
 */
export function isTapCodeEquivalentLetter(a: string, b: string): boolean {
  const ua = a.toUpperCase();
  const ub = b.toUpperCase();
  if (!isLetter(ua) || !isLetter(ub)) return false;
  if (ua === ub) return true;
  return (ua === 'C' && ub === 'K') || (ua === 'K' && ub === 'C');
}

/**
 * Returns true if two letters share the exact same Knights Templar symbol
 * (identical letters, or 'I' and 'J' which both map to the top undotted kite).
 */
export function isKnightsTemplarEquivalentLetter(a: string, b: string): boolean {
  const ua = a.toUpperCase();
  const ub = b.toUpperCase();
  if (!isLetter(ua) || !isLetter(ub)) return false;
  if (ua === ub) return true;
  return (ua === 'I' && ub === 'J') || (ua === 'J' && ub === 'I');
}

/**
 * Evaluate student answer against target plaintext using official SoCal DaVinci scoring:
 * - 0 to 2 errors: Full credit
 * - 3 to 4 errors: Half credit
 * - More than 4 errors: No credit
 */
export function evaluateSolution(target: string, studentInput: string): EvaluationResult {
  const targetUpper = target.toUpperCase();
  const inputUpper = studentInput.toUpperCase();

  let totalAlpha = 0;
  let correctCount = 0;
  let filledCount = 0;

  for (let i = 0; i < targetUpper.length; i++) {
    const tChar = targetUpper[i];
    if (isLetter(tChar)) {
      totalAlpha++;
      const sChar = inputUpper[i] || '';
      if (sChar !== '') {
        filledCount++;
        if (sChar === tChar) {
          correctCount++;
        }
      }
    }
  }

  // Official Science Olympiad rules: omitted/blank characters count as errors
  const errorCount = totalAlpha - correctCount;

  let scoreTier: ScoreTier = 'none';
  if (errorCount <= 2) {
    scoreTier = 'full';
  } else if (errorCount <= 4) {
    scoreTier = 'half';
  }

  const isComplete = filledCount === totalAlpha;

  return {
    totalChars: totalAlpha,
    correctChars: correctCount,
    errorCount,
    scoreTier,
    isComplete,
  };
}

/**
 * Maximum fraction of letter errors allowed for a submitted quote puzzle
 * to count as a genuine attempt and be added to `completedQuotes`.
 * If more than 60% of the letters are errors (e.g. keyboard mashing), the quote is not consumed.
 */
export const MAX_QUOTE_COMPLETION_ERROR_RATE = 0.6;

export function shouldCountQuoteCompleted(result: EvaluationResult): boolean {
  if (result.totalChars <= 0) return false;
  return result.errorCount / result.totalChars <= MAX_QUOTE_COMPLETION_ERROR_RATE;
}

/**
 * Standard Beker & Piper (1982) English letter frequencies.
 * Matches the Science Olympiad spreadsheet frequency table.
 */
export const ENGLISH_LETTER_FREQUENCIES: Record<string, number> = {
  A: 0.08167, B: 0.01492, C: 0.02782, D: 0.04253, E: 0.12702,
  F: 0.02228, G: 0.02015, H: 0.06094, I: 0.06966, J: 0.00153,
  K: 0.00772, L: 0.04025, M: 0.02406, N: 0.06749, O: 0.07507,
  P: 0.01929, Q: 0.00095, R: 0.05987, S: 0.06327, T: 0.09056,
  U: 0.02758, V: 0.00978, W: 0.02360, X: 0.00150, Y: 0.01974,
  Z: 0.00074,
};

/**
 * Calculates chi-squared distance from standard English letter frequency.
 * Mathematically identical to the spreadsheet formula:
 * SUMPRODUCT((observed - expected)^2 / expected)
 */
export function calculateChiSquared(text: string): number {
  const upper = text.toUpperCase();
  const counts: Record<string, number> = {};
  let totalLen = 0;

  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i];
    if (isLetter(ch)) {
      counts[ch] = (counts[ch] || 0) + 1;
      totalLen++;
    }
  }

  if (totalLen === 0) return 0;

  let chi = 0;
  for (const letter of Object.keys(ENGLISH_LETTER_FREQUENCIES)) {
    const observed = counts[letter] || 0;
    const expected = totalLen * ENGLISH_LETTER_FREQUENCIES[letter];
    chi += Math.pow(observed - expected, 2) / expected;
  }

  return Math.round(chi * 1000) / 1000;
}

