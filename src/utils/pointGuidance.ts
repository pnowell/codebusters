import type { LookupCipherType, Quote } from '../types';
import { isLetter, letterToTapPair } from './ciphers';

export interface QuoteCipherStats {
  letterCount: number;
  uniqueLetters: number;
  tapCount: number;
}

export interface QuestionPointGuidance {
  rawBase: number;
  suggested: number;
  min: number;
  max: number;
  letterCount: number;
  uniqueLetters: number;
  tapCount: number;
  recommendedMinLetters: number;
  recommendedMaxLetters: number;
  lengthWarning: string | null;
  tooltipSummary: string;
}

const CIPHER_LABELS: Record<LookupCipherType, string> = {
  atbash: 'Atbash',
  pigpen: 'Pigpen',
  galactic: 'Galactic',
  tap: 'Tap Code',
  knights: 'Knights Templar',
};

const CIPHER_SEEDS: Record<LookupCipherType, number> = {
  atbash: 1,
  pigpen: 2,
  galactic: 3,
  tap: 4,
  knights: 5,
};

/**
 * Counts ciphered A-Z letters, distinct A-Z letters, and total Tap Code dots
 * (`row + col` per letter, treating K and C identically at [1, 3]).
 */
export function analyzeQuoteCipherStats(text: string): QuoteCipherStats {
  const upper = text.toUpperCase();
  let letterCount = 0;
  let tapCount = 0;
  const seen = new Set<string>();

  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i];
    if (!isLetter(ch)) continue;
    letterCount += 1;
    seen.add(ch);
    const pair = letterToTapPair(ch);
    if (pair) {
      tapCount += pair[0] + pair[1];
    }
  }

  return {
    letterCount,
    uniqueLetters: seen.size,
    tapCount,
  };
}

/**
 * Science Olympiad point guidance prefers non-rounded integers (never ending in 0 or 5)
 * to minimize score ties across teams.
 */
export function isNonRoundPointValue(points: number): boolean {
  return Number.isInteger(points) && points > 0 && points % 5 !== 0;
}

/**
 * Returns true when `points` is a non-round integer (`% 5 !== 0`) inside `[min, max]`.
 */
export function isPointsMatchingGuidance(
  points: number,
  guidance: Pick<QuestionPointGuidance, 'min' | 'max'>
): boolean {
  return (
    isNonRoundPointValue(points) &&
    points >= guidance.min &&
    points <= guidance.max
  );
}

/**
 * Deterministically chooses a non-round integer (`% 5 !== 0`) near `rawBase`
 * within `[min, max]`, avoiding exact collisions, duplicate ones-digits, and
 * duplicate half-credit values (`Math.round(p / 2)`) against `otherPoints`.
 */
export function pickNonRoundScore(params: {
  rawBase: number;
  min: number;
  max: number;
  otherPoints?: readonly number[];
  seed?: number;
}): number {
  const { rawBase, min, max, otherPoints = [], seed = 0 } = params;
  const safeMin = Math.max(1, Math.round(min));
  const safeMax = Math.max(safeMin + 2, Math.round(max));

  const validInRange: number[] = [];
  for (let p = safeMin; p <= safeMax; p++) {
    if (isNonRoundPointValue(p)) {
      validInRange.push(p);
    }
  }

  const otherValid = otherPoints.filter(
    (p) => typeof p === 'number' && Number.isFinite(p) && p > 0
  );
  const usedSet = new Set<number>(otherValid);

  // Only widen slightly if every single valid integer in [safeMin, safeMax] is already taken
  let candidates = validInRange;
  if (candidates.length === 0 || candidates.every((p) => usedSet.has(p))) {
    const expanded: number[] = [];
    const wideMin = Math.max(1, safeMin - 6);
    const wideMax = safeMax + 6;
    for (let p = wideMin; p <= wideMax; p++) {
      if (isNonRoundPointValue(p)) {
        expanded.push(p);
      }
    }
    if (expanded.length > 0) {
      candidates = expanded;
    }
  }

  if (candidates.length === 0) {
    return rawBase % 5 === 0 ? Math.max(1, rawBase + 1) : Math.max(1, rawBase);
  }

  const preferHigher = Math.abs(Math.trunc(seed)) % 2 === 0;
  let bestCandidate = candidates[0];
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (const p of candidates) {
    const outOfRangePenalty = p < safeMin || p > safeMax ? 200 : 0;

    let exactCollisions = 0;
    let onesCollisions = 0;
    let tensCollisions = 0;
    let halfCollisions = 0;
    const pOnes = p % 10;
    const pTens = Math.floor(p / 10) % 10;
    const pHalf = Math.round(p / 2);

    for (const other of otherValid) {
      const o = Math.round(other);
      if (o === p) exactCollisions += 1;
      if (o % 10 === pOnes) onesCollisions += 1;
      if (Math.floor(o / 10) % 10 === pTens) tensCollisions += 1;
      if (Math.round(o / 2) === pHalf) halfCollisions += 1;
    }

    const distPenalty = Math.abs(p - rawBase) * 3;
    const symmetryTieBreak =
      p === rawBase ? 0 : (p > rawBase) === preferHigher ? 0.1 : 0.2;

    const penalty =
      outOfRangePenalty +
      exactCollisions * 1000 +
      onesCollisions * 14 +
      halfCollisions * 5 +
      tensCollisions * 2 +
      distPenalty +
      symmetryTieBreak;

    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestCandidate = p;
    }
  }

  return bestCandidate;
}

/**
 * Computes recommended point value, `[min, max]` range, letter/tap breakdown,
 * and cipher-specific quote length guidance following Toebes' Division A implementation.
 */
export function getQuestionPointGuidance(
  cipher: LookupCipherType,
  quote: Quote | undefined,
  options?: {
    otherPoints?: readonly number[];
    questionIndex?: number;
  }
): QuestionPointGuidance {
  const cipherLabel = CIPHER_LABELS[cipher] ?? 'Cipher';
  const seed =
    (quote?.id ?? 0) +
    (CIPHER_SEEDS[cipher] ?? 0) +
    (options?.questionIndex ?? 0);

  if (!quote) {
    const fallbackSuggested = pickNonRoundScore({
      rawBase: 68,
      min: 63,
      max: 73,
      otherPoints: options?.otherPoints,
      seed,
    });
    return {
      rawBase: 68,
      suggested: fallbackSuggested,
      min: 63,
      max: 73,
      letterCount: 0,
      uniqueLetters: 0,
      tapCount: 0,
      recommendedMinLetters: 25,
      recommendedMaxLetters: 60,
      lengthWarning: null,
      tooltipSummary: `Suggested: ${fallbackSuggested} pts (range 63–73)`,
    };
  }

  const { letterCount: L, uniqueLetters: U, tapCount: T } =
    analyzeQuoteCipherStats(quote.quote);

  let rawBase: number;
  let min: number;
  let max: number;
  let recommendedMinLetters: number;
  let recommendedMaxLetters: number;
  let detailStats: string;

  switch (cipher) {
    case 'atbash': {
      // Toebes Division A CipherTableEncoder (Atbash): round(1.2 * (len + unique)), range ±8
      rawBase = Math.max(12, Math.round(1.2 * (L + U)));
      min = Math.max(10, rawBase - 8);
      max = rawBase + 8;
      recommendedMinLetters = 30;
      recommendedMaxLetters = 80;
      detailStats = `${L} letters, ${U} unique`;
      break;
    }
    case 'pigpen':
    case 'knights': {
      // Toebes CipherPigPenEncoder / CipherKnightsTemplarEncoder: round(len + 1.5 * unique), range ±5
      rawBase = Math.max(12, Math.round(L + 1.5 * U));
      min = Math.max(10, rawBase - 5);
      max = rawBase + 5;
      recommendedMinLetters = 25;
      recommendedMaxLetters = 60;
      detailStats = `${L} letters, ${U} unique`;
      break;
    }
    case 'galactic': {
      // Toebes CipherStandardGalacticAlphabetEncoder: round(len + 2 * unique), range ±5
      rawBase = Math.max(12, Math.round(L + 2 * U));
      min = Math.max(10, rawBase - 5);
      max = rawBase + 5;
      recommendedMinLetters = 25;
      recommendedMaxLetters = 60;
      detailStats = `${L} letters, ${U} unique`;
      break;
    }
    case 'tap': {
      // TestGuidance.html Tap Code: ~1 point per 3–4 taps (midpoint T / 3.5, range [T/4, T/3])
      rawBase = Math.max(12, Math.round(T / 3.5));
      min = Math.max(10, Math.min(rawBase - 4, Math.round(T / 4)));
      max = Math.max(rawBase + 4, Math.round(T / 3));
      recommendedMinLetters = 25;
      recommendedMaxLetters = 60;
      detailStats = `${L} letters, ${T} taps`;
      break;
    }
  }

  const suggested = pickNonRoundScore({
    rawBase,
    min,
    max,
    otherPoints: options?.otherPoints,
    seed,
  });

  let lengthWarning: string | null = null;
  if (L < recommendedMinLetters) {
    lengthWarning = `Short quote for ${cipherLabel}: ${L} letters (recommended ${recommendedMinLetters}–${recommendedMaxLetters} letters)`;
  } else if (L > recommendedMaxLetters) {
    lengthWarning = `Long quote for ${cipherLabel}: ${L} letters (recommended ${recommendedMinLetters}–${recommendedMaxLetters} letters)`;
  }

  const tooltipSummary = `Suggested: ${suggested} pts (range ${min}–${max}, non-multiples of 5) · ${cipherLabel}: ${detailStats}${
    lengthWarning ? ` · ${lengthWarning}` : ''
  }`;

  return {
    rawBase,
    suggested,
    min,
    max,
    letterCount: L,
    uniqueLetters: U,
    tapCount: T,
    recommendedMinLetters,
    recommendedMaxLetters,
    lengthWarning,
    tooltipSummary,
  };
}

/**
 * Assigns tie-reduced, non-round point values across an entire list of questions.
 */
export function suggestPointsForPacket(
  questions: readonly { cipher: LookupCipherType; quote: Quote | undefined }[]
): number[] {
  const assigned: number[] = [];
  questions.forEach((q, idx) => {
    const guidance = getQuestionPointGuidance(q.cipher, q.quote, {
      otherPoints: assigned,
      questionIndex: idx,
    });
    assigned.push(guidance.suggested);
  });
  return assigned;
}
