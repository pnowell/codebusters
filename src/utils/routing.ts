import { isCipherType, type CipherType } from '../data/drills';
import type {
  CaesarRangeMode,
  LetterMathMode,
  OffsetsMode,
} from '../types';

export type DrillSection = 'memorize' | 'cipher';
export type TestEditorTab = 'questions' | 'teams';

export interface Route {
  drill: CipherType | null;
  section?: DrillSection;
  offsetsMode?: OffsetsMode;
  letterMathMode?: LetterMathMode;
  caesarRange?: CaesarRangeMode;
  quoteId?: number;
  testId?: string;
  spectateAttemptId?: string;
  testsList?: boolean;
  resultsTestId?: string;
  editTest?: string;
  editTab?: TestEditorTab;
  quotesBrowser?: boolean;
}

function isOffsetsMode(val: string | null): val is OffsetsMode {
  return val === 'letterToNum' || val === 'numToLetter';
}

function isLetterMathMode(val: string | null): val is LetterMathMode {
  return (
    val === 'easy' ||
    val === 'hard' ||
    val === 'letterEasy' ||
    val === 'letterHard'
  );
}

function isCaesarRangeMode(val: string | null): val is CaesarRangeMode {
  return val === 'pm3' || val === 'any';
}

function isTestEditorTab(val: string | null): val is TestEditorTab {
  return val === 'questions' || val === 'teams';
}

const SAFE_TEST_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const SAFE_ATTEMPT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,240}$/;

export function getDefaultEditorTab(editTarget: string): TestEditorTab {
  return editTarget === 'new' ? 'questions' : 'teams';
}

export function parseUrlRoute(search = window.location.search): Route {
  const p = new URLSearchParams(search);
  const cipherParam = p.get('cipher');
  const drillParam = p.get('drill');
  const modeParam = p.get('mode');
  const q = p.get('q');
  const testRaw = p.get('test');
  const spectateRaw = p.get('spectate');
  const tests = p.get('tests');
  const resultsRaw = p.get('results');
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

  const testId =
    testRaw && SAFE_TEST_ID_RE.test(testRaw) ? testRaw : undefined;
  const spectateAttemptId =
    testId && spectateRaw && SAFE_ATTEMPT_ID_RE.test(spectateRaw)
      ? spectateRaw
      : undefined;
  const resultsTestId =
    resultsRaw && SAFE_TEST_ID_RE.test(resultsRaw) ? resultsRaw : undefined;
  const editTest =
    editTestRaw && SAFE_TEST_ID_RE.test(editTestRaw) ? editTestRaw : undefined;

  return {
    drill,
    section,
    offsetsMode:
      drill === 'offsets' && isOffsetsMode(modeParam) ? modeParam : undefined,
    letterMathMode:
      drill === 'letterMath' && isLetterMathMode(modeParam)
        ? modeParam
        : undefined,
    caesarRange:
      drill === 'caesar' && section === 'cipher' && isCaesarRangeMode(modeParam)
        ? modeParam
        : undefined,
    quoteId: Number.isNaN(quoteId) ? undefined : quoteId,
    testId,
    spectateAttemptId,
    testsList: tests === 'true' || tests === '1' || Boolean(resultsTestId),
    resultsTestId,
    editTest,
    editTab: editTest
      ? isTestEditorTab(tabParam)
        ? tabParam
        : getDefaultEditorTab(editTest)
      : undefined,
    quotesBrowser: quotesParam === 'true' || quotesParam === '1',
  };
}

/** Returns a URL for the current path with drill/cipher/mode/q/test/spectate/tests/results/editTest/quotes set (or removed). */
export function buildRouteUrl(route: Route): string {
  const p = new URLSearchParams(window.location.search);
  p.delete('unlocked');
  p.delete('_v');
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

  if (route.drill === 'offsets' && route.offsetsMode) {
    p.set('mode', route.offsetsMode);
  } else if (route.drill === 'letterMath' && route.letterMathMode) {
    p.set('mode', route.letterMathMode);
  } else if (
    route.drill === 'caesar' &&
    route.section === 'cipher' &&
    route.caesarRange &&
    route.caesarRange !== 'pm3'
  ) {
    p.set('mode', route.caesarRange);
  } else {
    p.delete('mode');
  }

  if (route.drill && route.quoteId !== undefined) p.set('q', String(route.quoteId));
  else p.delete('q');
  if (route.testId) p.set('test', route.testId);
  else p.delete('test');
  if (route.testId && route.spectateAttemptId) p.set('spectate', route.spectateAttemptId);
  else p.delete('spectate');
  if (route.testsList) p.set('tests', 'true');
  else p.delete('tests');
  if (route.resultsTestId) p.set('results', route.resultsTestId);
  else p.delete('results');
  if (route.editTest) p.set('editTest', route.editTest);
  else p.delete('editTest');
  if (
    route.editTest &&
    route.editTab &&
    route.editTab !== getDefaultEditorTab(route.editTest)
  ) {
    p.set('tab', route.editTab);
  } else {
    p.delete('tab');
  }
  if (route.quotesBrowser) p.set('quotes', 'true');
  else p.delete('quotes');
  const qs = p.toString();
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}
