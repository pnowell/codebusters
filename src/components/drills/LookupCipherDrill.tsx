import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { PigpenGlyph } from '../symbols/PigpenGlyph';
import { GalacticGlyph } from '../symbols/GalacticGlyph';
import { DrillHeader } from '../drill/DrillHeader';
import { CollapsibleReference } from '../drill/CollapsibleReference';
import { ReferenceSheet } from '../drill/ReferenceSheet';
import { DrillActionRow } from '../drill/DrillActionRow';
import { ResultBanner } from '../drill/ResultBanner';
import { atbashChar, evaluateSolution, isLetter, findLetterIndex, groupIntoWords } from '../../utils/ciphers';
import { pickLookupQuote } from '../../data/quotes';
import { getDrill, type LookupCipherType } from '../../data/drills';
import { useKeepInView } from '../../hooks/useKeepInView';
import { saveCompletedQuoteId, recordCipherPractice } from '../../services/storage';
import type { Quote, EvaluationResult } from '../../types';
import type { WorkoutStepContext } from './LetterOffsetDrill';

interface LookupCipherDrillProps {
  cipher: LookupCipherType;
  onBack: () => void;
  initialQuoteId?: number;
  onQuoteChange?: (quoteId: number) => void;
  workoutContext?: WorkoutStepContext;
}

function freshPuzzle(quote: Quote) {
  const chars = quote.quote.toUpperCase().split('');
  const firstLetter = chars.findIndex(isLetter);
  return {
    quote,
    userInputs: chars.map(c => (isLetter(c) ? '' : c)),
    activeIdx: firstLetter >= 0 ? firstLetter : 0,
  };
}

const CipherGlyph: React.FC<{ cipher: LookupCipherType; char: string }> = ({ cipher, char }) => {
  const upper = char.toUpperCase();
  if (!isLetter(upper)) return <>{char}</>;
  if (cipher === 'atbash') return <>{atbashChar(upper)}</>;
  if (cipher === 'pigpen') return <PigpenGlyph letter={upper} size={22} />;
  if (cipher === 'galactic') return <GalacticGlyph letter={upper} size={22} />;
  return <>{upper}</>;
};

type PuzzleState = {
  quote: Quote;
  userInputs: string[];
  activeIdx: number;
};

const EMPTY_USER_INPUTS: string[] = [];

export const LookupCipherDrill: React.FC<LookupCipherDrillProps> = ({
  cipher,
  onBack,
  initialQuoteId,
  onQuoteChange,
  workoutContext,
}) => {
  const [initialResolved] = useState<{ quote: Quote | null; notFoundId?: number }>(() => {
    if (initialQuoteId !== undefined) {
      const q = pickLookupQuote(initialQuoteId);
      if (q) return { quote: q };
      return { quote: null, notFoundId: initialQuoteId };
    }
    return { quote: pickLookupQuote() };
  });

  const [notFoundId, setNotFoundId] = useState<number | undefined>(initialResolved.notFoundId);
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(() =>
    initialResolved.quote ? freshPuzzle(initialResolved.quote) : null
  );
  const quote = puzzle?.quote;
  const quoteId = quote?.id;
  const userInputs = puzzle?.userInputs ?? EMPTY_USER_INPUTS;
  const activeIdx = puzzle?.activeIdx ?? 0;
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const startTimeRef = useRef<number>(Date.now());

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const scrollPanelRef = useRef<HTMLDivElement | null>(null);

  // Inform parent of quote ID changes via ref to prevent stale closures/unwanted re-renders
  const onQuoteChangeRef = useRef(onQuoteChange);
  onQuoteChangeRef.current = onQuoteChange;
  useEffect(() => {
    if (quoteId !== undefined) {
      onQuoteChangeRef.current?.(quoteId);
    }
  }, [quoteId]);

  // Derived quote data
  const chars = useMemo(() => (quote ? quote.quote.toUpperCase().split('') : []), [quote]);
  const words = useMemo(() => groupIntoWords(chars), [chars]);
  const totalLetters = useMemo(() => chars.filter(isLetter).length, [chars]);
  const filledLetters = userInputs.filter((c, idx) => isLetter(chars[idx]) && c !== '').length;

  // Focus tile helper
  const focusTile = useCallback((index: number) => {
    setPuzzle(prev => (prev ? { ...prev, activeIdx: index } : null));
    inputRefs.current[index]?.focus({ preventScroll: true });
  }, []);

  // Refocus first active tile whenever quote changes
  useEffect(() => {
    if (puzzle) {
      inputRefs.current[puzzle.activeIdx]?.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only refocus when quote changes
  }, [quote?.id]);

  // Keep focused character tile visible horizontally and vertically
  useKeepInView(scrollPanelRef, () => inputRefs.current[activeIdx], activeIdx);

  const loadNewQuote = () => {
    const nextQ = pickLookupQuote();
    if (nextQ) {
      setNotFoundId(undefined);
      setPuzzle(freshPuzzle(nextQ));
      setResult(null);
      setIsSubmitted(false);
      startTimeRef.current = Date.now();
      onQuoteChange?.(nextQ.id);
    }
  };

  const handleSubmit = useCallback(() => {
    if (!quote) return;
    const res = evaluateSolution(quote.quote, userInputs.join(''));
    setResult(res);
    setIsSubmitted(true);
    saveCompletedQuoteId(quote.id);
    recordCipherPractice(cipher);
  }, [cipher, quote, userInputs]);

  const handleTileChange = (index: number, val: string) => {
    if (!puzzle) return;
    if (isSubmitted) {
      setIsSubmitted(false);
      setResult(null);
    }

    const lastChar = val.slice(-1).toUpperCase();
    const updated = [...userInputs];

    if (isLetter(lastChar)) {
      updated[index] = lastChar;
      setPuzzle(prev => (prev ? { ...prev, userInputs: updated } : null));
      const nextIdx = findLetterIndex(chars, index, 1);
      focusTile(nextIdx);
    } else if (val === '') {
      updated[index] = '';
      setPuzzle(prev => (prev ? { ...prev, userInputs: updated } : null));
    }
  };

  const handleTileKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!puzzle) return;
    if (e.key === 'Backspace') {
      if (!userInputs[index]) {
        e.preventDefault();
        const prevIdx = findLetterIndex(chars, index, -1);
        const updated = [...userInputs];
        updated[prevIdx] = '';
        setPuzzle(prev => (prev ? { ...prev, userInputs: updated } : null));
        focusTile(prevIdx);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusTile(findLetterIndex(chars, index, -1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusTile(findLetterIndex(chars, index, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!isSubmitted) {
        handleSubmit();
      } else {
        loadNewQuote();
      }
    }
  };

  if (notFoundId !== undefined && !puzzle) {
    return (
      <div className="drill-container">
        <DrillHeader
          title={getDrill(cipher).shortTitle}
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
      {/* 1. Header */}
      <DrillHeader
        title={
          workoutContext
            ? `${getDrill(cipher).shortTitle} • Step ${workoutContext.stepIndex + 1}/${workoutContext.totalSteps}`
            : getDrill(cipher).shortTitle
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

      {/* 2. Collapsible Reference Table */}
      <CollapsibleReference
        className="sticky-ref-container reference-sheet"
        showLabel="Show Reference Table"
      >
        <ReferenceSheet cipher={cipher} />
      </CollapsibleReference>

      {/* 3. Horizontal Scroll Viewport for Cipher Lines */}
      <div className="cipher-scroll-panel" ref={scrollPanelRef}>
        <div className="quote-content-canvas">
          <div className="quote-display-grid">
            {words.map((word, wIdx) => (
              <div key={wIdx} className="word-cluster">
                {word.map(({ char, index }) => {
                  const isAlpha = isLetter(char);
                  const isActive = activeIdx === index;
                  const userVal = userInputs[index] || '';
                  const isCorrect = isSubmitted && userVal === char;
                  const isWrong = isSubmitted && isAlpha && userVal !== '' && userVal !== char;

                  return (
                    <div
                      key={index}
                      className={`char-tile ${isActive ? 'active-tile' : ''} ${isCorrect ? 'correct-tile' : ''} ${isWrong ? 'wrong-tile' : ''}`}
                      onClick={() => isAlpha && focusTile(index)}
                    >
                      <div className="tile-cipher">
                        <CipherGlyph cipher={cipher} char={char} />
                      </div>
                      {isAlpha ? (
                        <input
                          ref={el => {
                            inputRefs.current[index] = el;
                          }}
                          type="text"
                          inputMode="text"
                          autoCapitalize="characters"
                          autoCorrect="off"
                          autoComplete="off"
                          spellCheck="false"
                          enterKeyHint="done"
                          className="tile-native-input"
                          value={userVal}
                          onChange={e => handleTileChange(index, e.target.value)}
                          onKeyDown={e => handleTileKeyDown(index, e)}
                          onFocus={() => setPuzzle(prev => (prev ? { ...prev, activeIdx: index } : null))}
                          maxLength={2}
                        />
                      ) : (
                        <div className="tile-punct">{char}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="quote-meta-author">
            — {quote.author}
          </div>
        </div>
      </div>

      {/* 4. Action Row */}
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
            disabled={filledLetters === 0}
          >
            Submit & Check Solution ✓
          </button>
        ) : workoutContext ? (
          <button
            className="btn-submit btn-next btn-workout-next"
            onClick={() => {
              const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
              const accuracy = result
                ? Math.round((result.correctChars / (result.totalChars || 1)) * 100)
                : 100;
              workoutContext.onAdvance({
                timeSeconds: elapsed,
                accuracy,
                author: quote.author,
              });
            }}
          >
            {workoutContext.isLastStep
              ? 'Finish Round 🏆 ➔'
              : `Next: ${workoutContext.nextCipherTitle || 'Next'} ➔`}
          </button>
        ) : (
          <button className="btn-submit btn-next" onClick={loadNewQuote}>
            Next Puzzle →
          </button>
        )}
      </DrillActionRow>

      {/* 5. Result Banner */}
      {result && <ResultBanner result={result} />}
    </div>
  );
};
