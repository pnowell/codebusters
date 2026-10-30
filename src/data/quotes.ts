import quotesData from './quotes.json';
import type { Quote, QuoteCategory, CryptanalysisTier } from '../types';
import { loadCompletedQuoteIds } from '../services/storage';

const ALL_QUOTES = quotesData as Quote[];

/** Quotes clean and suitable for 5th graders (no archaic language, no intentional typos) */
const CLEAN_QUOTES = ALL_QUOTES.filter(q => !q.isArchaic && !q.isMisspelled);

/** Maximum length for symbol lookup drills to prevent excessive wrapping on mobile */
const MAX_LOOKUP_LENGTH = 75;

/** Lookup-eligible quotes (clean and not excessively long) */
const LOOKUP_ELIGIBLE_QUOTES = CLEAN_QUOTES.filter(q => q.length <= MAX_LOOKUP_LENGTH);

const KID_LOOKUP_POOL = LOOKUP_ELIGIBLE_QUOTES.filter(q => q.category && q.category !== 'general');
const GENERAL_LOOKUP_POOL = LOOKUP_ELIGIBLE_QUOTES.filter(q => !q.category || q.category === 'general');

/** Fast O(1) lookup table indexed by permanent, stable quote ID */
const QUOTES_BY_ID = new Map<number, Quote>(ALL_QUOTES.map(q => [q.id, q]));

/** Retrieve a quote by its stable ID */
export function getQuoteById(id: number): Quote | undefined {
  return QUOTES_BY_ID.get(id);
}

/**
 * Picks a random quote for symbol lookup drills (Pigpen, Galactic, Atbash):
 * - Filters out quotes already completed by the user.
 * - Prefers kid-friendly quotes (~80% chance) while still drawing from the clean general pool (~20% chance).
 * - Avoids archaic language and misspelled quotes completely.
 * - Caps length at MAX_LOOKUP_LENGTH (75 chars) so quotes are not excessively long.
 * - Gracefully falls back if the completed list exhausts the uncompleted pool.
 */
function pickRandomLookupQuote(): Quote {
  const completedSet = new Set(loadCompletedQuoteIds());

  // Filter out completed quotes from both pools
  const uncompletedKid = KID_LOOKUP_POOL.filter(q => !completedSet.has(q.id));
  const uncompletedGeneral = GENERAL_LOOKUP_POOL.filter(q => !completedSet.has(q.id));

  // Determine active candidates (falling back to full pools if uncompleted quotes are exhausted)
  const kidCandidates = uncompletedKid.length > 0 ? uncompletedKid : KID_LOOKUP_POOL;
  const generalCandidates = uncompletedGeneral.length > 0 ? uncompletedGeneral : GENERAL_LOOKUP_POOL;

  // 80% preference for kid-friendly jokes/facts/lyrics/movies, 20% for clean general quotes
  const preferKid = Math.random() < 0.8;
  const primary = preferKid ? kidCandidates : generalCandidates;
  const secondary = preferKid ? generalCandidates : kidCandidates;

  const chosenPool = primary.length > 0 ? primary : (secondary.length > 0 ? secondary : ALL_QUOTES);

  return chosenPool[Math.floor(Math.random() * chosenPool.length)] ?? ALL_QUOTES[0];
}

/**
 * Resolves a quote for symbol lookup drills:
 * - If `preferredId` is specified (e.g. via deep-link URL ?q=123):
 *   Returns the Quote if found, or null if the quote does not exist (removed or retired).
 * - If `preferredId` is undefined:
 *   Returns a random eligible lookup quote.
 */
export function pickLookupQuote(preferredId?: number): Quote | null {
  if (preferredId !== undefined) {
    return getQuoteById(preferredId) ?? null;
  }
  return pickRandomLookupQuote();
}

export function getQuotesByTier(tier: CryptanalysisTier): Quote[] {
  return CLEAN_QUOTES.filter(q => q.tier === tier);
}

export function getQuotesByCategory(category: QuoteCategory): Quote[] {
  return CLEAN_QUOTES.filter(q => q.category === category);
}
