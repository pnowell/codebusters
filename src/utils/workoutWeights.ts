import { IMPLEMENTED_DRILLS, getCipherBucket, type CipherType } from '../data/drills';
import {
  loadAllDrillHistory,
  loadAllDrillProgress,
  loadAllDrillScores,
  loadCipherPracticeHistory,
  type CipherPracticeHistory,
  type DrillHistoryRecord,
  type DrillProgressRecord,
  type DrillScoresRecord,
} from '../services/storage';
import type { DrillId, DrillProgress, OffsetsMode } from '../types';

export interface WarmupChoice {
  drillId: DrillId;
  cipher: CipherType;
  offsetsMode?: OffsetsMode;
}

export interface DrillWeightBreakdown {
  choice: WarmupChoice;
  weight: number;
  proficiency: number;
  skillNeed: number;
  recencyMultiplier: number;
  gateMultiplier: number;
  mean60s: number;
  masteredCount: number;
  lastPracticed: number;
}

export interface CipherQuoteWeightBreakdown {
  cipher: CipherType;
  weight: number;
  noveltyMultiplier: number;
  recencyMultiplier: number;
  count: number;
  lastPracticed: number;
}

interface DrillBenchmark {
  target60s: number;
  hasDeck: boolean;
}

const DRILL_BENCHMARKS: Record<DrillId, DrillBenchmark> = {
  offsetsLetterToNum: { target60s: 30, hasDeck: true },
  offsetsNumToLetter: { target60s: 30, hasDeck: true },
  atbash: { target60s: 28, hasDeck: true },
  pigpen: { target60s: 25, hasDeck: true },
  galactic: { target60s: 25, hasDeck: true },
  knights: { target60s: 25, hasDeck: true },
  tap: { target60s: 22, hasDeck: true },
};

const DECK_SIZE = 26;
const SKILL_FLOOR = 0.15;
const SKILL_DECAY_RATE = 2.0;
const RECENCY_MIN = 0.05;
const RECENCY_MAX = 2.5;
const RECENCY_TAU_HOURS = 36;
const OFFSETS_GATE_FLOOR = 0.2;
const OFFSETS_GATE_FULL_AT = 0.7;

const CIPHER_NOVELTY_BOOST = 1.2;
const CIPHER_NOVELTY_TAU_COUNT = 3;
const CIPHER_RECENCY_MIN = 0.08;
const CIPHER_RECENCY_MAX = 2.2;
const CIPHER_RECENCY_TAU_HOURS = 30;

function drawWeightedItem<T extends { weight: number }>(
  items: T[],
  rng: () => number
): T {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return items[0];
  }

  let cursor = rng() * totalWeight;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item;
    }
  }

  return items[items.length - 1];
}

function countMasteredCards(progress?: DrillProgress): number {
  if (!progress) return 0;
  return Object.values(progress).filter(
    (entry) => entry && typeof entry === 'object' && (entry.streak || 0) >= 3
  ).length;
}

function getEffectiveMean60s(
  drillId: DrillId,
  scores: DrillScoresRecord,
  history: DrillHistoryRecord
): number {
  const samples = history[drillId]?.recentSessions;
  if (samples && samples.length > 0) {
    const sum = samples.reduce((acc, item) => acc + item.score60s, 0);
    return sum / samples.length;
  }
  const allTimeBest = scores[drillId]?.best60s ?? 0;
  return allTimeBest > 0 ? allTimeBest * 0.85 : 0;
}

function computeDrillProficiency(
  drillId: DrillId,
  scores: DrillScoresRecord,
  progress: DrillProgressRecord,
  history: DrillHistoryRecord
): { proficiency: number; mean60s: number; masteredCount: number } {
  const benchmark = DRILL_BENCHMARKS[drillId];
  const mean60s = getEffectiveMean60s(drillId, scores, history);
  const speedRatio = Math.min(1.25, mean60s / benchmark.target60s);

  if (!benchmark.hasDeck) {
    return { proficiency: speedRatio, mean60s, masteredCount: 0 };
  }

  const masteredCount = countMasteredCards(progress[drillId]);
  const masteryRatio = Math.min(1, masteredCount / DECK_SIZE);
  const proficiency = 0.65 * speedRatio + 0.35 * masteryRatio;
  return { proficiency, mean60s, masteredCount };
}

function computeRecencyMultiplier(
  lastPracticed: number,
  now: number,
  minVal: number,
  maxVal: number,
  tauHours: number
): number {
  if (!lastPracticed || lastPracticed <= 0) {
    return maxVal;
  }
  const deltaHours = Math.max(0, (now - lastPracticed) / 3_600_000);
  return minVal + (maxVal - minVal) * (1 - Math.exp(-deltaHours / tauHours));
}

export function getWarmupCandidates(unlockedCiphers: CipherType[]): WarmupChoice[] {
  const choices: WarmupChoice[] = [
    { drillId: 'offsetsLetterToNum', cipher: 'offsets', offsetsMode: 'letterToNum' },
    { drillId: 'offsetsNumToLetter', cipher: 'offsets', offsetsMode: 'numToLetter' },
  ];

  for (const drill of IMPLEMENTED_DRILLS) {
    if (drill.id === 'offsets' || drill.kind !== 'lookup') continue;
    if (!unlockedCiphers.includes(drill.id)) continue;
    choices.push({
      drillId: drill.id as DrillId,
      cipher: drill.id,
    });
  }

  return choices;
}

export function computeWarmupWeights(params: {
  unlockedCiphers: CipherType[];
  scores: DrillScoresRecord;
  progress: DrillProgressRecord;
  history: DrillHistoryRecord;
  now?: number;
}): DrillWeightBreakdown[] {
  const { unlockedCiphers, scores, progress, history, now = Date.now() } = params;
  const candidates = getWarmupCandidates(unlockedCiphers);

  const l2n = computeDrillProficiency('offsetsLetterToNum', scores, progress, history);
  const n2l = computeDrillProficiency('offsetsNumToLetter', scores, progress, history);
  const combinedOffsetsProficiency = 0.5 * (l2n.proficiency + n2l.proficiency);
  const cipherGate =
    OFFSETS_GATE_FLOOR +
    (1 - OFFSETS_GATE_FLOOR) *
      Math.min(1, combinedOffsetsProficiency / OFFSETS_GATE_FULL_AT);

  return candidates.map((choice) => {
    const { proficiency, mean60s, masteredCount } = computeDrillProficiency(
      choice.drillId,
      scores,
      progress,
      history
    );
    const skillNeed =
      SKILL_FLOOR + (1 - SKILL_FLOOR) * Math.exp(-SKILL_DECAY_RATE * proficiency);
    const lastPracticed = history[choice.drillId]?.lastPracticed ?? 0;
    const recencyMultiplier = computeRecencyMultiplier(
      lastPracticed,
      now,
      RECENCY_MIN,
      RECENCY_MAX,
      RECENCY_TAU_HOURS
    );
    const gateMultiplier = choice.cipher === 'offsets' ? 1.0 : cipherGate;
    const weight = gateMultiplier * skillNeed * recencyMultiplier;

    return {
      choice,
      weight,
      proficiency,
      skillNeed,
      recencyMultiplier,
      gateMultiplier,
      mean60s,
      masteredCount,
      lastPracticed,
    };
  });
}

export function pickWeightedWarmupDrill(
  unlockedCiphers: CipherType[],
  now: number = Date.now(),
  rng: () => number = Math.random
): WarmupChoice {
  const breakdowns = computeWarmupWeights({
    unlockedCiphers,
    scores: loadAllDrillScores(),
    progress: loadAllDrillProgress(),
    history: loadAllDrillHistory(),
    now,
  });

  return drawWeightedItem(breakdowns, rng).choice;
}

export function computeCipherQuoteWeights(params: {
  unlockedCiphers: CipherType[];
  practiceHistory: CipherPracticeHistory;
  now?: number;
}): CipherQuoteWeightBreakdown[] {
  const { unlockedCiphers, practiceHistory, now = Date.now() } = params;
  const pool = unlockedCiphers.filter(
    (id) => id !== 'offsets' && IMPLEMENTED_DRILLS.some((d) => d.id === id)
  );

  return pool.map((cipher) => {
    const rec = practiceHistory[cipher];
    const count =
      rec && typeof rec.count === 'number' && Number.isFinite(rec.count) && rec.count > 0
        ? rec.count
        : 0;
    const lastPracticed =
      rec &&
      typeof rec.lastPracticed === 'number' &&
      Number.isFinite(rec.lastPracticed) &&
      rec.lastPracticed > 0
        ? rec.lastPracticed
        : 0;

    const noveltyMultiplier =
      1.0 + CIPHER_NOVELTY_BOOST * Math.exp(-count / CIPHER_NOVELTY_TAU_COUNT);
    const recencyMultiplier = computeRecencyMultiplier(
      lastPracticed,
      now,
      CIPHER_RECENCY_MIN,
      CIPHER_RECENCY_MAX,
      CIPHER_RECENCY_TAU_HOURS
    );
    const weight = noveltyMultiplier * recencyMultiplier;

    return {
      cipher,
      weight,
      noveltyMultiplier,
      recencyMultiplier,
      count,
      lastPracticed,
    };
  });
}

/**
 * Picks up to 2 distinct quote ciphers via weighted random sampling without replacement.
 * When both 'speed' and 'analysis' buckets have unlocked/implemented ciphers,
 * draws 1 weighted speed cipher + 1 weighted analysis cipher.
 */
export function pickWeightedWorkoutCiphers(
  unlockedCiphers: CipherType[],
  now: number = Date.now(),
  rng: () => number = Math.random
): CipherType[] {
  const breakdowns = computeCipherQuoteWeights({
    unlockedCiphers,
    practiceHistory: loadCipherPracticeHistory(),
    now,
  });

  if (breakdowns.length <= 1) {
    return breakdowns.map((b) => b.cipher);
  }

  const speedItems = breakdowns.filter((b) => getCipherBucket(b.cipher) === 'speed');
  const analysisItems = breakdowns.filter((b) => getCipherBucket(b.cipher) === 'analysis');

  if (speedItems.length > 0 && analysisItems.length > 0) {
    const chosenSpeed = drawWeightedItem(speedItems, rng).cipher;
    const chosenAnalysis = drawWeightedItem(analysisItems, rng).cipher;
    return [chosenSpeed, chosenAnalysis];
  }

  const first = drawWeightedItem(breakdowns, rng);
  const remaining = breakdowns.filter((b) => b.cipher !== first.cipher);
  const second = drawWeightedItem(remaining, rng);
  return [first.cipher, second.cipher];
}
