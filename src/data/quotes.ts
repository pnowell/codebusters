import quotesData from './quotes.json';
import type {
  AristocratDifficulty,
  CipherType,
  CryptanalysisTier,
  Quote,
  QuoteCategory,
} from '../types';
import { loadCompletedQuoteIds } from '../services/storage';
import { getFlaggedQuoteIds } from '../services/quoteFlagService';
import { getReservedTestQuoteIds } from '../services/classroomConfigService';
import { hasCriticalNonLetterChars } from '../utils/ciphers';

const ALL_QUOTES = quotesData as Quote[];

/** Maximum length for symbol lookup drills to prevent excessive wrapping on mobile */
export const MAX_LOOKUP_LENGTH = 75;

/** Lookup-eligible quotes (not excessively long for mobile tile grids) */
const LOOKUP_ELIGIBLE_QUOTES = ALL_QUOTES.filter(q => q.length <= MAX_LOOKUP_LENGTH);

/** Aristocrat-eligible quotes (excludes very short lookup-only quotes; uncapped above 75 chars) */
const ARISTOCRAT_ELIGIBLE_QUOTES = ALL_QUOTES.filter(q => q.tier !== 'short_drill');

const KID_LOOKUP_POOL = LOOKUP_ELIGIBLE_QUOTES.filter(
  q => q.category && q.category !== 'general'
);
const GENERAL_LOOKUP_POOL = LOOKUP_ELIGIBLE_QUOTES.filter(
  q => !q.category || q.category === 'general'
);

/** Fast O(1) lookup table indexed by permanent, stable quote ID */
const QUOTES_BY_ID = new Map<number, Quote>(ALL_QUOTES.map(q => [q.id, q]));

/** Returns all quotes in the database for teacher inspection and curation */
export function getAllQuotes(): readonly Quote[] {
  return ALL_QUOTES;
}

/** Retrieve a quote by its stable ID */
export function getQuoteById(id: number): Quote | undefined {
  return QUOTES_BY_ID.get(id);
}

/**
 * Returns whether a quote is suitable for random/picker selection for `cipher`.
 * Continuous-stream ciphers (`tap`) exclude quotes with critical non-letter,
 * non-punctuation characters (such as digits `0-9` or `&`).
 * Aristocrat excludes `short_drill` quotes that lack sufficient cryptanalysis context.
 */
export function isQuoteEligibleForCipher(
  quote: Quote,
  cipher?: CipherType
): boolean {
  if (cipher === 'tap') {
    return !hasCriticalNonLetterChars(quote.quote);
  }
  if (cipher === 'aristocrat') {
    return quote.tier !== 'short_drill';
  }
  return true;
}

/**
 * Picks a random unflagged, non-reserved quote for Practice Test authoring
 * (excluding any caller-supplied IDs, such as quotes already used in the current practice test),
 * using the uncapped Aristocrat pool when `cipher === 'aristocrat'`.
 */
export function pickRandomCleanLookupQuote(
  excludeIds?: ReadonlySet<number>,
  cipher?: CipherType
): Quote {
  const flaggedIds = getFlaggedQuoteIds();
  const reservedIds = getReservedTestQuoteIds();
  const basePool =
    cipher === 'aristocrat' ? ARISTOCRAT_ELIGIBLE_QUOTES : LOOKUP_ELIGIBLE_QUOTES;
  const cipherEligible = basePool.filter(q =>
    isQuoteEligibleForCipher(q, cipher)
  );
  const candidates = cipherEligible.filter(
    q =>
      !flaggedIds.has(q.id) &&
      !reservedIds.has(q.id) &&
      !excludeIds?.has(q.id)
  );
  const unreservedUnflagged = cipherEligible.filter(
    q => !flaggedIds.has(q.id) && !reservedIds.has(q.id)
  );
  const unflagged = cipherEligible.filter(q => !flaggedIds.has(q.id));
  const pool =
    candidates.length > 0
      ? candidates
      : unreservedUnflagged.length > 0
      ? unreservedUnflagged
      : unflagged.length > 0
      ? unflagged
      : cipherEligible.length > 0
      ? cipherEligible
      : basePool;
  return pool[Math.floor(Math.random() * pool.length)] ?? ALL_QUOTES[0];
}

const MAX_RIDDLE_OR_FUN_FACT_SHARE = 0.4;

function isRiddleOrFunFactQuote(q: Quote): boolean {
  return (
    q.category === 'kid_joke' ||
    q.category === 'kid_science' ||
    Boolean(q.tags?.includes('riddle') || q.tags?.includes('fun_fact'))
  );
}

function pickWeightedBucket<T>(
  primary: readonly T[],
  secondary: readonly T[],
  primaryWeight: number
): readonly T[] {
  if (primary.length > 0 && secondary.length > 0) {
    return Math.random() < primaryWeight ? primary : secondary;
  }
  return primary.length > 0 ? primary : secondary;
}

function pickFromKidAndGeneralPools(
  basePool: readonly Quote[],
  excludeId: number | undefined,
  cipher: CipherType | undefined
): Quote {
  const completedSet = new Set(loadCompletedQuoteIds());
  const flaggedSet = getFlaggedQuoteIds();
  const reservedSet = getReservedTestQuoteIds();

  const eligiblePool = basePool.filter(
    q =>
      !flaggedSet.has(q.id) &&
      !reservedSet.has(q.id) &&
      isQuoteEligibleForCipher(q, cipher)
  );
  const cipherFallback = basePool.filter(q =>
    isQuoteEligibleForCipher(q, cipher)
  );
  const workingPool =
    eligiblePool.length > 0
      ? eligiblePool
      : cipherFallback.length > 0
      ? cipherFallback
      : basePool;

  const nonCurrent = workingPool.filter(q => q.id !== excludeId);
  const nonCurrentOrAll = nonCurrent.length > 0 ? nonCurrent : workingPool;
  const uncompleted = nonCurrentOrAll.filter(q => !completedSet.has(q.id));
  const candidatePool = uncompleted.length > 0 ? uncompleted : nonCurrentOrAll;

  const riddleOrFunFactPool = candidatePool.filter(isRiddleOrFunFactQuote);
  const otherPool = candidatePool.filter(q => !isRiddleOrFunFactQuote(q));

  // Cap riddle + fun_fact quotes at <= 40% (never more than half the time)
  let chosenPool = pickWeightedBucket(
    riddleOrFunFactPool,
    otherPool,
    MAX_RIDDLE_OR_FUN_FACT_SHARE
  );

  // Within non-riddle/fun-fact quotes, give movie/book/lyric quotes a modest 20% share when present
  if (chosenPool === otherPool) {
    const storyKidPool = otherPool.filter(
      q => q.category && q.category !== 'general'
    );
    const generalPool = otherPool.filter(
      q => !q.category || q.category === 'general'
    );
    chosenPool = pickWeightedBucket(storyKidPool, generalPool, 0.2);
  }

  return chosenPool[Math.floor(Math.random() * chosenPool.length)] ?? ALL_QUOTES[0];
}

/**
 * Picks a random quote for symbol lookup or Aristocrat exercises:
 * - For `aristocrat`: draws from `ARISTOCRAT_ELIGIBLE_QUOTES` filtered by `aristocratDifficulty` (`easy` | `medium` | `hard`).
 * - For all other ciphers: caps length at `MAX_LOOKUP_LENGTH` (75 chars) via `LOOKUP_ELIGIBLE_QUOTES`.
 */
function pickRandomLookupQuote(
  excludeId?: number,
  cipher?: CipherType,
  aristocratDifficulty?: AristocratDifficulty
): Quote {
  if (cipher === 'aristocrat') {
    const targetTier: AristocratDifficulty = aristocratDifficulty ?? 'easy';
    const tierPool = ARISTOCRAT_ELIGIBLE_QUOTES.filter(q => q.tier === targetTier);
    const pool = tierPool.length > 0 ? tierPool : ARISTOCRAT_ELIGIBLE_QUOTES;
    return pickFromKidAndGeneralPools(pool, excludeId, cipher);
  }

  return pickFromKidAndGeneralPools(
    [...KID_LOOKUP_POOL, ...GENERAL_LOOKUP_POOL],
    excludeId,
    cipher
  );
}

/**
 * Resolves a quote for symbol lookup / cipher exercises:
 * - If `preferredId` is specified (e.g. via deep-link URL ?q=123):
 *   Returns the Quote if found, or null if the quote does not exist (removed or retired).
 * - If `preferredId` is undefined:
 *   Returns a random eligible quote for `cipher` (optionally filtered by `aristocratDifficulty`).
 */
export function pickLookupQuote(
  preferredId?: number,
  excludeId?: number,
  cipher?: CipherType,
  aristocratDifficulty?: AristocratDifficulty
): Quote | null {
  if (preferredId !== undefined) {
    return getQuoteById(preferredId) ?? null;
  }
  return pickRandomLookupQuote(excludeId, cipher, aristocratDifficulty);
}

export function getQuotesByTier(tier: CryptanalysisTier): Quote[] {
  const flaggedSet = getFlaggedQuoteIds();
  const reservedSet = getReservedTestQuoteIds();
  return ALL_QUOTES.filter(
    q => q.tier === tier && !flaggedSet.has(q.id) && !reservedSet.has(q.id)
  );
}

export function getQuotesByCategory(category: QuoteCategory): Quote[] {
  const flaggedSet = getFlaggedQuoteIds();
  const reservedSet = getReservedTestQuoteIds();
  return ALL_QUOTES.filter(
    q =>
      q.category === category &&
      !flaggedSet.has(q.id) &&
      !reservedSet.has(q.id)
  );
}
