import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { DrillHeader } from './shared/DrillHeader';
import { CollapsibleReference } from './shared/CollapsibleReference';
import { ReferenceSheet } from './shared/ReferenceSheet';
import { DrillActionRow } from './shared/DrillActionRow';
import { ResultBanner } from './shared/ResultBanner';
import { QuoteTileGrid } from './shared/QuoteTileGrid';
import {
  deterministicCaesarOffset,
  deterministicVigenereKeyword,
  evaluateSolution,
  isLetter,
  pickRandomCaesarOffset,
  pickRandomVigenereKeyword,
  shouldCountQuoteCompleted,
} from '../../utils/ciphers';
import { pickLookupQuote } from '../../data/quotes';
import { getDrill, type TestableCipherType } from '../../data/drills';
import { saveCompletedQuoteId, recordCipherPractice } from '../../services/storage';
import type {
  CaesarRangeMode,
  CipherWorkspaceParams,
  EvaluationResult,
  Quote,
  WorkoutStepContext,
} from '../../types';

interface LookupCipherDrillProps {
  cipher: TestableCipherType;
  caesarRange?: CaesarRangeMode;
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
}

function freshPuzzle(
  quote: Quote,
  cipher: TestableCipherType,
  caesarRange: CaesarRangeMode,
  options?: {
    deterministic?: boolean;
    prevOffset?: number;
    prevKeyword?: string;
  }
): PuzzleState {
  const chars = quote.quote.toUpperCase().split('');
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
  return {
    quote,
    userInputs: chars.map((c) => (isLetter(c) ? '' : c)),
    keyInputs: chars.map((c) => (isLetter(c) ? '' : c)),
    caesarOffset,
    vigenereKeyword,
  };
}

const EMPTY_USER_INPUTS: string[] = [];

export const LookupCipherDrill: React.FC<LookupCipherDrillProps> = ({
  cipher,
  caesarRange = 'pm3',
  onBack,
  initialQuoteId,
  onQuoteChange,
  workoutContext,
}) => {
  const [initialResolved] = useState<{
    quote: Quote | null;
    notFoundId?: number;
    deterministic?: boolean;
  }>(() => {
    if (initialQuoteId !== undefined) {
      const q = pickLookupQuote(initialQuoteId, undefined, cipher);
      if (q) return { quote: q, deterministic: true };
      return { quote: null, notFoundId: initialQuoteId };
    }
    return { quote: pickLookupQuote(undefined, undefined, cipher), deterministic: false };
  });

  const [notFoundId, setNotFoundId] = useState<number | undefined>(
    initialResolved.notFoundId
  );
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(() =>
    initialResolved.quote
      ? freshPuzzle(initialResolved.quote, cipher, caesarRange, {
          deterministic: initialResolved.deterministic,
        })
      : null
  );
  const quote = puzzle?.quote;
  const quoteId = quote?.id;
  const userInputs = puzzle?.userInputs ?? EMPTY_USER_INPUTS;
  const keyInputs = puzzle?.keyInputs ?? EMPTY_USER_INPUTS;
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    startTimeRef.current = Date.now();
  }, []);

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
  const totalLetters = useMemo(() => chars.filter(isLetter).length, [chars]);
  const filledLetters = userInputs.filter(
    (c, idx) => isLetter(chars[idx] ?? '') && c !== ''
  ).length;
  const isAllFilled = totalLetters > 0 && filledLetters === totalLetters;

  const cipherParams = useMemo<CipherWorkspaceParams | undefined>(() => {
    if (cipher === 'caesar') {
      return { caesarOffset: puzzle?.caesarOffset ?? 1, caesarRange };
    }
    if (cipher === 'vigenere') {
      return { vigenereKeyword: puzzle?.vigenereKeyword ?? 'KEY' };
    }
    return undefined;
  }, [caesarRange, cipher, puzzle?.caesarOffset, puzzle?.vigenereKeyword]);

  const loadNewQuote = useCallback(() => {
    const nextQ = pickLookupQuote(undefined, quoteId, cipher);
    if (nextQ) {
      setNotFoundId(undefined);
      setPuzzle((prev) =>
        freshPuzzle(nextQ, cipher, caesarRange, {
          prevOffset: prev?.caesarOffset,
          prevKeyword: prev?.vigenereKeyword,
        })
      );
      setResult(null);
      setIsSubmitted(false);
      startTimeRef.current = Date.now();
      onQuoteChange?.(nextQ.id);
    }
  }, [caesarRange, cipher, onQuoteChange, quoteId]);

  const handleNext = useCallback(() => {
    if (workoutContext) {
      const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
      const accuracy = result
        ? Math.round((result.correctChars / (result.totalChars || 1)) * 100)
        : 100;
      workoutContext.onAdvance({
        timeSeconds: elapsed,
        accuracy,
        author: quote?.author,
      });
    } else {
      loadNewQuote();
    }
  }, [workoutContext, result, quote?.author, loadNewQuote]);

  const handleSubmit = useCallback(() => {
    if (!quote || isSubmitted || !isAllFilled) return;
    const res = evaluateSolution(quote.quote, userInputs.join(''));
    setResult(res);
    setIsSubmitted(true);
    if (shouldCountQuoteCompleted(res)) {
      saveCompletedQuoteId(quote.id);
      recordCipherPractice(cipher);
    }
  }, [cipher, quote, userInputs, isSubmitted, isAllFilled]);

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
      : getDrill(cipher).shortTitle;

  if (notFoundId !== undefined && !puzzle) {
    return (
      <div className="drill-container">
        <DrillHeader
          title={baseTitle}
          onBack={onBack}
          right={
            <button
              className="btn-simple btn-reload"
              onClick={loadNewQuote}
              title="Pick Random Quote"
            >
              New ↻
            </button>
          }
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
        right={
          workoutContext ? (
            <span className="workout-step-tag">Round {workoutContext.round}</span>
          ) : (
            <button
              className="btn-simple btn-reload"
              onClick={loadNewQuote}
              title="New Quote"
            >
              New ↻
            </button>
          )
        }
      />

      <CollapsibleReference
        className="sticky-ref-container reference-sheet"
        showLabel="Show Reference Table"
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
        disabled={isSubmitted}
        showEvaluation={isSubmitted}
        onEnterSubmit={handleSubmit}
        cipherParams={cipherParams}
      />

      <DrillActionRow
        info={
          <>
            Progress: <strong>{filledLetters} / {totalLetters}</strong> letters
          </>
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

      {result && <ResultBanner result={result} />}
    </div>
  );
};
