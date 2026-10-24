import quotesData from './quotes.json';
import type { Quote, QuoteCategory, CryptanalysisTier } from '../types';
import { loadCompletedQuoteIds } from '../services/storage';

export const ALL_QUOTES = quotesData as Quote[];

/** Quotes clean and suitable for 5th graders (no archaic language, no intentional typos) */
export const CLEAN_QUOTES = ALL_QUOTES.filter(q => !q.isArchaic && !q.isMisspelled);

/** Maximum length for symbol lookup drills to prevent excessive wrapping on mobile */
export const MAX_LOOKUP_LENGTH = 75;

/** Lookup-eligible quotes (clean and not excessively long) */
export const LOOKUP_ELIGIBLE_QUOTES = CLEAN_QUOTES.filter(q => q.length <= MAX_LOOKUP_LENGTH);

export const KID_LOOKUP_POOL = LOOKUP_ELIGIBLE_QUOTES.filter(q => q.category && q.category !== 'general');
export const GENERAL_LOOKUP_POOL = LOOKUP_ELIGIBLE_QUOTES.filter(q => !q.category || q.category === 'general');

/**
 * Picks a quote for symbol lookup drills (Pigpen, Galactic, Atbash):
 * - If `preferredId` is specified (e.g. via deep-link URL ?q=123), returns that specific quote.
 * - Filters out quotes already completed by the user (unless deep-linked).
 * - Prefers kid-friendly quotes (~80% chance) while still drawing from the clean general pool (~20% chance).
 * - Avoids archaic language and misspelled quotes completely.
 * - Caps length at MAX_LOOKUP_LENGTH (75 chars) so quotes are not excessively long.
 * - Gracefully falls back if the completed list exhausts the uncompleted pool.
 */
export function pickLookupQuote(preferredId?: number): Quote {
  if (preferredId !== undefined) {
    const found = ALL_QUOTES.find(q => q.id === preferredId);
    if (found) return found;
  }

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

export function getQuotesByTier(tier: CryptanalysisTier): Quote[] {
  return CLEAN_QUOTES.filter(q => q.tier === tier);
}

export function getQuotesByCategory(category: QuoteCategory): Quote[] {
  return CLEAN_QUOTES.filter(q => q.category === category);
}
