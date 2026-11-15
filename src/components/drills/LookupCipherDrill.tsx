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
  generateAristocratAlphabet,
  generateAristocratHint,
} from '../../utils/aristocrat';
import {
  deterministicCaesarOffset,
  deterministicVigenereKeyword,
  evaluateSolution,
  isLetter,
  pickRandomCaesarOffset,
  pickRandomVigenereKeyword,
  shouldCountQuoteCompleted,
} from '../../utils/ciphers';
import { isAristocratDifficulty } from '../../utils/routing';
import {
  formatCipherPace,
  formatClock,
  formatSolveDuration,
} from '../../utils/format';
import { usePuzzleElapsedTimer } from '../../hooks/usePuzzleElapsedTimer';
import { pickLookupQuote } from '../../data/quotes';
import { getDrill, type TestableCipherType } from '../../data/drills';
import { saveCompletedQuoteId, recordCipherPractice } from '../../services/storage';
import type {
  AristocratDifficulty,
  AristocratEditAction,
  AristocratWorkspaceState,
  CaesarRangeMode,
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

interface LookupCipherDrillProps {
  cipher: TestableCipherType;
  caesarRange?: CaesarRangeMode;
  aristocratDifficulty?: AristocratDifficulty;
  onAristocratDifficultyChange?: (nextMode: AristocratDifficulty) => void;
  onBack: () => void;
  initialQuoteId?: number;
  onQuoteChange?: (quoteId: number) => void;
  workoutContext?: WorkoutStepContext;
}

interface PuzzleState {
  quote: Quote;
  userInputs: string[];
  keyInputs: string[];
  caesarOffset?: number;
  vigenereKeyword?: string;
  aristocratAlphabet?: string;
  aristocratCipherChars?: string[];
  aristocratFrequencies?: Record<string, number>;
  aristocratState?: AristocratWorkspaceState;
  aristocratHint?: string | null;
}

function freshPuzzle(
  quote: Quote,
  cipher: TestableCipherType,
  caesarRange: CaesarRangeMode,
  aristocratDifficulty: AristocratDifficulty,
  options?: {
    deterministic?: boolean;
    prevOffset?: number;
    prevKeyword?: string;
    prevAlphabet?: string;
  }
): PuzzleState {
  const chars = quote.quote.toUpperCase().split('');
  const emptyInputs = chars.map((c) => (isLetter(c) ? '' : c));
  const caesarOffset =
    cipher === 'caesar'
      ? options?.deterministic
        ? deterministicCaesarOffset(quote.id, caesarRange)
        : pickRandomCaesarOffset(caesarRange, options?.prevOffset)
      : undefined;
  const vigenereKeyword =
    cipher === 'vigenere'
      ? options?.deterministic
        ? deterministicVigenereKeyword(quote.id)
        : pickRandomVigenereKeyword(options?.prevKeyword)
      : undefined;

  if (cipher === 'aristocrat') {
    const aristocratAlphabet = options?.deterministic
      ? deterministicAristocratAlphabet(quote.id)
      : generateAristocratAlphabet(Math.random, options?.prevAlphabet);
    const cipherText = aristocratEncryptText(quote.quote, aristocratAlphabet);
    const aristocratCipherChars = cipherText.split('');
    const aristocratFrequencies = computeCiphertextFrequencies(cipherText);
    const aristocratHint = generateAristocratHint(
      quote,
      aristocratAlphabet,
      aristocratDifficulty
    );
    return {
      quote,
      userInputs: emptyInputs,
      keyInputs: chars.map((c) => (isLetter(c) ? '' : c)),
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

const EMPTY_USER_INPUTS: string[] = [];

export const LookupCipherDrill: React.FC<LookupCipherDrillProps> = ({
  cipher,
  caesarRange = 'pm3',
  aristocratDifficulty,
  onAristocratDifficultyChange,
  onBack,
  initialQuoteId,
  onQuoteChange,
  workoutContext,
}) => {
  const effectiveAristocratDifficulty: AristocratDifficulty =
    workoutContext?.aristocratDifficulty ?? aristocratDifficulty ?? 'easy';

  const [initialResolved] = useState<{
    quote: Quote | null;
    notFoundId?: number;
    deterministic?: boolean;
  }>(() => {
    if (initialQuoteId !== undefined) {
      const q = pickLookupQuote(
        initialQuoteId,
        undefined,
        cipher,
        effectiveAristocratDifficulty
      );
      if (q) return { quote: q, deterministic: true };
      return { quote: null, notFoundId: initialQuoteId };
    }
    return {
      quote: pickLookupQuote(
        undefined,
        undefined,
        cipher,
        effectiveAristocratDifficulty
      ),
      deterministic: false,
    };
  });

  const [notFoundId, setNotFoundId] = useState<number | undefined>(
    initialResolved.notFoundId
  );
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(() =>
    initialResolved.quote
      ? freshPuzzle(
          initialResolved.quote,
          cipher,
          caesarRange,
          effectiveAristocratDifficulty,
          {
            deterministic: initialResolved.deterministic,
          }
        )
      : null
  );
  const [activeCipherLetter, setActiveCipherLetter] = useState<string | null>(
    null
  );
  const [tableFocusNonce, setTableFocusNonce] = useState<number>(0);

  const handleSelectAristocratCipherLetter = useCallback(
    (letter: string | null, source?: 'table' | 'grid') => {
      setActiveCipherLetter(letter);
      if (source === 'table') {
        setTableFocusNonce((n) => n + 1);
      }
    },
    []
  );

  const quote = puzzle?.quote;
  const quoteId = quote?.id;
  const userInputs =
    cipher === 'aristocrat'
      ? puzzle?.aristocratState?.userInputs ?? EMPTY_USER_INPUTS
      : puzzle?.userInputs ?? EMPTY_USER_INPUTS;
  const keyInputs = puzzle?.keyInputs ?? EMPTY_USER_INPUTS;
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const { elapsedSeconds, solvedElapsedMs, freezeTimer, resetTimer } =
    usePuzzleElapsedTimer(Boolean(puzzle && quote));

  const onQuoteChangeRef = useRef(onQuoteChange);
  useEffect(() => {
    onQuoteChangeRef.current = onQuoteChange;
  }, [onQuoteChange]);

  useEffect(() => {
    if (quoteId !== undefined) {
      onQuoteChangeRef.current?.(quoteId);
    }
  }, [quoteId]);

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

  const handleAristocratEdit = useCallback((action: AristocratEditAction) => {
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
  }, []);

  const cipherParams = useMemo<CipherWorkspaceParams | undefined>(() => {
    if (cipher === 'caesar') {
      return { caesarOffset: puzzle?.caesarOffset ?? 1, caesarRange };
    }
    if (cipher === 'vigenere') {
      return { vigenereKeyword: puzzle?.vigenereKeyword ?? 'KEY' };
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
    puzzle?.aristocratAlphabet,
    puzzle?.aristocratFrequencies,
    puzzle?.aristocratState?.corners,
    puzzle?.aristocratState?.replacements,
    puzzle?.caesarOffset,
    puzzle?.vigenereKeyword,
    tableFocusNonce,
  ]);

  const loadNewQuote = useCallback(() => {
    const nextQ = pickLookupQuote(
      undefined,
      quoteId,
      cipher,
      effectiveAristocratDifficulty
    );
    if (nextQ) {
      setNotFoundId(undefined);
      setPuzzle((prev) =>
        freshPuzzle(
          nextQ,
          cipher,
          caesarRange,
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
      onQuoteChange?.(nextQ.id);
    }
  }, [
    caesarRange,
    cipher,
    effectiveAristocratDifficulty,
    onQuoteChange,
    quoteId,
    resetTimer,
  ]);

  const handleSelectAristocratDifficulty = useCallback(
    (modeId: string) => {
      if (!isAristocratDifficulty(modeId)) return;
      onAristocratDifficultyChange?.(modeId);
    },
    [onAristocratDifficultyChange]
  );

  const handleNext = useCallback(() => {
    if (workoutContext) {
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
    freezeTimer();
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
    if (shouldCountQuoteCompleted(res)) {
      saveCompletedQuoteId(quote.id);
      recordCipherPractice(cipher);
    }
  }, [cipher, freezeTimer, quote, userInputs, isSubmitted, isAllFilled]);

  const handleChangeUserInputs = useCallback((nextInputs: string[]) => {
    setPuzzle((prev) => (prev ? { ...prev, userInputs: nextInputs } : null));
  }, []);

  const handleChangeKeyInputs = useCallback((nextKeyInputs: string[]) => {
    setPuzzle((prev) => (prev ? { ...prev, keyInputs: nextKeyInputs } : null));
  }, []);

  const baseTitle =
    cipher === 'caesar'
      ? caesarRange === 'any'
        ? 'Caesar (Any)'
        : 'Caesar (±3)'
      : cipher === 'aristocrat'
        ? `Aristocrat (${ARISTOCRAT_DIFFICULTY_LABELS[effectiveAristocratDifficulty]})`
        : getDrill(cipher).shortTitle;

  const rightControls = workoutContext ? (
    <span className="workout-step-tag">Round {workoutContext.round}</span>
  ) : (
    <div className="drill-header-actions-group">
      <button
        className="btn-simple btn-reload"
        onClick={loadNewQuote}
        title="New Quote"
      >
        New ↻
      </button>
      {cipher === 'aristocrat' && onAristocratDifficultyChange && (
        <DrillOverflowMenu
          modeOptions={ARISTOCRAT_DIFFICULTY_OPTIONS}
          activeMode={effectiveAristocratDifficulty}
          onSelectMode={handleSelectAristocratDifficulty}
        />
      )}
    </div>
  );

  if (notFoundId !== undefined && !puzzle) {
    return (
      <div className="drill-container">
        <DrillHeader
          title={baseTitle}
          onBack={onBack}
          right={rightControls}
        />

        <div className="quote-not-found-card">
          <div className="quote-not-found-icon">🔍</div>
          <h2 className="quote-not-found-title">Quote Not Found</h2>
          <p className="quote-not-found-desc">
            This quote was not found or may have been removed from the database.
          </p>
          <div className="quote-not-found-actions">
            <button className="btn-main-action" onClick={loadNewQuote}>
              🎲 Load Random Quote
            </button>
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
        onBack={onBack}
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
              className={`cipher-elapsed-timer${isSubmitted ? ' is-paused' : ''}`}
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
