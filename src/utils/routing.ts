import { isCipherType, type CipherType } from '../data/drills';

export type DrillSection = 'memorize' | 'cipher';

export interface Route {
  drill: CipherType | null;
  section?: DrillSection;
  quoteId?: number;
  testId?: string;
  testsList?: boolean;
  resultsTestId?: string;
}

export function parseUrlRoute(search = window.location.search): Route {
  const p = new URLSearchParams(search);
  const cipherParam = p.get('cipher');
  const drillParam = p.get('drill');
  const q = p.get('q');
  const test = p.get('test');
  const tests = p.get('tests');
  const results = p.get('results');
  const quoteId = q !== null ? parseInt(q, 10) : NaN;

  let drill: CipherType | null = null;
  let section: DrillSection = 'memorize';

  if (cipherParam && isCipherType(cipherParam)) {
    drill = cipherParam;
    section = 'cipher';
  } else if (drillParam && isCipherType(drillParam)) {
    drill = drillParam;
    section = 'memorize';
  }

  return {
    drill,
    section,
    quoteId: Number.isNaN(quoteId) ? undefined : quoteId,
    testId: test || undefined,
    testsList: tests === 'true' || tests === '1' || Boolean(results),
    resultsTestId: results || undefined,
  };
}

/** Returns a URL for the current path with drill/cipher/q/test/tests/results set (or removed), preserving other params like ?unlocked. */
export function buildRouteUrl(route: Route): string {
  const p = new URLSearchParams(window.location.search);
  if (route.drill) {
    if (route.section === 'cipher') {
      p.set('cipher', route.drill);
      p.delete('drill');
    } else {
      p.set('drill', route.drill);
      p.delete('cipher');
    }
  } else {
    p.delete('drill');
    p.delete('cipher');
  }

  if (route.drill && route.quoteId !== undefined) p.set('q', String(route.quoteId));
  else p.delete('q');
  if (route.testId) p.set('test', route.testId);
  else p.delete('test');
  if (route.testsList) p.set('tests', 'true');
  else p.delete('tests');
  if (route.resultsTestId) p.set('results', route.resultsTestId);
  else p.delete('results');
  const qs = p.toString();
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}

export function parseUnlockedParam(search = window.location.search): CipherType[] | null {
  const raw = new URLSearchParams(search).get('unlocked');
  return raw ? raw.split(',').filter(isCipherType) : null;
}
