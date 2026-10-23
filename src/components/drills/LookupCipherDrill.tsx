import React, { useState, useEffect, useCallback } from 'react';
import { PigpenGlyph } from '../symbols/PigpenGlyph';
import { GalacticGlyph } from '../symbols/GalacticGlyph';
import { ReferenceSheet } from '../symbols/ReferenceSheet';
import { VirtualKeyboard } from '../common/VirtualKeyboard';
import { atbashChar, evaluateSolution } from '../../utils/ciphers';
import quotesData from '../../data/quotes.json';
import type { Quote, EvaluationResult } from '../../types';

interface LookupCipherDrillProps {
  cipher: 'atbash' | 'pigpen' | 'galactic';
  onBack: () => void;
}

export const LookupCipherDrill: React.FC<LookupCipherDrillProps> = ({
  cipher,
  onBack,
}) => {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [userInputs, setUserInputs] = useState<string[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const [showRef, setShowRef] = useState<boolean>(true);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);

  // Load a quote suitable for lookup drills
  const loadNewQuote = useCallback(() => {
    const pool = (quotesData as Quote[]).filter(q => q.length <= 60);
    const chosen = pool[Math.floor(Math.random() * pool.length)] || (quotesData[0] as Quote);
    setQuote(chosen);

    const chars = chosen.quote.toUpperCase().split('');
    // Pre-populate non-alphabet characters (spaces, punctuation)
    const initialInputs = chars.map(c => (/^[A-Z]$/.test(c) ? '' : c));
    setUserInputs(initialInputs);

    // Set active index to first alphabet character
    const firstAlpha = chars.findIndex(c => /^[A-Z]$/.test(c));
    setActiveIdx(firstAlpha >= 0 ? firstAlpha : 0);
    setResult(null);
    setIsSubmitted(false);
  }, []);

  useEffect(() => {
    loadNewQuote();
  }, [loadNewQuote]);

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

  const handleInputChar = (char: string) => {
    if (!quote) return;

    // If already submitted and user types, allow them to continue editing
    if (isSubmitted) {
      setIsSubmitted(false);
      setResult(null);
    }

    const chars = quote.quote.toUpperCase().split('');
    if (!/^[A-Z]$/.test(chars[activeIdx])) return;

    const updated = [...userInputs];
    updated[activeIdx] = char.toUpperCase();
    setUserInputs(updated);

    // Auto-advance to next blank or next character without auto-submitting
    const nextIdx = getNextAlphaIndex(activeIdx);
    setActiveIdx(nextIdx);
  };

  const handleBackspace = () => {
    if (!quote) return;
    if (isSubmitted) {
      setIsSubmitted(false);
      setResult(null);
    }

    const updated = [...userInputs];
    if (updated[activeIdx] !== '') {
      updated[activeIdx] = '';
      setUserInputs(updated);
    } else {
      const prevIdx = getPrevAlphaIndex(activeIdx);
      updated[prevIdx] = '';
      setUserInputs(updated);
      setActiveIdx(prevIdx);
    }
  };

  const handleClear = () => {
    if (!quote) return;
    if (isSubmitted) {
      setIsSubmitted(false);
      setResult(null);
    }
    const updated = [...userInputs];
    updated[activeIdx] = '';
    setUserInputs(updated);
  };

  // Explicit submit button click
  const handleSubmit = () => {
    if (!quote) return;
    const res = evaluateSolution(quote.quote, userInputs.join(''));
    setResult(res);
    setIsSubmitted(true);
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
      return <PigpenGlyph letter={upper} size={32} />;
    } else if (cipher === 'galactic') {
      return <GalacticGlyph letter={upper} size={30} />;
    }
    return upper;
  };

  // Group characters into words for clean responsive wrapping
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
                  onClick={() => isAlpha && setActiveIdx(index)}
                >
                  <div className="tile-cipher">{renderCipherChar(char)}</div>
                  {isAlpha ? (
                    <div className="tile-input">{userVal || ' '}</div>
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

  const cipherNames = {
    atbash: 'Atbash Cipher',
    pigpen: 'Pigpen / Masonic Cipher',
    galactic: 'Standard Galactic Alphabet',
  };

  // Check how many letters are filled
  const totalLetters = quote
    ? quote.quote.toUpperCase().split('').filter(c => /^[A-Z]$/.test(c)).length
    : 0;
  const filledLetters = userInputs.filter((c, idx) => {
    const orig = quote ? quote.quote[idx] : '';
    return /^[A-Z]$/i.test(orig) && c !== '';
  }).length;

  return (
    <div className="drill-container lookup-drill">
      <div className="drill-header">
        <button className="btn-simple" onClick={onBack}>
          ← Back to Menu
        </button>
        <div className="drill-title-simple">
          <h2>{cipherNames[cipher]}</h2>
        </div>
        <div className="header-actions">
          <button
            className={`btn-simple ${showRef ? 'btn-active' : ''}`}
            onClick={() => setShowRef(prev => !prev)}
          >
            {showRef ? 'Hide Reference' : 'Show Reference'}
          </button>
          <button className="btn-simple" onClick={loadNewQuote}>
            New Quote ↻
          </button>
        </div>
      </div>

      {showRef && (
        <div className="reference-panel-wrapper">
          <ReferenceSheet initialCipher={cipher} compact={true} />
        </div>
      )}

      <div className="quote-workspace simple-card">
        {renderWords()}

        {quote && (
          <div className="quote-meta-author">
            — {quote.author}
          </div>
        )}

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
            <button className="btn-submit btn-next" onClick={loadNewQuote}>
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

      <VirtualKeyboard
        onChar={handleInputChar}
        onBackspace={handleBackspace}
        onClear={handleClear}
      />
    </div>
  );
};
