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
import { saveCompletedQuoteId } from '../../services/storage';
import type { Quote, EvaluationResult } from '../../types';

interface LookupCipherDrillProps {
  cipher: LookupCipherType;
  onBack: () => void;
  initialQuoteId?: number;
  onQuoteChange?: (quoteId: number) => void;
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

export const LookupCipherDrill: React.FC<LookupCipherDrillProps> = ({
  cipher,
  onBack,
  initialQuoteId,
  onQuoteChange,
}) => {
  const [puzzle, setPuzzle] = useState(() => freshPuzzle(pickLookupQuote(initialQuoteId)));
  const { quote, userInputs, activeIdx } = puzzle;
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const scrollPanelRef = useRef<HTMLDivElement | null>(null);

  // Inform parent of quote ID changes via ref to prevent stale closures/unwanted re-renders
  const onQuoteChangeRef = useRef(onQuoteChange);
  onQuoteChangeRef.current = onQuoteChange;
  useEffect(() => {
    onQuoteChangeRef.current?.(quote.id);
  }, [quote.id]);

  // Derived quote data
  const chars = useMemo(() => quote.quote.toUpperCase().split(''), [quote.quote]);
  const words = useMemo(() => groupIntoWords(chars), [chars]);
  const totalLetters = useMemo(() => chars.filter(isLetter).length, [chars]);
  const filledLetters = userInputs.filter((c, idx) => isLetter(chars[idx]) && c !== '').length;

  // Focus tile helper
  const focusTile = useCallback((index: number) => {
    setPuzzle(prev => ({ ...prev, activeIdx: index }));
    inputRefs.current[index]?.focus({ preventScroll: true });
  }, []);

  // Refocus first active tile whenever quote changes
  useEffect(() => {
    inputRefs.current[puzzle.activeIdx]?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only refocus when quote changes
  }, [quote.id]);

  // Keep focused character tile visible horizontally and vertically
  useKeepInView(scrollPanelRef, () => inputRefs.current[activeIdx], activeIdx);

  const loadNewQuote = () => {
    setPuzzle(freshPuzzle(pickLookupQuote()));
    setResult(null);
    setIsSubmitted(false);
  };

  const handleSubmit = useCallback(() => {
    const res = evaluateSolution(quote.quote, userInputs.join(''));
    setResult(res);
    setIsSubmitted(true);
    saveCompletedQuoteId(quote.id);
  }, [quote.id, quote.quote, userInputs]);

  const handleTileChange = (index: number, val: string) => {
    if (isSubmitted) {
      setIsSubmitted(false);
      setResult(null);
    }

    const lastChar = val.slice(-1).toUpperCase();
    const updated = [...userInputs];

    if (isLetter(lastChar)) {
      updated[index] = lastChar;
      setPuzzle(prev => ({ ...prev, userInputs: updated }));
      const nextIdx = findLetterIndex(chars, index, 1);
      focusTile(nextIdx);
    } else if (val === '') {
      updated[index] = '';
      setPuzzle(prev => ({ ...prev, userInputs: updated }));
    }
  };

  const handleTileKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!userInputs[index]) {
        e.preventDefault();
        const prevIdx = findLetterIndex(chars, index, -1);
        const updated = [...userInputs];
        updated[prevIdx] = '';
        setPuzzle(prev => ({ ...prev, userInputs: updated }));
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

  return (
    <div className="drill-container">
      {/* 1. Header */}
      <DrillHeader
        title={getDrill(cipher).shortTitle}
        onBack={onBack}
        right={
          <button
            className="btn-simple btn-reload"
            onClick={loadNewQuote}
            title="New Quote"
          >
            New ↻
          </button>
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
                          onFocus={() => setPuzzle(prev => ({ ...prev, activeIdx: index }))}
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
