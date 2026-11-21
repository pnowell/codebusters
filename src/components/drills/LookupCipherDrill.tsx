import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { DrillHeader } from './shared/DrillHeader';
import { DrillOverflowMenu, type DrillModeOption } from './shared/DrillOverflowMenu';
import { CollapsibleReference } from './shared/CollapsibleReference';
import { ReferenceSheet } from './shared/ReferenceSheet';
import { DrillActionRow } from './shared/DrillActionRow';
import { ResultBanner } from './shared/ResultBanner';
import { QuoteTileGrid } from './shared/QuoteTileGrid';
import {
  applyAristocratEdit,
  aristocratEncryptText,
  computeCiphertextFrequencies,
  deterministicAristocratAlphabet,
  generateAristocratHint,
  isValidAristocratAlphabet,
} from '../../utils/aristocrat';
import {
  deterministicCaesarOffset,
  deterministicVigenereKeyword,
  evaluateSolution,
  isLetter,
  pickRandomCaesarOffset,
  pickRandomVigenereKeyword,
  sanitizeVigenereKeyword,
  shouldCountQuoteCompleted,
} from '../../utils/ciphers';
import { isAristocratDifficulty } from '../../utils/routing';
import {
  buildCipherSessionKey,
  buildShareLinkUrl,
  encodeShareToken,
  MEANINGFULLY_SEEN_TIMEOUT_SEC,
  type ShareLinkConfig,
} from '../../utils/shareLink';
import {
  formatCipherPace,
  formatClock,
  formatSolveDuration,
} from '../../utils/format';
import { usePuzzleElapsedTimer } from '../../hooks/usePuzzleElapsedTimer';
import { getQuoteById, pickLookupQuote } from '../../data/quotes';
import { getDrill, type TestableCipherType } from '../../data/drills';
import {
  clearActiveCipherSession,
  loadActiveCipherSession,
  recordCipherPractice,
  saveActiveCipherSession,
  saveCompletedQuoteId,
} from '../../services/storage';
import {
  logCipherSolvedEvent,
  logCipherStartedEvent,
} from '../../services/eventLogger';
import type {
  ActiveCipherSessionSnapshot,
  AristocratDifficulty,
  AristocratEditAction,
  AristocratWorkspaceState,
  CaesarRangeMode,
  CipherPracticeSource,
  CipherWorkspaceParams,
  EvaluationResult,
  Quote,
  WorkoutStepContext,
} from '../../types';

const ARISTOCRAT_DIFFICULTY_OPTIONS: readonly DrillModeOption<AristocratDifficulty>[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
];

const ARISTOCRAT_DIFFICULTY_LABELS: Record<AristocratDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export interface MeaningfullySeenEvent {
  cipher: TestableCipherType;
  quoteId: number;
  source: CipherPracticeSource;
}

interface LookupCipherDrillProps {
  cipher: TestableCipherType;
  caesarRange?: CaesarRangeMode;
  aristocratDifficulty?: AristocratDifficulty;
  onAristocratDifficultyChange?: (nextMode: AristocratDifficulty) => void;
  onBack: () => void;
  isTeacher?: boolean;
  /** Teacher-only `?q=<id>` override */
  initialQuoteId?: number;
  /** Teacher-only `?offset=<shift>` override for Caesar demonstrations */
  initialCaesarOffset?: number;
  onClearExplicitQuote?: () => void;
  /** Decoded `?share=<token>` exercise config */
  shareToken?: string;
  sharedConfig?: ShareLinkConfig | null;
  invalidShareToken?: boolean;
  workoutContext?: WorkoutStepContext;
  /** Telemetry hook for Issue #25 `cipher_started` logging */
  onMeaningfullySeen?: (event: MeaningfullySeenEvent) => void;
}

interface PuzzleState {
  quote: Quote;
  userInputs: string[];
  keyInputs: string[];
  caesarOffset?: number;
  vigenereKeyword?: string;
  aristocratSeed?: number;
  aristocratHintVariant?: number;
  aristocratAlphabet?: string;
  aristocratCipherChars?: string[];
  aristocratFrequencies?: Record<string, number>;
  aristocratState?: AristocratWorkspaceState;
  aristocratHint?: string | null;
}

function pickRandomAristocratSeed(prevAlphabet?: string): {
  seed: number;
  alphabet: string;
} {
  for (let i = 0; i < 16; i += 1) {
    let rawSeed = 1;
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.getRandomValues === 'function'
    ) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      rawSeed = buf[0] >>> 0;
    } else {
      rawSeed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
    }
    const seed = rawSeed === 0 ? 1 : rawSeed;
    const alphabet = deterministicAristocratAlphabet(seed);
    if (!prevAlphabet || alphabet !== prevAlphabet) {
      return { seed, alphabet };
    }
  }
  const fallbackSeed = 1;
  return {
    seed: fallbackSeed,
    alphabet: deterministicAristocratAlphabet(fallbackSeed),
  };
}

function freshPuzzle(
  quote: Quote,
  cipher: TestableCipherType,
  caesarRange: CaesarRangeMode,
  aristocratDifficulty: AristocratDifficulty,
  options?: {
    deterministic?: boolean;
    explicitCaesarOffset?: number;
    prevOffset?: number;
    prevKeyword?: string;
    prevAlphabet?: string;
    sharedConfig?: ShareLinkConfig;
  }
): PuzzleState {
  const chars = quote.quote.toUpperCase().split('');
  const emptyInputs = chars.map((c) => (isLetter(c) ? '' : c));
  const shared = options?.sharedConfig;

  const caesarOffset =
    cipher === 'caesar'
      ? shared?.caesarOffset !== undefined
        ? shared.caesarOffset
        : options?.explicitCaesarOffset !== undefined
          ? options.explicitCaesarOffset
          : options?.deterministic
            ? deterministicCaesarOffset(quote.id, caesarRange)
            : pickRandomCaesarOffset(caesarRange, options?.prevOffset)
      : undefined;

  const vigenereKeyword =
    cipher === 'vigenere'
      ? shared?.vigenereKeyword
        ? sanitizeVigenereKeyword(shared.vigenereKeyword) ||
          deterministicVigenereKeyword(quote.id)
        : options?.deterministic
          ? deterministicVigenereKeyword(quote.id)
          : pickRandomVigenereKeyword(options?.prevKeyword)
      : undefined;

  if (cipher === 'aristocrat') {
    let aristocratSeed: number;
    let aristocratAlphabet: string;
    if (shared?.aristocratSeed !== undefined) {
      aristocratSeed = shared.aristocratSeed >>> 0;
      aristocratAlphabet = deterministicAristocratAlphabet(aristocratSeed);
    } else if (options?.deterministic) {
      aristocratSeed = quote.id >>> 0;
      aristocratAlphabet = deterministicAristocratAlphabet(aristocratSeed);
    } else {
      const picked = pickRandomAristocratSeed(options?.prevAlphabet);
      aristocratSeed = picked.seed;
      aristocratAlphabet = picked.alphabet;
    }
    const hintVariant = shared?.hintVariant ?? 0;
    const cipherText = aristocratEncryptText(quote.quote, aristocratAlphabet);
    const aristocratCipherChars = cipherText.split('');
    const aristocratFrequencies = computeCiphertextFrequencies(cipherText);
    const aristocratHint = generateAristocratHint(
      quote,
      aristocratAlphabet,
      aristocratDifficulty,
      hintVariant
    );
    return {
      quote,
      userInputs: emptyInputs,
      keyInputs: chars.map((c) => (isLetter(c) ? '' : c)),
      aristocratSeed,
      aristocratHintVariant: hintVariant,
      aristocratAlphabet,
      aristocratCipherChars,
      aristocratFrequencies,
      aristocratState: {
        userInputs: emptyInputs,
        replacements: {},
        corners: {},
      },
      aristocratHint,
    };
  }

  return {
    quote,
    userInputs: emptyInputs,
    keyInputs: chars.map((c) => (isLetter(c) ? '' : c)),
    caesarOffset,
    vigenereKeyword,
  };
}

function hydratePuzzleFromSnapshot(
  snapshot: ActiveCipherSessionSnapshot,
  quote: Quote,
  caesarRange: CaesarRangeMode,
  aristocratDifficulty: AristocratDifficulty
): PuzzleState | null {
  const chars = quote.quote.toUpperCase().split('');
  if (
    snapshot.userInputs.length !== chars.length ||
    snapshot.keyInputs.length !== chars.length
  ) {
    return null;
  }

  const normalizedUserInputs = chars.map((ch, idx) =>
    isLetter(ch) ? snapshot.userInputs[idx] ?? '' : ch
  );
  const normalizedKeyInputs = chars.map((ch, idx) =>
    isLetter(ch) ? snapshot.keyInputs[idx] ?? '' : ch
  );

  if (snapshot.cipher === 'aristocrat') {
    const seed = snapshot.aristocratSeed ?? (quote.id >>> 0);
    const alphabet = isValidAristocratAlphabet(snapshot.aristocratAlphabet)
      ? snapshot.aristocratAlphabet
      : deterministicAristocratAlphabet(seed);
    const cipherText = aristocratEncryptText(quote.quote, alphabet);
    const aristocratCipherChars = cipherText.split('');
    const aristocratFrequencies = computeCiphertextFrequencies(cipherText);
    const aristocratHint =
      snapshot.aristocratHint !== undefined
        ? snapshot.aristocratHint
        : generateAristocratHint(quote, alphabet, aristocratDifficulty);
    return {
      quote,
      userInputs: normalizedUserInputs,
      keyInputs: normalizedKeyInputs,
      aristocratSeed: seed,
      aristocratHintVariant: 0,
      aristocratAlphabet: alphabet,
      aristocratCipherChars,
      aristocratFrequencies,
      aristocratState: {
        userInputs: normalizedUserInputs,
        replacements: snapshot.aristocratReplacements ?? {},
        corners: snapshot.aristocratCorners ?? {},
      },
      aristocratHint,
    };
  }

  return {
    quote,
    userInputs: normalizedUserInputs,
    keyInputs: normalizedKeyInputs,
    caesarOffset:
      snapshot.cipher === 'caesar'
        ? snapshot.caesarOffset ?? deterministicCaesarOffset(quote.id, caesarRange)
        : undefined,
    vigenereKeyword:
      snapshot.cipher === 'vigenere'
        ? snapshot.vigenereKeyword ?? deterministicVigenereKeyword(quote.id)
        : undefined,
  };
}

const EMPTY_USER_INPUTS: string[] = [];

interface InitialDrillState {
  puzzle: PuzzleState | null;
  notFoundId?: number;
  invalidShare?: boolean;
  elapsedMs: number;
  meaningfullySeen: boolean;
  isSubmitted: boolean;
  result: EvaluationResult | null;
  explicitQuoteCleared: boolean;
}

export const LookupCipherDrill: React.FC<LookupCipherDrillProps> = ({
  cipher,
  caesarRange: caesarRangeProp = 'pm3',
  aristocratDifficulty,
  onAristocratDifficultyChange,
  onBack,
  isTeacher = false,
  initialQuoteId,
  initialCaesarOffset,
  onClearExplicitQuote,
  shareToken,
  sharedConfig,
  invalidShareToken = false,
  workoutContext,
  onMeaningfullySeen,
}) => {
  const isSharedExercise = Boolean(shareToken);
  const practiceSource: CipherPracticeSource = isSharedExercise
    ? 'shared_link'
    : workoutContext
      ? 'general_practice'
      : 'standalone';

  const effectiveAristocratDifficulty: AristocratDifficulty =
    workoutContext?.aristocratDifficulty ?? aristocratDifficulty ?? 'easy';

  const [explicitQuoteCleared, setExplicitQuoteCleared] = useState(false);
  const activeExplicitQuoteId =
    !isSharedExercise && !explicitQuoteCleared ? initialQuoteId : undefined;
  const activeExplicitCaesarOffset =
    !isSharedExercise && !explicitQuoteCleared && cipher === 'caesar'
      ? initialCaesarOffset
      : undefined;

  const caesarRange: CaesarRangeMode =
    activeExplicitCaesarOffset !== undefined &&
    Math.abs(activeExplicitCaesarOffset) > 3
      ? 'any'
      : caesarRangeProp;

  const sessionKey = useMemo(
    () =>
      buildCipherSessionKey({
        shareToken,
        workoutContext,
        explicitTeacherQuoteId: activeExplicitQuoteId,
        explicitTeacherCaesarOffset: activeExplicitCaesarOffset,
        cipher,
        caesarRange,
        aristocratDifficulty: effectiveAristocratDifficulty,
      }),
    [
      activeExplicitCaesarOffset,
      activeExplicitQuoteId,
      caesarRange,
      cipher,
      effectiveAristocratDifficulty,
      shareToken,
      workoutContext,
    ]
  );

  const [initialBoot] = useState<InitialDrillState>(() => {
    if (invalidShareToken) {
      return {
        puzzle: null,
        invalidShare: true,
        elapsedMs: 0,
        meaningfullySeen: false,
        isSubmitted: false,
        result: null,
        explicitQuoteCleared: false,
      };
    }

    const saved = loadActiveCipherSession(sessionKey);
    if (saved && saved.cipher === cipher) {
      const savedQuote = getQuoteById(saved.quoteId);
      if (savedQuote) {
        const hydrated = hydratePuzzleFromSnapshot(
          saved,
          savedQuote,
          caesarRange,
          effectiveAristocratDifficulty
        );
        if (hydrated) {
          return {
            puzzle: hydrated,
            elapsedMs: saved.elapsedMs,
            meaningfullySeen: saved.meaningfullySeen,
            isSubmitted: saved.isSubmitted,
            result: saved.result ?? null,
            explicitQuoteCleared: false,
          };
        }
      }
    }

    if (isSharedExercise) {
      if (!sharedConfig) {
        return {
          puzzle: null,
          invalidShare: true,
          elapsedMs: 0,
          meaningfullySeen: false,
          isSubmitted: false,
          result: null,
          explicitQuoteCleared: false,
        };
      }
      const sharedQuote = getQuoteById(sharedConfig.quoteId);
      if (!sharedQuote) {
        return {
          puzzle: null,
          notFoundId: sharedConfig.quoteId,
          elapsedMs: 0,
          meaningfullySeen: false,
          isSubmitted: false,
          result: null,
          explicitQuoteCleared: false,
        };
      }
      return {
        puzzle: freshPuzzle(
          sharedQuote,
          cipher,
          caesarRange,
          effectiveAristocratDifficulty,
          { sharedConfig }
        ),
        elapsedMs: 0,
        meaningfullySeen: false,
        isSubmitted: false,
        result: null,
        explicitQuoteCleared: false,
      };
    }

    if (initialQuoteId !== undefined) {
      const q = pickLookupQuote(
        initialQuoteId,
        undefined,
        cipher,
        effectiveAristocratDifficulty
      );
      if (!q) {
        return {
          puzzle: null,
          notFoundId: initialQuoteId,
          elapsedMs: 0,
          meaningfullySeen: false,
          isSubmitted: false,
          result: null,
          explicitQuoteCleared: false,
        };
      }
      return {
        puzzle: freshPuzzle(
          q,
          cipher,
          caesarRange,
          effectiveAristocratDifficulty,
          {
            deterministic: true,
            explicitCaesarOffset: activeExplicitCaesarOffset,
          }
        ),
        elapsedMs: 0,
        meaningfullySeen: false,
        isSubmitted: false,
        result: null,
        explicitQuoteCleared: false,
      };
    }

    const randomQuote = pickLookupQuote(
      undefined,
      undefined,
      cipher,
      effectiveAristocratDifficulty
    );
    return {
      puzzle: randomQuote
        ? freshPuzzle(
            randomQuote,
            cipher,
            caesarRange,
            effectiveAristocratDifficulty,
            { explicitCaesarOffset: activeExplicitCaesarOffset }
          )
        : null,
      elapsedMs: 0,
      meaningfullySeen: false,
      isSubmitted: false,
      result: null,
      explicitQuoteCleared: false,
    };
  });

  const [notFoundId, setNotFoundId] = useState<number | undefined>(
    initialBoot.notFoundId
  );
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(initialBoot.puzzle);
  const [activeCipherLetter, setActiveCipherLetter] = useState<string | null>(
    null
  );
  const [tableFocusNonce, setTableFocusNonce] = useState<number>(0);
  const [result, setResult] = useState<EvaluationResult | null>(
    initialBoot.result
  );
  const [isSubmitted, setIsSubmitted] = useState<boolean>(
    initialBoot.isSubmitted
  );
  const [meaningfullySeen, setMeaningfullySeen] = useState<boolean>(
    initialBoot.meaningfullySeen
  );
  const [shareCopied, setShareCopied] = useState<boolean>(false);

  const suppressPersistenceRef = useRef(false);
  const shareCopyResetRef = useRef<number | null>(null);
  const latestSnapshotBaseRef = useRef<Omit<
    ActiveCipherSessionSnapshot,
    'elapsedMs' | 'updatedAt'
  > | null>(null);

  useEffect(() => {
    return () => {
      if (shareCopyResetRef.current !== null) {
        window.clearTimeout(shareCopyResetRef.current);
      }
    };
  }, []);

  const quote = puzzle?.quote;
  const quoteId = quote?.id;

  const handleFlushElapsedMs = useCallback((ms: number) => {
    if (suppressPersistenceRef.current) return;
    const base = latestSnapshotBaseRef.current;
    if (!base) return;
    saveActiveCipherSession({
      ...base,
      elapsedMs: Math.max(0, Math.trunc(ms)),
      updatedAt: Date.now(),
    });
  }, []);

  const cipherModeTag =
    cipher === 'caesar'
      ? caesarRange
      : cipher === 'aristocrat'
        ? effectiveAristocratDifficulty
        : '';

  const {
    elapsedSeconds,
    isIdlePaused,
    solvedElapsedMs,
    getElapsedMs,
    freezeTimer,
    resetTimer,
  } = usePuzzleElapsedTimer(Boolean(puzzle && quote && !initialBoot.invalidShare), {
    initialElapsedMs: initialBoot.elapsedMs,
    initialFrozen: initialBoot.isSubmitted,
    onFlushElapsedMs: handleFlushElapsedMs,
  });

  const onMeaningfullySeenRef = useRef(onMeaningfullySeen);
  useEffect(() => {
    onMeaningfullySeenRef.current = onMeaningfullySeen;
  }, [onMeaningfullySeen]);

  const emittedMeaningfullySeenForQuoteRef = useRef<number | null>(
    initialBoot.meaningfullySeen && initialBoot.puzzle
      ? initialBoot.puzzle.quote.id
      : null
  );

  const markMeaningfullySeen = useCallback(() => {
    setMeaningfullySeen((prev) => (prev ? prev : true));
  }, []);

  const effectiveMeaningfullySeen =
    meaningfullySeen ||
    (Boolean(puzzle) && elapsedSeconds >= MEANINGFULLY_SEEN_TIMEOUT_SEC);

  // Fire telemetry hook at most once per puzzle instance when effectiveMeaningfullySeen becomes true
  useEffect(() => {
    if (!effectiveMeaningfullySeen || quoteId === undefined) return;
    if (emittedMeaningfullySeenForQuoteRef.current === quoteId) return;
    emittedMeaningfullySeenForQuoteRef.current = quoteId;
    logCipherStartedEvent({
      cipher,
      mode: cipherModeTag,
      quoteId,
      source: practiceSource,
    });
    onMeaningfullySeenRef.current?.({
      cipher,
      quoteId,
      source: practiceSource,
    });
  }, [cipher, cipherModeTag, effectiveMeaningfullySeen, practiceSource, quoteId]);

  const userInputs =
    cipher === 'aristocrat'
      ? puzzle?.aristocratState?.userInputs ?? EMPTY_USER_INPUTS
      : puzzle?.userInputs ?? EMPTY_USER_INPUTS;
  const keyInputs = puzzle?.keyInputs ?? EMPTY_USER_INPUTS;

  // Persist active puzzle state across page reloads
  useEffect(() => {
    if (suppressPersistenceRef.current || !puzzle || !quote) {
      latestSnapshotBaseRef.current = null;
      return;
    }

    const snapshotBase: Omit<
      ActiveCipherSessionSnapshot,
      'elapsedMs' | 'updatedAt'
    > = {
      version: 1,
      sessionKey,
      source: practiceSource,
      cipher,
      ...(cipher === 'caesar' ? { caesarRange } : {}),
      ...(cipher === 'aristocrat'
        ? { aristocratDifficulty: effectiveAristocratDifficulty }
        : {}),
      quoteId: quote.id,
      ...(puzzle.caesarOffset !== undefined
        ? { caesarOffset: puzzle.caesarOffset }
        : {}),
      ...(puzzle.vigenereKeyword !== undefined
        ? { vigenereKeyword: puzzle.vigenereKeyword }
        : {}),
      ...(puzzle.aristocratSeed !== undefined
        ? { aristocratSeed: puzzle.aristocratSeed }
        : {}),
      ...(puzzle.aristocratAlphabet !== undefined
        ? { aristocratAlphabet: puzzle.aristocratAlphabet }
        : {}),
      ...(puzzle.aristocratHint !== undefined
        ? { aristocratHint: puzzle.aristocratHint }
        : {}),
      userInputs,
      keyInputs,
      ...(puzzle.aristocratState?.replacements
        ? { aristocratReplacements: puzzle.aristocratState.replacements }
        : {}),
      ...(puzzle.aristocratState?.corners
        ? { aristocratCorners: puzzle.aristocratState.corners }
        : {}),
      meaningfullySeen: effectiveMeaningfullySeen,
      isSubmitted,
      result,
    };

    latestSnapshotBaseRef.current = snapshotBase;
    const currentMs =
      isSubmitted && solvedElapsedMs !== null
        ? solvedElapsedMs
        : getElapsedMs();
    saveActiveCipherSession({
      ...snapshotBase,
      elapsedMs: Math.max(0, Math.trunc(currentMs)),
      updatedAt: Date.now(),
    });
  }, [
    caesarRange,
    cipher,
    effectiveAristocratDifficulty,
    effectiveMeaningfullySeen,
    getElapsedMs,
    isSubmitted,
    keyInputs,
    practiceSource,
    puzzle,
    quote,
    result,
    sessionKey,
    solvedElapsedMs,
    userInputs,
  ]);

  const handleSelectAristocratCipherLetter = useCallback(
    (letter: string | null, source?: 'table' | 'grid') => {
      setActiveCipherLetter(letter);
      if (source === 'table') {
        markMeaningfullySeen();
        setTableFocusNonce((n) => n + 1);
      }
    },
    [markMeaningfullySeen]
  );

  const chars = useMemo(
    () => (quote ? quote.quote.toUpperCase().split('') : []),
    [quote]
  );
  const alphaChars = useMemo(() => chars.filter(isLetter), [chars]);
  const totalLetters = alphaChars.length;
  const uniqueLetters = useMemo(
    () => new Set(alphaChars).size,
    [alphaChars]
  );
  const filledLetters = userInputs.filter(
    (c, idx) => isLetter(chars[idx] ?? '') && c !== ''
  ).length;
  const isAllFilled = totalLetters > 0 && filledLetters === totalLetters;
  const isAristocrat = cipher === 'aristocrat';
  const paceUnitCount = isAristocrat ? uniqueLetters : totalLetters;

  const solveTimeText =
    solvedElapsedMs !== null
      ? formatSolveDuration(Math.floor(solvedElapsedMs / 1000))
      : undefined;
  const paceText =
    solvedElapsedMs !== null
      ? formatCipherPace(solvedElapsedMs, paceUnitCount, isAristocrat)
      : undefined;

  const handleAristocratEdit = useCallback(
    (action: AristocratEditAction) => {
      markMeaningfullySeen();
      setPuzzle((prev) => {
        if (!prev || !prev.aristocratState || !prev.aristocratCipherChars) {
          return prev;
        }
        const nextAristo = applyAristocratEdit(
          prev.aristocratState,
          action,
          prev.aristocratCipherChars,
          'linked'
        );
        return {
          ...prev,
          userInputs: nextAristo.userInputs,
          aristocratState: nextAristo,
        };
      });
    },
    [markMeaningfullySeen]
  );

  const cipherParams = useMemo<CipherWorkspaceParams | undefined>(() => {
    if (cipher === 'caesar') {
      return {
        caesarOffset: puzzle?.caesarOffset ?? 1,
        caesarRange,
        onReferenceInteract: markMeaningfullySeen,
      };
    }
    if (cipher === 'vigenere') {
      return {
        vigenereKeyword: puzzle?.vigenereKeyword ?? 'KEY',
        onReferenceInteract: markMeaningfullySeen,
      };
    }
    if (cipher === 'aristocrat') {
      return {
        aristocratAlphabet: puzzle?.aristocratAlphabet,
        aristocratFrequencies: puzzle?.aristocratFrequencies,
        aristocratReplacements: puzzle?.aristocratState?.replacements,
        aristocratCorners: puzzle?.aristocratState?.corners,
        aristocratActiveCipherLetter: activeCipherLetter,
        aristocratTableFocusNonce: tableFocusNonce,
        aristocratDisabled: isSubmitted,
        onAristocratEdit: handleAristocratEdit,
        onSelectAristocratCipherLetter: handleSelectAristocratCipherLetter,
      };
    }
    return undefined;
  }, [
    activeCipherLetter,
    caesarRange,
    cipher,
    handleAristocratEdit,
    handleSelectAristocratCipherLetter,
    isSubmitted,
    markMeaningfullySeen,
    puzzle?.aristocratAlphabet,
    puzzle?.aristocratFrequencies,
    puzzle?.aristocratState?.corners,
    puzzle?.aristocratState?.replacements,
    puzzle?.caesarOffset,
    puzzle?.vigenereKeyword,
    tableFocusNonce,
  ]);

  const handleBackToMenu = useCallback(() => {
    suppressPersistenceRef.current = true;
    latestSnapshotBaseRef.current = null;
    clearActiveCipherSession();
    onBack();
  }, [onBack]);

  const loadNewQuote = useCallback(() => {
    const nextQ = pickLookupQuote(
      undefined,
      quoteId,
      cipher,
      effectiveAristocratDifficulty
    );
    if (nextQ) {
      if (
        activeExplicitQuoteId !== undefined ||
        activeExplicitCaesarOffset !== undefined
      ) {
        setExplicitQuoteCleared(true);
        onClearExplicitQuote?.();
      }
      emittedMeaningfullySeenForQuoteRef.current = null;
      setMeaningfullySeen(false);
      setShareCopied(false);
      setNotFoundId(undefined);
      setPuzzle((prev) =>
        freshPuzzle(
          nextQ,
          cipher,
          caesarRangeProp,
          effectiveAristocratDifficulty,
          {
            prevOffset: prev?.caesarOffset,
            prevKeyword: prev?.vigenereKeyword,
            prevAlphabet: prev?.aristocratAlphabet,
          }
        )
      );
      setActiveCipherLetter(null);
      setResult(null);
      setIsSubmitted(false);
      resetTimer();
    }
  }, [
    activeExplicitCaesarOffset,
    activeExplicitQuoteId,
    caesarRangeProp,
    cipher,
    effectiveAristocratDifficulty,
    onClearExplicitQuote,
    quoteId,
    resetTimer,
  ]);

  const handleSelectAristocratDifficulty = useCallback(
    (modeId: string) => {
      if (!isAristocratDifficulty(modeId)) return;
      clearActiveCipherSession();
      onAristocratDifficultyChange?.(modeId);
    },
    [onAristocratDifficultyChange]
  );

  const handleCopyShareLink = useCallback(() => {
    if (!isTeacher || !puzzle || !quote) return;
    const token =
      shareToken ??
      encodeShareToken({
        cipher,
        quoteId: quote.id,
        caesarRange,
        caesarOffset: puzzle.caesarOffset,
        vigenereKeyword: puzzle.vigenereKeyword,
        aristocratDifficulty: effectiveAristocratDifficulty,
        aristocratSeed: puzzle.aristocratSeed,
        hintVariant: puzzle.aristocratHintVariant ?? 0,
      });
    const url = buildShareLinkUrl(token);
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      void navigator.clipboard.writeText(url).catch(() => {});
    }
    setShareCopied(true);
    if (shareCopyResetRef.current !== null) {
      window.clearTimeout(shareCopyResetRef.current);
    }
    shareCopyResetRef.current = window.setTimeout(() => {
      setShareCopied(false);
    }, 2000);
  }, [
    caesarRange,
    cipher,
    effectiveAristocratDifficulty,
    isTeacher,
    puzzle,
    quote,
    shareToken,
  ]);

  const handleNext = useCallback(() => {
    if (isSharedExercise) {
      handleBackToMenu();
      return;
    }
    if (workoutContext) {
      suppressPersistenceRef.current = true;
      latestSnapshotBaseRef.current = null;
      clearActiveCipherSession();
      const elapsed =
        solvedElapsedMs !== null
          ? Math.floor(solvedElapsedMs / 1000)
          : elapsedSeconds;
      const accuracy = result
        ? Math.round((result.correctChars / (result.totalChars || 1)) * 100)
        : 100;
      workoutContext.onAdvance({
        timeSeconds: elapsed,
        paceText,
        letterCount: totalLetters,
        uniqueLetterCount: uniqueLetters,
        accuracy,
        author: quote?.author,
        ...(cipher === 'aristocrat'
          ? { aristocratDifficulty: effectiveAristocratDifficulty }
          : {}),
      });
    } else {
      loadNewQuote();
    }
  }, [
    isSharedExercise,
    handleBackToMenu,
    workoutContext,
    solvedElapsedMs,
    elapsedSeconds,
    result,
    paceText,
    totalLetters,
    uniqueLetters,
    quote?.author,
    cipher,
    effectiveAristocratDifficulty,
    loadNewQuote,
  ]);

  const handleSubmit = useCallback(() => {
    if (!quote || isSubmitted || !isAllFilled) return;
    markMeaningfullySeen();
    const frozenMs = freezeTimer();
    const res = evaluateSolution(quote.quote, userInputs.join(''));
    if (cipher === 'aristocrat') {
      // Clear all corner candidate notes on submission so only Center guesses display
      setPuzzle((prev) => {
        if (!prev || !prev.aristocratState || !prev.aristocratCipherChars) {
          return prev;
        }
        return {
          ...prev,
          aristocratState: applyAristocratEdit(
            prev.aristocratState,
            { kind: 'clearAllCorners' },
            prev.aristocratCipherChars,
            'linked'
          ),
        };
      });
      setActiveCipherLetter(null);
    }
    setResult(res);
    setIsSubmitted(true);
    logCipherSolvedEvent({
      cipher,
      mode: cipherModeTag,
      quoteId: quote.id,
      elapsedSec: frozenMs / 1000,
      alphaCharCount: totalLetters,
      uniqueAlphaCharCount: uniqueLetters,
      inputMode: cipher === 'aristocrat' ? 'linked' : '',
      errorCount: res.errorCount,
      correctChars: res.correctChars,
      scoreTier: res.scoreTier,
      source: practiceSource,
    });
    if (shouldCountQuoteCompleted(res)) {
      saveCompletedQuoteId(quote.id);
      if (!isSharedExercise) {
        recordCipherPractice(cipher);
      }
    }
  }, [
    cipher,
    cipherModeTag,
    freezeTimer,
    isAllFilled,
    isSharedExercise,
    isSubmitted,
    markMeaningfullySeen,
    practiceSource,
    quote,
    totalLetters,
    uniqueLetters,
    userInputs,
  ]);

  const handleChangeUserInputs = useCallback(
    (nextInputs: string[]) => {
      markMeaningfullySeen();
      setPuzzle((prev) => (prev ? { ...prev, userInputs: nextInputs } : null));
    },
    [markMeaningfullySeen]
  );

  const handleChangeKeyInputs = useCallback(
    (nextKeyInputs: string[]) => {
      markMeaningfullySeen();
      setPuzzle((prev) =>
        prev ? { ...prev, keyInputs: nextKeyInputs } : null
      );
    },
    [markMeaningfullySeen]
  );

  const baseTitle =
    cipher === 'caesar'
      ? caesarRange === 'any'
        ? 'Caesar (Any)'
        : 'Caesar (±3)'
      : cipher === 'aristocrat'
        ? `Aristocrat (${ARISTOCRAT_DIFFICULTY_LABELS[effectiveAristocratDifficulty]})`
        : getDrill(cipher).shortTitle;

  const showModeSwitcher =
    cipher === 'aristocrat' &&
    !isSharedExercise &&
    Boolean(onAristocratDifficultyChange);
  const showShareInOverflow = Boolean(isTeacher && !workoutContext && puzzle);

  const rightControls = workoutContext ? (
    <span className="workout-step-tag">Round {workoutContext.round}</span>
  ) : (
    <div className="drill-header-actions-group">
      {!isSharedExercise && (
        <button
          className="btn-simple btn-reload"
          onClick={loadNewQuote}
          title="New Quote"
        >
          New ↻
        </button>
      )}
      {(showModeSwitcher || showShareInOverflow) && (
        <DrillOverflowMenu
          modeOptions={
            showModeSwitcher ? ARISTOCRAT_DIFFICULTY_OPTIONS : undefined
          }
          activeMode={
            showModeSwitcher ? effectiveAristocratDifficulty : undefined
          }
          onSelectMode={
            showModeSwitcher ? handleSelectAristocratDifficulty : undefined
          }
          shareAction={
            showShareInOverflow
              ? {
                  copied: shareCopied,
                  onCopyLink: handleCopyShareLink,
                }
              : undefined
          }
        />
      )}
    </div>
  );

  if (initialBoot.invalidShare) {
    return (
      <div className="drill-container">
        <DrillHeader title="Shared Exercise" onBack={handleBackToMenu} />

        <div className="quote-not-found-card">
          <div className="quote-not-found-icon">🔗</div>
          <h2 className="quote-not-found-title">Invalid Share Link</h2>
          <p className="quote-not-found-desc">
            This exercise link could not be decoded. Check that the full URL was
            copied cleanly.
          </p>
          <div className="quote-not-found-actions">
            <button className="btn-main-action" onClick={handleBackToMenu}>
              🏠 Main Menu
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (notFoundId !== undefined && !puzzle) {
    return (
      <div className="drill-container">
        <DrillHeader
          title={baseTitle}
          onBack={handleBackToMenu}
          right={rightControls}
        />

        <div className="quote-not-found-card">
          <div className="quote-not-found-icon">🔍</div>
          <h2 className="quote-not-found-title">Quote Not Found</h2>
          <p className="quote-not-found-desc">
            This quote was not found or may have been removed from the database.
          </p>
          <div className="quote-not-found-actions">
            {isSharedExercise ? (
              <button className="btn-main-action" onClick={handleBackToMenu}>
                🏠 Main Menu
              </button>
            ) : (
              <button className="btn-main-action" onClick={loadNewQuote}>
                🎲 Load Random Quote
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!puzzle || !quote) return null;

  return (
    <div className="drill-container">
      <DrillHeader
        title={
          workoutContext
            ? `${baseTitle} • Step ${workoutContext.stepIndex + 1}/${workoutContext.totalSteps}`
            : baseTitle
        }
        onBack={handleBackToMenu}
        right={rightControls}
      />

      <CollapsibleReference
        className="sticky-ref-container reference-sheet"
        showLabel={
          cipher === 'aristocrat'
            ? 'Show Replacement & Frequency Tables'
            : 'Show Reference Table'
        }
      >
        <ReferenceSheet cipher={cipher} cipherParams={cipherParams} />
      </CollapsibleReference>

      <QuoteTileGrid
        cipher={cipher}
        quote={quote}
        userInputs={userInputs}
        onChangeUserInputs={handleChangeUserInputs}
        keyInputs={cipher === 'vigenere' ? keyInputs : undefined}
        onChangeKeyInputs={
          cipher === 'vigenere' ? handleChangeKeyInputs : undefined
        }
        hintText={cipher === 'aristocrat' ? puzzle.aristocratHint : undefined}
        disabled={isSubmitted}
        showEvaluation={isSubmitted}
        onEnterSubmit={handleSubmit}
        cipherParams={cipherParams}
      />

      <DrillActionRow
        info={
          <span className="cipher-footer-stats">
            <span className="cipher-letter-count">
              <strong>
                {filledLetters} / {totalLetters}
              </strong>{' '}
              letters
            </span>
            <span className="cipher-footer-sep" aria-hidden="true">
              ·
            </span>
            <span
              className={`cipher-elapsed-timer${isSubmitted || isIdlePaused ? ' is-paused' : ''}`}
              aria-label={`Elapsed solve time ${formatClock(elapsedSeconds)}`}
            >
              ⏱️ {formatClock(elapsedSeconds)}
            </span>
          </span>
        }
      >
        {!isSubmitted ? (
          <button
            className="btn-submit"
            onClick={handleSubmit}
            disabled={!isAllFilled}
          >
            Submit & Check Solution ✓
          </button>
        ) : isSharedExercise ? (
          <button className="btn-submit btn-next" onClick={handleBackToMenu}>
            🏠 Main Menu
          </button>
        ) : workoutContext ? (
          <button
            className="btn-submit btn-next btn-workout-next"
            onClick={handleNext}
          >
            {workoutContext.isLastStep
              ? 'Finish Round 🏆 ➔'
              : `Next: ${workoutContext.nextCipherTitle || 'Next'} ➔`}
          </button>
        ) : (
          <button className="btn-submit btn-next" onClick={handleNext}>
            Next Puzzle →
          </button>
        )}
      </DrillActionRow>

      {result && (
        <ResultBanner
          result={result}
          solveTimeText={solveTimeText}
          paceText={paceText}
        />
      )}
    </div>
  );
};
