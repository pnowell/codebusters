import { isCipherType, type CipherType } from '../data/drills';

export interface Route {
  drill: CipherType | null;
  quoteId?: number;
}

export function parseUrlRoute(search = window.location.search): Route {
  const p = new URLSearchParams(search);
  const drill = p.get('drill');
  const q = p.get('q');
  const quoteId = q !== null ? parseInt(q, 10) : NaN;
  return {
    drill: isCipherType(drill) ? drill : null,
    quoteId: Number.isNaN(quoteId) ? undefined : quoteId,
  };
}

/** Returns a URL for the current path with drill/q set (or removed), preserving other params like ?unlocked. */
export function buildRouteUrl(route: Route): string {
  const p = new URLSearchParams(window.location.search);
  if (route.drill) p.set('drill', route.drill);
  else p.delete('drill');
  if (route.drill && route.quoteId !== undefined) p.set('q', String(route.quoteId));
  else p.delete('q');
  const qs = p.toString();
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}

export function parseUnlockedParam(search = window.location.search): CipherType[] | null {
  const raw = new URLSearchParams(search).get('unlocked');
  return raw ? raw.split(',').filter(isCipherType) : null;
}
