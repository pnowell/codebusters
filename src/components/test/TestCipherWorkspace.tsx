import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { PigpenGlyph } from '../symbols/PigpenGlyph';
import { GalacticGlyph } from '../symbols/GalacticGlyph';
import { CollapsibleReference } from '../drill/CollapsibleReference';
import { ReferenceSheet } from '../drill/ReferenceSheet';
import {
  atbashChar,
  caesarChar,
  letterToOffset,
  isLetter,
  findLetterIndex,
  groupIntoWords,
} from '../../utils/ciphers';
import { useKeepInView } from '../../hooks/useKeepInView';
import type { Quote, TestQuestion } from '../../types';

interface TestCipherWorkspaceProps {
  question: TestQuestion;
  quote: Quote;
  userInputs: string[];
  onChangeUserInputs: (inputs: string[]) => void;
  disabled?: boolean;
}

const CipherDisplayGlyph: React.FC<{
  question: TestQuestion;
  char: string;
  charAlphaIndex: number;
}> = ({ question, char, charAlphaIndex }) => {
  const upper = char.toUpperCase();
  if (!isLetter(upper)) return <>{char}</>;

  switch (question.cipher) {
    case 'atbash':
      return <>{atbashChar(upper)}</>;
    case 'pigpen':
      return <PigpenGlyph letter={upper} size={22} />;
    case 'galactic':
      return <GalacticGlyph letter={upper} size={22} />;
    case 'caesar': {
      const shift = question.params?.caesarShift ?? 3;
      return <>{caesarChar(upper, shift)}</>;
    }
    case 'aristocrat': {
      const mapping = question.params?.alphabetMapping;
      const sub = mapping ? mapping[upper] || upper : upper;
      return <>{sub}</>;
    }
    case 'vigenere': {
      const key = (question.params?.vigenereKey || 'CIPHER').toUpperCase();
      const keyChar = key[charAlphaIndex % key.length] || 'A';
      const shift = letterToOffset(keyChar);
      return <>{caesarChar(upper, shift)}</>;
    }
    default:
      return <>{upper}</>;
  }
};

export const TestCipherWorkspace: React.FC<TestCipherWorkspaceProps> = ({
  question,
  quote,
  userInputs,
  onChangeUserInputs,
  disabled = false,
}) => {
  const chars = useMemo(() => quote.quote.toUpperCase().split(''), [quote.quote]);
  const words = useMemo(() => groupIntoWords(chars), [chars]);
  const firstLetterIdx = useMemo(() => chars.findIndex(isLetter), [chars]);

  const [activeIdx, setActiveIdx] = useState<number>(() =>
    firstLetterIdx >= 0 ? firstLetterIdx : 0
  );

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const scrollPanelRef = useRef<HTMLDivElement | null>(null);

  // Focus tile helper
  const focusTile = useCallback((index: number) => {
    setActiveIdx(index);
    inputRefs.current[index]?.focus({ preventScroll: true });
  }, []);

  // When question changes, refocus active tile
  useEffect(() => {
    inputRefs.current[activeIdx]?.focus({ preventScroll: true });
  }, [question.questionNumber, activeIdx]);

  // Keep focused character tile visible
  useKeepInView(scrollPanelRef, () => inputRefs.current[activeIdx], activeIdx);

  // Compute 0-indexed alpha position for each character in the quote
  const alphaIndices = useMemo(() => {
    let alphaCount = 0;
    return chars.map(c => (isLetter(c) ? alphaCount++ : -1));
  }, [chars]);

  const totalLetters = useMemo(() => chars.filter(isLetter).length, [chars]);
  const filledLetters = useMemo(
    () => userInputs.filter((c, idx) => isLetter(chars[idx]) && c !== '').length,
    [chars, userInputs]
  );

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
    }
  };

  // Determine reference sheet component or custom reference based on cipher type
  const renderReferenceSheet = () => {
    if (question.cipher === 'atbash' || question.cipher === 'pigpen' || question.cipher === 'galactic') {
      return (
        <CollapsibleReference
          className="sticky-ref-container reference-sheet"
          showLabel="Show Reference Sheet"
        >
          <ReferenceSheet cipher={question.cipher} />
        </CollapsibleReference>
      );
    }

    if (question.cipher === 'caesar') {
      return (
        <CollapsibleReference
          className="sticky-ref-container reference-sheet"
          showLabel="Show Caesar Shift Table"
        >
          <div className="caesar-ref-card">
            <div className="caesar-ref-header">
              Caesar Shift: <strong>{question.params?.caesarShift ? `+${question.params.caesarShift}` : 'Standard'}</strong>
            </div>
            <div className="caesar-ref-grid">
              <div className="caesar-ref-row">
                <span className="caesar-row-label">Plain:</span>
                {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => (
                  <span key={l} className="caesar-cell plain-cell">{l}</span>
                ))}
              </div>
              <div className="caesar-ref-row">
                <span className="caesar-row-label">Cipher:</span>
                {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => (
                  <span key={l} className="caesar-cell cipher-cell">
                    {caesarChar(l, question.params?.caesarShift ?? 3)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </CollapsibleReference>
      );
    }

    if (question.cipher === 'vigenere') {
      return (
        <CollapsibleReference
          className="sticky-ref-container reference-sheet"
          showLabel="Show Vigenère Table"
        >
          <div className="ref-content-image-box">
            <div className="ref-image-wrapper">
              <img src="references/vigenere_table.png" alt="Vigenère Table" className="official-ref-img" />
            </div>
          </div>
        </CollapsibleReference>
      );
    }

    if (question.cipher === 'aristocrat') {
      return (
        <CollapsibleReference
          className="sticky-ref-container reference-sheet"
          showLabel="Show Frequency Table"
        >
          <div className="ref-content-image-box">
            <div className="ref-image-wrapper">
              <img src="references/frequencies_table.png" alt="English Letter Frequencies" className="official-ref-img" />
            </div>
          </div>
        </CollapsibleReference>
      );
    }

    return null;
  };

  return (
    <div className="test-cipher-workspace">
      {/* 1. Problem Description / Hint */}
      {question.description && (
        <div className="test-question-prompt">
          <p>{question.description}</p>
        </div>
      )}

      {/* 2. Collapsible Reference Table */}
      {renderReferenceSheet()}

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

                  return (
                    <div
                      key={index}
                      className={`char-tile ${isActive ? 'active-tile' : ''} ${
                        userVal ? 'filled-tile' : ''
                      }`}
                      onClick={() => isAlpha && !disabled && focusTile(index)}
                    >
                      <div className="tile-cipher">
                        <CipherDisplayGlyph
                          question={question}
                          char={char}
                          charAlphaIndex={alphaIndices[index]}
                        />
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
                          enterKeyHint="next"
                          className="tile-native-input"
                          value={userVal}
                          onChange={e => handleTileChange(index, e.target.value)}
                          onKeyDown={e => handleTileKeyDown(index, e)}
                          onFocus={() => setActiveIdx(index)}
                          maxLength={2}
                          disabled={disabled}
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

      {/* 4. Bottom Completion Tracker */}
      <div className="test-workspace-footer">
        <div className="test-progress-text">
          Letters Filled: <strong>{filledLetters} / {totalLetters}</strong> (
          {Math.round((filledLetters / (totalLetters || 1)) * 100)}%)
        </div>
      </div>
    </div>
  );
};
