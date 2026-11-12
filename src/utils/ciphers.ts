import type {
  CaesarRangeMode,
  EvaluationResult,
  LetterMathMode,
  ScoreTier,
} from '../types';

export const isLetter = (c: string): boolean => c.length === 1 && c >= 'A' && c <= 'Z';

const STRIPPABLE_STREAM_CHAR_RE = /^[\s.,;:'"!?()-]$/;

/**
 * Returns true if `c` is whitespace or standard grammatical punctuation that can
 * be safely omitted in continuous-stream ciphers (such as Tap Code) without
 * losing semantic words, numbers, or symbols.
 */
export function isStrippableStreamChar(c: string): boolean {
  return c.length === 1 && STRIPPABLE_STREAM_CHAR_RE.test(c);
}

/**
 * Returns true if `c` should be retained in a continuous-stream cipher tile grid:
 * alphabetic letters (A-Z) plus any critical non-punctuation characters (such as
 * digits `0-9` or `&`, `%`, `$`, etc.).
 */
export function isRetainedInContinuousStream(c: string): boolean {
  const upper = c.toUpperCase();
  return isLetter(upper) || (c.length === 1 && !isStrippableStreamChar(c));
}

/**
 * Returns true if `text` contains any critical non-letter, non-punctuation
 * characters (e.g. digits `0-9` or `&`) that cannot be encoded purely as A-Z
 * cipher symbols in a continuous stream.
 */
export function hasCriticalNonLetterChars(text: string): boolean {
  for (const ch of text) {
    if (!isLetter(ch.toUpperCase()) && !isStrippableStreamChar(ch)) {
      return true;
    }
  }
  return false;
}

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

// ============================================================================
// Vigenère Cipher Helpers & Curated Keyword Bank
// ============================================================================

export const VIGENERE_KEYWORDS: readonly string[] = [
  'KEY',
  'STAR',
  'CODE',
  'MOON',
  'MATH',
  'ATOM',
  'WAVE',
  'NOVA',
  'MARS',
  'GOLD',
  'WIND',
  'TIME',
  'BOOK',
  'FIRE',
  'BLUE',
  'FROG',
  'ORBIT',
  'LASER',
  'SOLAR',
  'COMET',
  'PRISM',
  'LIGHT',
  'SPACE',
  'ROBOT',
  'EARTH',
  'CLOUD',
  'MUSIC',
  'TIGER',
  'OCEAN',
  'SPARK',
  'PIXEL',
  'SOUND',
  'BRAVE',
  'MAGIC',
  'QUEST',
  'CROWN',
  'GALAXY',
  'PLANET',
  'CIPHER',
  'ROCKET',
  'ENERGY',
  'VECTOR',
  'MATRIX',
  'FALCON',
  'PUZZLE',
  'LEGEND',
  'DRAGON',
  'SCIENCE',
];

const VALID_VIGENERE_KEY_RE = /^[A-Z]{2,14}$/;

export function sanitizeVigenereKeyword(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 14);
}

export function isValidVigenereKeyword(val: unknown): val is string {
  return typeof val === 'string' && VALID_VIGENERE_KEY_RE.test(val);
}

/**
 * Encrypts a single plaintext A-Z letter with `keyChar` modulo 26 (`(P + K) mod 26`).
 * Non-alphabetic characters are returned unchanged.
 */
export function vigenereEncryptChar(plainChar: string, keyChar: string): string {
  const pOff = letterToOffset(plainChar);
  const kOff = letterToOffset(keyChar);
  if (pOff === -1 || kOff === -1) return plainChar;
  return offsetToLetter((pOff + kOff) % 26);
}

/**
 * Decrypts a single ciphertext A-Z letter with `keyChar` modulo 26 (`(C - K) mod 26`).
 * Non-alphabetic characters are returned unchanged.
 */
export function vigenereDecryptChar(cipherChar: string, keyChar: string): string {
  const cOff = letterToOffset(cipherChar);
  const kOff = letterToOffset(keyChar);
  if (cOff === -1 || kOff === -1) return cipherChar;
  return offsetToLetter((((cOff - kOff) % 26) + 26) % 26);
}

/**
 * Maps each character index of `plaintext` to its aligned uppercase Vigenère key letter
 * (advancing the keyword strictly on A-Z letters and returning `''` for spaces/punctuation).
 */
export function computeVigenereKeySequence(
  plaintext: string,
  keyword: string
): string[] {
  const cleanKey = sanitizeVigenereKeyword(keyword) || 'KEY';
  const chars = plaintext.toUpperCase().split('');
  let letterSeq = 0;
  return chars.map((ch) => {
    if (!isLetter(ch)) return '';
    const keyChar = cleanKey[letterSeq % cleanKey.length];
    letterSeq += 1;
    return keyChar;
  });
}

/**
 * Deterministic Vigenère keyword derived from an integer seed (e.g. `quoteId`),
 * used for stable URL deep links (`?cipher=vigenere&q=123`) and fallback normalization.
 */
export function deterministicVigenereKeyword(seed: number): string {
  const idx = Math.abs(Math.trunc(seed * 13 + 5)) % VIGENERE_KEYWORDS.length;
  return VIGENERE_KEYWORDS[idx];
}

/**
 * Picks a random Vigenère keyword from `VIGENERE_KEYWORDS`, optionally avoiding `excludeKeyword`.
 */
export function pickRandomVigenereKeyword(
  excludeKeyword?: string,
  rng: () => number = Math.random
): string {
  const upperExclude = excludeKeyword?.toUpperCase();
  const filtered = upperExclude
    ? VIGENERE_KEYWORDS.filter((w) => w !== upperExclude)
    : VIGENERE_KEYWORDS;
  const pool = filtered.length > 0 ? filtered : VIGENERE_KEYWORDS;
  return pool[Math.floor(rng() * pool.length)];
}

// ============================================================================
// Modulo-26 Letter Arithmetic (`ABC ± #` & `ABC ± ABC`)
// ============================================================================

export type ArithmeticOperandKind = 'number' | 'letter';

/**
 * Relative sampling weights for `ABC ± ABC (Easy)` across `A (0) .. Z (25)`:
 * - Favors lower letters (`A–E`), tapering smoothly down through `K (10)`
 * - Zero weight on middle/upper letters `L–W (11..22)`
 * - Small non-zero tail on `X, Y, Z (23..25)` (`-3, -2, -1` mod 26)
 */
export const LETTER_MATH_EASY_LETTER_WEIGHTS: readonly number[] = [
  6,   // A (0)
  14,  // B (1)
  13,  // C (2)
  12,  // D (3)
  10,  // E (4)
  8,   // F (5)
  6,   // G (6)
  5,   // H (7)
  4,   // I (8)
  3,   // J (9)
  2,   // K (10)
  0,   // L (11)
  0,   // M (12)
  0,   // N (13)
  0,   // O (14)
  0,   // P (15)
  0,   // Q (16)
  0,   // R (17)
  0,   // S (18)
  0,   // T (19)
  0,   // U (20)
  0,   // V (21)
  0,   // W (22)
  1,   // X (23)
  1.5, // Y (24)
  2,   // Z (25)
];

const LETTER_MATH_EASY_WEIGHT_TOTAL = LETTER_MATH_EASY_LETTER_WEIGHTS.reduce(
  (sum, w) => sum + w,
  0
);

function drawWeightedLetterOffset(
  weights: readonly number[],
  totalWeight: number,
  rng: () => number
): number {
  let cursor = rng() * totalWeight;
  for (let i = 0; i < weights.length; i += 1) {
    const w = weights[i];
    if (w <= 0) continue;
    cursor -= w;
    if (cursor <= 0) {
      return i;
    }
  }
  return 0;
}

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
 * Generates a modulo-26 letter arithmetic card (`ABC ± #` or `ABC ± ABC`):
 * - `ABC ± #`: `easy` uses non-zero delta `1..3`; `hard` uses non-zero delta `1..25`.
 * - `ABC ± ABC`: `letterEasy` draws both letters from `LETTER_MATH_EASY_LETTER_WEIGHTS`
 *   (favoring lower letters tapering around `K`, plus a small tail on `X, Y, Z`);
 *   `letterHard` draws both letters uniformly across `A–Z` (`0..25`).
 */
export function generateLetterMathProblem(
  mode: LetterMathMode,
  operandKind: ArithmeticOperandKind = 'number',
  excludeKey?: string,
  rng: () => number = Math.random
): LetterMathProblem {
  const resolvedKind: ArithmeticOperandKind =
    mode === 'letterEasy' || mode === 'letterHard' ? 'letter' : operandKind;
  const isHard = mode === 'hard' || mode === 'letterHard';
  const maxNumberDelta = isHard ? 25 : 3;
  let candidate: LetterMathProblem | null = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const op: '+' | '-' = rng() < 0.5 ? '+' : '-';
    let baseOffset: number;
    let delta: number;

    if (resolvedKind === 'letter') {
      if (isHard) {
        baseOffset = Math.floor(rng() * 26);
        delta = Math.floor(rng() * 26);
      } else {
        baseOffset = drawWeightedLetterOffset(
          LETTER_MATH_EASY_LETTER_WEIGHTS,
          LETTER_MATH_EASY_WEIGHT_TOTAL,
          rng
        );
        delta = drawWeightedLetterOffset(
          LETTER_MATH_EASY_LETTER_WEIGHTS,
          LETTER_MATH_EASY_WEIGHT_TOTAL,
          rng
        );
      }
    } else {
      baseOffset = Math.floor(rng() * 26);
      delta = 1 + Math.floor(rng() * maxNumberDelta);
    }

    const signedDelta = op === '+' ? delta : -delta;
    const answerOffset = (((baseOffset + signedDelta) % 26) + 26) % 26;
    const baseLetter = offsetToLetter(baseOffset);
    const answerLetter = offsetToLetter(answerOffset);

    const bottomOperandLabel =
      resolvedKind === 'letter' ? offsetToLetter(delta) : String(delta);
    const bottomOperandOffsetHint =
      resolvedKind === 'letter' ? delta : undefined;
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

