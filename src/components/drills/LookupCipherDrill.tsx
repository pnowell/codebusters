import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PigpenGlyph } from '../symbols/PigpenGlyph';
import { GalacticGlyph } from '../symbols/GalacticGlyph';
import { ReferenceSheet } from '../symbols/ReferenceSheet';
import { atbashChar, evaluateSolution } from '../../utils/ciphers';
import quotesData from '../../data/quotes.json';
import type { Quote, EvaluationResult } from '../../types';

interface LookupCipherDrillProps {
  cipher: 'atbash' | 'pigpen' | 'galactic';
  onBack: () => void;
  initialQuoteId?: number;
  onQuoteChange?: (quoteId: number) => void;
}

export const LookupCipherDrill: React.FC<LookupCipherDrillProps> = ({
  cipher,
  onBack,
  initialQuoteId,
  onQuoteChange,
}) => {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [userInputs, setUserInputs] = useState<string[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const [showRef, setShowRef] = useState<boolean>(true);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);

  // References to input elements for seamless typing navigation
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const scrollPanelRef = useRef<HTMLDivElement | null>(null);

  // Load a quote (either by specified target ID or picked from suitable pool)
  const loadQuote = useCallback((targetQuoteId?: number) => {
    let chosen: Quote | undefined;
    if (targetQuoteId !== undefined) {
      chosen = (quotesData as Quote[]).find(q => q.id === targetQuoteId);
    }
    if (!chosen) {
      const pool = (quotesData as Quote[]).filter(q => q.length <= 60);
      chosen = pool[Math.floor(Math.random() * pool.length)] || (quotesData[0] as Quote);
    }

    setQuote(chosen);
    onQuoteChange?.(chosen.id);

    const chars = chosen.quote.toUpperCase().split('');
    const initialInputs = chars.map(c => (/^[A-Z]$/.test(c) ? '' : c));
    setUserInputs(initialInputs);

    const firstAlpha = chars.findIndex(c => /^[A-Z]$/.test(c));
    const targetIdx = firstAlpha >= 0 ? firstAlpha : 0;
    setActiveIdx(targetIdx);
    setResult(null);
    setIsSubmitted(false);

    // Refocus first input after quote renders without browser scroll jump
    setTimeout(() => {
      inputRefs.current[targetIdx]?.focus({ preventScroll: true });
    }, 50);
  }, [onQuoteChange]);

  useEffect(() => {
    loadQuote(initialQuoteId);
  }, [loadQuote, initialQuoteId]);

  // Keep focused character tile centered in horizontal scroll view and visible vertically
  // without triggering whole-page jump/glitch or conflicting smooth-scroll animations
  useEffect(() => {
    const panel = scrollPanelRef.current;
    const el = inputRefs.current[activeIdx];
    if (!panel || !el) return;

    const panelRect = panel.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    // Horizontal auto-centering: keep the active tile centered in the viewport
    const elCenterX = elRect.left + elRect.width / 2;
    const panelCenterX = panelRect.left + panelRect.width / 2;
    const diffX = elCenterX - panelCenterX;
    if (Math.abs(diffX) > 15) {
      panel.scrollLeft += diffX;
    }

    // Vertical visibility: only scroll vertically if the tile is actually outside the view
    const margin = 10;
    if (elRect.top < panelRect.top + margin) {
      panel.scrollTop -= (panelRect.top + margin - elRect.top);
    } else if (elRect.bottom > panelRect.bottom - margin) {
      panel.scrollTop += (elRect.bottom - (panelRect.bottom - margin));
    }
  }, [activeIdx]);

  // Find next/prev alpha index
  const getNextAlphaIndex = (start: number): number => {
    if (!quote) return start;
    const chars = quote.quote.toUpperCase().split('');
    for (let i = start + 1; i < chars.length; i++) {
      if (/^[A-Z]$/.test(chars[i])) return i;
    }
    return start;
  };

  const getPrevAlphaIndex = (start: number): number => {
    if (!quote) return start;
    const chars = quote.quote.toUpperCase().split('');
    for (let i = start - 1; i >= 0; i--) {
      if (/^[A-Z]$/.test(chars[i])) return i;
    }
    return start;
  };

  // Explicit submit solution
  const handleSubmit = useCallback(() => {
    if (!quote) return;
    const res = evaluateSolution(quote.quote, userInputs.join(''));
    setResult(res);
    setIsSubmitted(true);
  }, [quote, userInputs]);

  // Tile input change
  const handleTileChange = (index: number, val: string) => {
    if (!quote) return;
    if (isSubmitted) {
      setIsSubmitted(false);
      setResult(null);
    }

    const lastChar = val.slice(-1).toUpperCase();
    const updated = [...userInputs];

    if (/^[A-Z]$/.test(lastChar)) {
      updated[index] = lastChar;
      setUserInputs(updated);
      const nextIdx = getNextAlphaIndex(index);
      setActiveIdx(nextIdx);
      inputRefs.current[nextIdx]?.focus({ preventScroll: true });
    } else if (val === '') {
      updated[index] = '';
      setUserInputs(updated);
    }
  };

  // Keyboard navigation & Enter shortcuts
  const handleTileKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!userInputs[index]) {
        e.preventDefault();
        const prevIdx = getPrevAlphaIndex(index);
        setActiveIdx(prevIdx);
        const updated = [...userInputs];
        updated[prevIdx] = '';
        setUserInputs(updated);
        inputRefs.current[prevIdx]?.focus({ preventScroll: true });
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIdx = getPrevAlphaIndex(index);
      setActiveIdx(prevIdx);
      inputRefs.current[prevIdx]?.focus({ preventScroll: true });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIdx = getNextAlphaIndex(index);
      setActiveIdx(nextIdx);
      inputRefs.current[nextIdx]?.focus({ preventScroll: true });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!isSubmitted) {
        handleSubmit();
      } else {
        loadQuote();
      }
    }
  };

  // Render cipher representation for a single char
  const renderCipherChar = (char: string) => {
    const upper = char.toUpperCase();
    if (!/^[A-Z]$/.test(upper)) {
      return <span className="plain-symbol">{char}</span>;
    }

    if (cipher === 'atbash') {
      return <span className="atbash-cipher-char">{atbashChar(upper)}</span>;
    } else if (cipher === 'pigpen') {
      return <PigpenGlyph letter={upper} size={22} />;
    } else if (cipher === 'galactic') {
      return <GalacticGlyph letter={upper} size={22} />;
    }
    return upper;
  };

  // Group characters into words for clean responsive display
  const renderWords = () => {
    if (!quote) return null;
    const chars = quote.quote.toUpperCase().split('');
    const words: Array<Array<{ char: string; index: number }>> = [];
    let currentWord: Array<{ char: string; index: number }> = [];

    chars.forEach((char, idx) => {
      if (char === ' ') {
        if (currentWord.length > 0) {
          words.push(currentWord);
          currentWord = [];
        }
      } else {
        currentWord.push({ char, index: idx });
      }
    });
    if (currentWord.length > 0) {
      words.push(currentWord);
    }

    return (
      <div className="quote-display-grid">
        {words.map((word, wIdx) => (
          <div key={wIdx} className="word-cluster">
            {word.map(({ char, index }) => {
              const isAlpha = /^[A-Z]$/.test(char);
              const isActive = activeIdx === index;
              const userVal = userInputs[index] || '';
              const isCorrect = isSubmitted && userVal === char;
              const isWrong = isSubmitted && isAlpha && userVal !== '' && userVal !== char;

              return (
                <div
                  key={index}
                  className={`char-tile ${isActive ? 'active-tile' : ''} ${isCorrect ? 'correct-tile' : ''} ${isWrong ? 'wrong-tile' : ''}`}
                  onClick={() => isAlpha && inputRefs.current[index]?.focus({ preventScroll: true })}
                >
                  <div className="tile-cipher">{renderCipherChar(char)}</div>
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
                      onFocus={() => setActiveIdx(index)}
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
    );
  };

  const cipherTitles = {
    atbash: 'Atbash',
    pigpen: 'Pigpen',
    galactic: 'Galactic',
  };

  const totalLetters = quote
    ? quote.quote.toUpperCase().split('').filter(c => /^[A-Z]$/.test(c)).length
    : 0;
  const filledLetters = userInputs.filter((c, idx) => {
    const orig = quote ? quote.quote[idx] : '';
    return /^[A-Z]$/i.test(orig) && c !== '';
  }).length;

  return (
    <div className="drill-container lookup-drill">
      {/* 1. Compact single-line drill header */}
      <div className="drill-header-compact">
        <button className="btn-simple btn-back" onClick={onBack}>
          ← Menu
        </button>
        <h2 className="drill-title-compact">{cipherTitles[cipher]}</h2>
        <button
          className="btn-simple btn-reload"
          onClick={() => loadQuote()}
          title="New Quote"
        >
          New ↻
        </button>
      </div>

      {/* 2. Sticky Reference Table that sticks to top on scroll */}
      {showRef ? (
        <div className="sticky-ref-container">
          <ReferenceSheet
            singleCipher={cipher}
            compact={true}
            onClose={() => setShowRef(false)}
          />
        </div>
      ) : (
        <div className="show-ref-row">
          <button
            type="button"
            className="btn-simple show-ref-btn"
            onClick={() => setShowRef(true)}
          >
            📖 Show Reference Table
          </button>
        </div>
      )}

      {/* 3. Horizontal Scroll Viewport for Cipher Lines */}
      <div className="cipher-scroll-panel" ref={scrollPanelRef}>
        <div className="quote-content-canvas">
          {renderWords()}

          {quote && (
            <div className="quote-meta-author">
              — {quote.author}
            </div>
          )}
        </div>
      </div>

      {/* 4. Action Row & Results (separated from scroll viewport, 100% screen width) */}
      <div className="drill-action-row">
        <div className="progress-info">
          Progress: <strong>{filledLetters} / {totalLetters}</strong> letters
        </div>

        {!isSubmitted ? (
          <button
            className="btn-submit"
            onClick={handleSubmit}
            disabled={filledLetters === 0}
          >
            Submit & Check Solution ✓
          </button>
        ) : (
          <button className="btn-submit btn-next" onClick={() => loadQuote()}>
            Next Puzzle →
          </button>
        )}
      </div>

      {result && (
        <div className={`result-banner score-${result.scoreTier}`}>
          {result.scoreTier === 'full' && (
            <>🎉 <strong>Full Credit!</strong> Decoded with {result.errorCount} error{result.errorCount === 1 ? '' : 's'} (allowed: ≤ 2 errors).</>
          )}
          {result.scoreTier === 'half' && (
            <>⚖️ <strong>Half Credit!</strong> Decoded with {result.errorCount} errors (3–4 errors allowed).</>
          )}
          {result.scoreTier === 'none' && (
            <>❌ <strong>{result.errorCount} Errors!</strong> Keep practicing with the reference table.</>
          )}
        </div>
      )}
    </div>
  );
};
