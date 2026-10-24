import quotesData from './quotes.json';
import type { Quote } from '../types';

const ALL_QUOTES = quotesData as Quote[];
const LOOKUP_POOL = ALL_QUOTES.filter(q => q.length <= 60);

export function pickLookupQuote(preferredId?: number): Quote {
  if (preferredId !== undefined) {
    const found = ALL_QUOTES.find(q => q.id === preferredId);
    if (found) return found;
  }
  return LOOKUP_POOL[Math.floor(Math.random() * LOOKUP_POOL.length)] ?? ALL_QUOTES[0];
}
