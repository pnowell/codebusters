import type { EvaluationResult, ScoreTier } from '../types';

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

/**
 * Caesar mapping: shift by n (-3 to +3 for Div A).
 * Used by upcoming Caesar drill (Meeting 2).
 */
export function caesarChar(char: string, shift: number): string {
  const off = letterToOffset(char);
  if (off === -1) return char;
  const shifted = ((off + shift) % 26 + 26) % 26;
  return offsetToLetter(shifted);
}

export function caesarText(text: string, shift: number): string {
  return text.split('').map(c => caesarChar(c, shift)).join('');
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
  let errorCount = 0;
  let filledCount = 0;

  for (let i = 0; i < targetUpper.length; i++) {
    const tChar = targetUpper[i];
    if (tChar >= 'A' && tChar <= 'Z') {
      totalAlpha++;
      const sChar = inputUpper[i] || '';
      if (sChar !== '') {
        filledCount++;
        if (sChar === tChar) {
          correctCount++;
        } else {
          errorCount++;
        }
      }
    }
  }

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
