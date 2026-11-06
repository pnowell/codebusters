import { isCipherType, type CipherType } from '../data/drills';
import type { OffsetsMode } from '../types';

export type DrillSection = 'memorize' | 'cipher';
export type TestEditorTab = 'questions' | 'teams';

export interface Route {
  drill: CipherType | null;
  section?: DrillSection;
  offsetsMode?: OffsetsMode;
  quoteId?: number;
  testId?: string;
  testsList?: boolean;
  resultsTestId?: string;
  editTest?: string;
  editTab?: TestEditorTab;
  quotesBrowser?: boolean;
}

function isOffsetsMode(val: string | null): val is OffsetsMode {
  return val === 'letterToNum' || val === 'numToLetter';
}

function isTestEditorTab(val: string | null): val is TestEditorTab {
  return val === 'questions' || val === 'teams';
}

const SAFE_TEST_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function parseUrlRoute(search = window.location.search): Route {
  const p = new URLSearchParams(search);
  const cipherParam = p.get('cipher');
  const drillParam = p.get('drill');
  const modeParam = p.get('mode');
  const q = p.get('q');
  const test = p.get('test');
  const tests = p.get('tests');
  const results = p.get('results');
  const editTestRaw = p.get('editTest');
  const tabParam = p.get('tab');
  const quotesParam = p.get('quotes');
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

  const editTest =
    editTestRaw && SAFE_TEST_ID_RE.test(editTestRaw) ? editTestRaw : undefined;

  return {
    drill,
    section,
    offsetsMode: drill === 'offsets' && isOffsetsMode(modeParam) ? modeParam : undefined,
    quoteId: Number.isNaN(quoteId) ? undefined : quoteId,
    testId: test || undefined,
    testsList: tests === 'true' || tests === '1' || Boolean(results),
    resultsTestId: results || undefined,
    editTest,
    editTab: editTest && isTestEditorTab(tabParam) ? tabParam : undefined,
    quotesBrowser: quotesParam === 'true' || quotesParam === '1',
  };
}

/** Returns a URL for the current path with drill/cipher/mode/q/test/tests/results/editTest/quotes set (or removed). */
export function buildRouteUrl(route: Route): string {
  const p = new URLSearchParams(window.location.search);
  p.delete('unlocked');
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

  if (route.drill === 'offsets' && route.offsetsMode) p.set('mode', route.offsetsMode);
  else p.delete('mode');

  if (route.drill && route.quoteId !== undefined) p.set('q', String(route.quoteId));
  else p.delete('q');
  if (route.testId) p.set('test', route.testId);
  else p.delete('test');
  if (route.testsList) p.set('tests', 'true');
  else p.delete('tests');
  if (route.resultsTestId) p.set('results', route.resultsTestId);
  else p.delete('results');
  if (route.editTest) p.set('editTest', route.editTest);
  else p.delete('editTest');
  if (route.editTest && route.editTab && route.editTab !== 'questions') {
    p.set('tab', route.editTab);
  } else {
    p.delete('tab');
  }
  if (route.quotesBrowser) p.set('quotes', 'true');
  else p.delete('quotes');
  const qs = p.toString();
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}
