import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CipherGlyph } from './CipherGlyph';
import { isLetter, findLetterIndex, groupIntoWords } from '../../../utils/ciphers';
import { useKeepInView } from '../../../hooks/useKeepInView';
import type { CipherType, Quote, TestCipherParams } from '../../../types';

interface QuoteTileGridProps {
  cipher: CipherType;
  params?: TestCipherParams;
  quote: Quote;
  userInputs: string[];
  onChangeUserInputs: (inputs: string[]) => void;
  disabled?: boolean;
  showEvaluation?: boolean;
  onEnterSubmit?: () => void;
}

export const QuoteTileGrid: React.FC<QuoteTileGridProps> = ({
  cipher,
  params,
  quote,
  userInputs,
  onChangeUserInputs,
  disabled = false,
  showEvaluation = false,
  onEnterSubmit,
}) => {
  const chars = useMemo(() => quote.quote.toUpperCase().split(''), [quote.quote]);
  const words = useMemo(() => groupIntoWords(chars), [chars]);
  const firstLetterIdx = useMemo(() => chars.findIndex(isLetter), [chars]);

  const alphaIndices = useMemo(() => {
    let alphaCount = 0;
    return chars.map((c) => (isLetter(c) ? alphaCount++ : -1));
  }, [chars]);

  const [prevQuoteId, setPrevQuoteId] = useState<number>(quote.id);
  const [activeIdx, setActiveIdx] = useState<number>(() =>
    firstLetterIdx >= 0 ? firstLetterIdx : 0
  );

  if (prevQuoteId !== quote.id) {
    setPrevQuoteId(quote.id);
    setActiveIdx(firstLetterIdx >= 0 ? firstLetterIdx : 0);
  }

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const scrollPanelRef = useRef<HTMLDivElement | null>(null);

  const focusTile = useCallback(
    (index: number) => {
      if (disabled) return;
      setActiveIdx(index);
      inputRefs.current[index]?.focus({ preventScroll: true });
    },
    [disabled]
  );

  // Refocus active tile when quote changes, or blur all inputs when disabled/submitted
  useEffect(() => {
    if (disabled) {
      inputRefs.current.forEach((el) => el?.blur());
    } else {
      inputRefs.current[activeIdx]?.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refocus only when quote or disabled state changes
  }, [quote.id, disabled]);

  // Keep focused character tile visible horizontally and vertically
  useKeepInView(scrollPanelRef, () => inputRefs.current[activeIdx], activeIdx);

  const handleTileChange = (index: number, val: string) => {
    if (disabled) return;
    const lastChar = val.slice(-1).toUpperCase();
    const updated = [...userInputs];

    if (isLetter(lastChar)) {
      updated[index] = lastChar;
      onChangeUserInputs(updated);
      const nextIdx = findLetterIndex(chars, index, 1);
      focusTile(nextIdx);
    } else if (val === '') {
      updated[index] = '';
      onChangeUserInputs(updated);
    }
  };

  const handleTileKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'Backspace') {
      if (!userInputs[index]) {
        e.preventDefault();
        const prevIdx = findLetterIndex(chars, index, -1);
        const updated = [...userInputs];
        updated[prevIdx] = '';
        onChangeUserInputs(updated);
        focusTile(prevIdx);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusTile(findLetterIndex(chars, index, -1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusTile(findLetterIndex(chars, index, 1));
    } else if (e.key === 'Enter' && onEnterSubmit) {
      e.preventDefault();
      onEnterSubmit();
    }
  };

  return (
    <div className="cipher-scroll-panel" ref={scrollPanelRef}>
      <div className="quote-content-canvas">
        <div className="quote-display-grid">
          {words.map((word, wIdx) => (
            <div key={wIdx} className="word-cluster">
              {word.map(({ char, index }) => {
                const isAlpha = isLetter(char);
                const isActive = !disabled && activeIdx === index;
                const userVal = userInputs[index] || '';
                const isCorrect = showEvaluation && userVal === char;
                const isWrong =
                  showEvaluation && isAlpha && userVal !== '' && userVal !== char;
                const isFilled = !showEvaluation && Boolean(userVal);

                const tileClasses = [
                  'char-tile',
                  isActive ? 'active-tile' : '',
                  isCorrect ? 'correct-tile' : '',
                  isWrong ? 'wrong-tile' : '',
                  isFilled ? 'filled-tile' : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <div
                    key={index}
                    className={tileClasses}
                    onClick={() => isAlpha && !disabled && focusTile(index)}
                  >
                    <div className="tile-cipher">
                      <CipherGlyph
                        cipher={cipher}
                        params={params}
                        char={char}
                        alphaIndex={alphaIndices[index]}
                      />
                    </div>
                    {isAlpha ? (
                      <input
                        ref={(el) => {
                          inputRefs.current[index] = el;
                        }}
                        type="text"
                        inputMode="text"
                        autoCapitalize="characters"
                        autoCorrect="off"
                        autoComplete="off"
                        spellCheck="false"
                        enterKeyHint={onEnterSubmit ? 'done' : 'next'}
                        className="tile-native-input"
                        value={userVal}
                        disabled={disabled}
                        onChange={(e) => handleTileChange(index, e.target.value)}
                        onKeyDown={(e) => handleTileKeyDown(index, e)}
                        onFocus={() => !disabled && setActiveIdx(index)}
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

        <div className="quote-meta-author">— {quote.author}</div>
      </div>
    </div>
  );
};
