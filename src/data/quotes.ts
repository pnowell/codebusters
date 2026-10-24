import quotesData from './quotes.json';
import type { Quote, QuoteCategory, CryptanalysisTier } from '../types';

export const ALL_QUOTES = quotesData as Quote[];

/** Quotes clean and suitable for 5th graders (no archaic language, no intentional typos) */
export const CLEAN_QUOTES = ALL_QUOTES.filter(q => !q.isArchaic && !q.isMisspelled);

/** Short quotes ideal for symbol lookup drills (Pigpen, Galactic, Atbash) */
export const LOOKUP_POOL = CLEAN_QUOTES.filter(q => q.length <= 65);

export function pickLookupQuote(preferredId?: number): Quote {
  if (preferredId !== undefined) {
    const found = ALL_QUOTES.find(q => q.id === preferredId);
    if (found) return found;
  }
  const pool = LOOKUP_POOL.length > 0 ? LOOKUP_POOL : ALL_QUOTES;
  return pool[Math.floor(Math.random() * pool.length)] ?? ALL_QUOTES[0];
}

export function getQuotesByTier(tier: CryptanalysisTier): Quote[] {
  return CLEAN_QUOTES.filter(q => q.tier === tier);
}

export function getQuotesByCategory(category: QuoteCategory): Quote[] {
  return CLEAN_QUOTES.filter(q => q.category === category);
}
