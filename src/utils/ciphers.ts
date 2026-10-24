import type { EvaluationResult, ScoreTier } from '../types';

export function letterToOffset(letter: string): number {
  const upper = letter.toUpperCase();
  const code = upper.charCodeAt(0);
  if (code >= 65 && code <= 90) {
    return code - 65;
  }
  return -1;
}

export function offsetToLetter(offset: number): string {
  if (offset < 0 || offset > 25) return '';
  return String.fromCharCode(65 + offset);
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
