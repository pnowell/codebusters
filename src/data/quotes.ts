import quotesData from './quotes.json';
import type {
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
 */
export function isQuoteEligibleForCipher(
  quote: Quote,
  cipher?: CipherType
): boolean {
  if (cipher === 'tap') {
    return !hasCriticalNonLetterChars(quote.quote);
  }
  return true;
}

/**
 * Picks a random unflagged, non-reserved lookup-eligible quote (excluding any
 * caller-supplied IDs, such as quotes already used in the current practice test),
 * respecting cipher-specific character constraints (e.g. Tap Code).
 */
export function pickRandomCleanLookupQuote(
  excludeIds?: ReadonlySet<number>,
  cipher?: CipherType
): Quote {
  const flaggedIds = getFlaggedQuoteIds();
  const reservedIds = getReservedTestQuoteIds();
  const cipherEligible = LOOKUP_ELIGIBLE_QUOTES.filter(q =>
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
      : LOOKUP_ELIGIBLE_QUOTES;
  return pool[Math.floor(Math.random() * pool.length)] ?? ALL_QUOTES[0];
}

/**
 * Picks a random quote for symbol lookup / cipher exercises:
 * - Filters out quotes flagged by teachers (`quote_flags`), quotes reserved in active
 *   or draft practice tests (`reserved_quotes`), quotes ineligible for `cipher`,
 *   and quotes already completed by the user.
 * - Prefers kid-friendly quotes (~80% chance) while still drawing from the general pool (~20% chance).
 * - Caps length at MAX_LOOKUP_LENGTH (75 chars) so quotes are not excessively long.
 * - Gracefully falls back if the completed list exhausts the uncompleted pool.
 */
function pickRandomLookupQuote(
  excludeId?: number,
  cipher?: CipherType
): Quote {
  const completedSet = new Set(loadCompletedQuoteIds());
  const flaggedSet = getFlaggedQuoteIds();
  const reservedSet = getReservedTestQuoteIds();

  const safeKidPool = KID_LOOKUP_POOL.filter(
    q =>
      !flaggedSet.has(q.id) &&
      !reservedSet.has(q.id) &&
      isQuoteEligibleForCipher(q, cipher)
  );
  const safeGeneralPool = GENERAL_LOOKUP_POOL.filter(
    q =>
      !flaggedSet.has(q.id) &&
      !reservedSet.has(q.id) &&
      isQuoteEligibleForCipher(q, cipher)
  );

  // Filter out completed quotes (and current quote if requesting "New") from both pools
  const uncompletedKid = safeKidPool.filter(
    q => !completedSet.has(q.id) && q.id !== excludeId
  );
  const uncompletedGeneral = safeGeneralPool.filter(
    q => !completedSet.has(q.id) && q.id !== excludeId
  );

  const nonCurrentKid = safeKidPool.filter(q => q.id !== excludeId);
  const nonCurrentGeneral = safeGeneralPool.filter(q => q.id !== excludeId);

  // Determine active candidates (falling back to non-current unflagged/unreserved pools if uncompleted quotes are exhausted)
  const kidCandidates =
    uncompletedKid.length > 0
      ? uncompletedKid
      : nonCurrentKid.length > 0
      ? nonCurrentKid
      : safeKidPool;
  const generalCandidates =
    uncompletedGeneral.length > 0
      ? uncompletedGeneral
      : nonCurrentGeneral.length > 0
      ? nonCurrentGeneral
      : safeGeneralPool;

  // 80% preference for kid-friendly jokes/facts/lyrics/movies, 20% for general quotes
  const preferKid = Math.random() < 0.8;
  const primary = preferKid ? kidCandidates : generalCandidates;
  const secondary = preferKid ? generalCandidates : kidCandidates;

  const fallbackEligible = LOOKUP_ELIGIBLE_QUOTES.filter(
    q =>
      !flaggedSet.has(q.id) &&
      !reservedSet.has(q.id) &&
      isQuoteEligibleForCipher(q, cipher)
  );
  const cipherFallback = LOOKUP_ELIGIBLE_QUOTES.filter(q =>
    isQuoteEligibleForCipher(q, cipher)
  );

  const chosenPool =
    primary.length > 0
      ? primary
      : secondary.length > 0
      ? secondary
      : fallbackEligible.length > 0
      ? fallbackEligible
      : cipherFallback.length > 0
      ? cipherFallback
      : LOOKUP_ELIGIBLE_QUOTES;

  return chosenPool[Math.floor(Math.random() * chosenPool.length)] ?? ALL_QUOTES[0];
}

/**
 * Resolves a quote for symbol lookup / cipher exercises:
 * - If `preferredId` is specified (e.g. via deep-link URL ?q=123):
 *   Returns the Quote if found, or null if the quote does not exist (removed or retired).
 * - If `preferredId` is undefined:
 *   Returns a random eligible lookup quote for `cipher` (optionally excluding `excludeId`).
 */
export function pickLookupQuote(
  preferredId?: number,
  excludeId?: number,
  cipher?: CipherType
): Quote | null {
  if (preferredId !== undefined) {
    return getQuoteById(preferredId) ?? null;
  }
  return pickRandomLookupQuote(excludeId, cipher);
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
