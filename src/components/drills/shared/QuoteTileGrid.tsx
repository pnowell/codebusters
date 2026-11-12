import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CipherGlyph } from './CipherGlyph';
import {
  computeVigenereKeySequence,
  findLetterIndex,
  groupIntoWords,
  isLetter,
  isRetainedInContinuousStream,
  sanitizeVigenereKeyword,
} from '../../../utils/ciphers';
import { useKeepInView } from '../../../hooks/useKeepInView';
import type {
  CipherWorkspaceParams,
  Quote,
  TestableCipherType,
} from '../../../types';

type ActiveGridRow = 'key' | 'plain';

interface QuoteTileGridProps {
  cipher: TestableCipherType;
  quote: Quote;
  userInputs: string[];
  onChangeUserInputs: (inputs: string[]) => void;
  keyInputs?: string[];
  onChangeKeyInputs?: (inputs: string[]) => void;
  disabled?: boolean;
  showEvaluation?: boolean;
  onEnterSubmit?: () => void;
  cipherParams?: CipherWorkspaceParams;
}

export const QuoteTileGrid: React.FC<QuoteTileGridProps> = ({
  cipher,
  quote,
  userInputs,
  onChangeUserInputs,
  keyInputs,
  onChangeKeyInputs,
  disabled = false,
  showEvaluation = false,
  onEnterSubmit,
  cipherParams,
}) => {
  const isVigenere = cipher === 'vigenere';
  const hasEditableKeyRow = isVigenere && Boolean(onChangeKeyInputs);
  const chars = useMemo(() => quote.quote.toUpperCase().split(''), [quote.quote]);
  const words = useMemo(() => groupIntoWords(chars), [chars]);
  const firstLetterIdx = useMemo(() => chars.findIndex(isLetter), [chars]);

  const activeKeyword = useMemo(
    () =>
      isVigenere
        ? sanitizeVigenereKeyword(cipherParams?.vigenereKeyword) || 'KEY'
        : '',
    [cipherParams?.vigenereKeyword, isVigenere]
  );

  const vigenereKeyChars = useMemo(
    () =>
      isVigenere ? computeVigenereKeySequence(quote.quote, activeKeyword) : [],
    [activeKeyword, isVigenere, quote.quote]
  );

  const computeDefaultFocusState = useCallback((): {
    row: ActiveGridRow;
    idx: number;
  } => {
    const startIdx = firstLetterIdx >= 0 ? firstLetterIdx : 0;
    if (!hasEditableKeyRow) {
      return { row: 'plain', idx: startIdx };
    }
    const allKeyFilled = chars.every(
      (ch, idx) => !isLetter(ch) || Boolean(keyInputs?.[idx])
    );
    if (allKeyFilled) {
      const firstBlankPlain = chars.findIndex(
        (ch, idx) => isLetter(ch) && !userInputs[idx]
      );
      return {
        row: 'plain',
        idx: firstBlankPlain >= 0 ? firstBlankPlain : startIdx,
      };
    }
    const firstBlankKey = chars.findIndex(
      (ch, idx) => isLetter(ch) && !keyInputs?.[idx]
    );
    return {
      row: 'key',
      idx: firstBlankKey >= 0 ? firstBlankKey : startIdx,
    };
  }, [chars, firstLetterIdx, hasEditableKeyRow, keyInputs, userInputs]);

  const puzzleIdentity = `${cipher}:${quote.id}`;
  const [prevPuzzleIdentity, setPrevPuzzleIdentity] =
    useState<string>(puzzleIdentity);
  const [activeRow, setActiveRow] = useState<ActiveGridRow>(
    () => computeDefaultFocusState().row
  );
  const [activeIdx, setActiveIdx] = useState<number>(
    () => computeDefaultFocusState().idx
  );

  if (prevPuzzleIdentity !== puzzleIdentity) {
    setPrevPuzzleIdentity(puzzleIdentity);
    const nextFocus = computeDefaultFocusState();
    setActiveRow(nextFocus.row);
    setActiveIdx(nextFocus.idx);
  }

  const keyInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const scrollPanelRef = useRef<HTMLDivElement | null>(null);

  const effectiveActiveRow: ActiveGridRow = hasEditableKeyRow ? activeRow : 'plain';

  const focusCell = useCallback(
    (row: ActiveGridRow, index: number) => {
      if (disabled) return;
      const targetRow: ActiveGridRow = hasEditableKeyRow ? row : 'plain';
      setActiveRow(targetRow);
      setActiveIdx(index);
      const refList = targetRow === 'key' ? keyInputRefs : inputRefs;
      refList.current[index]?.focus({ preventScroll: true });
    },
    [disabled, hasEditableKeyRow]
  );

  // Refocus active cell when puzzle or disabled state changes
  useEffect(() => {
    if (disabled) {
      keyInputRefs.current.forEach((el) => el?.blur());
      inputRefs.current.forEach((el) => el?.blur());
    } else if (activeIdx >= 0) {
      const refList =
        effectiveActiveRow === 'key' ? keyInputRefs : inputRefs;
      refList.current[activeIdx]?.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refocus only when puzzle identity or disabled state changes
  }, [puzzleIdentity, disabled]);

  // Keep focused character tile visible horizontally and vertically
  const keepInViewKey = activeIdx * 2 + (effectiveActiveRow === 'key' ? 0 : 1);
  useKeepInView(
    scrollPanelRef,
    () =>
      activeIdx >= 0
        ? effectiveActiveRow === 'key'
          ? keyInputRefs.current[activeIdx]
          : inputRefs.current[activeIdx]
        : null,
    keepInViewKey
  );

  const buildMutableKeyInputs = (): string[] => {
    if (keyInputs && keyInputs.length === chars.length) {
      return [...keyInputs];
    }
    return chars.map((ch, i) => (isLetter(ch) ? keyInputs?.[i] || '' : ch));
  };

  const handleKeyCellChange = (index: number, val: string) => {
    if (disabled || !onChangeKeyInputs) return;
    const lastChar = val.slice(-1).toUpperCase();
    const updated = buildMutableKeyInputs();

    if (isLetter(lastChar)) {
      updated[index] = lastChar;
      onChangeKeyInputs(updated);
      // Advance horizontally to the keyword cell of the next letter (never down to plaintext)
      const nextIdx = findLetterIndex(chars, index, 1);
      if (nextIdx === index) {
        // Unfocus once the final keyword slot is filled so rapid repeated
        // keyword typing does not overwrite the last slot.
        setActiveRow('plain');
        setActiveIdx(-1);
        keyInputRefs.current[index]?.blur();
      } else {
        focusCell('key', nextIdx);
      }
    } else if (val === '') {
      updated[index] = '';
      onChangeKeyInputs(updated);
    }
  };

  const handleKeyCellKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (disabled || !onChangeKeyInputs) return;
    if (e.key === 'Backspace') {
      if (!keyInputs?.[index]) {
        e.preventDefault();
        const prevIdx = findLetterIndex(chars, index, -1);
        const updated = buildMutableKeyInputs();
        updated[prevIdx] = '';
        onChangeKeyInputs(updated);
        focusCell('key', prevIdx);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusCell('key', findLetterIndex(chars, index, -1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusCell('key', findLetterIndex(chars, index, 1));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusCell('plain', index);
    } else if (e.key === 'Enter' && onEnterSubmit) {
      e.preventDefault();
      onEnterSubmit();
    }
  };

  const handleTileChange = (index: number, val: string) => {
    if (disabled) return;
    const lastChar = val.slice(-1).toUpperCase();
    const updated = [...userInputs];

    if (isLetter(lastChar)) {
      updated[index] = lastChar;
      onChangeUserInputs(updated);
      const nextIdx = findLetterIndex(chars, index, 1);
      focusCell('plain', nextIdx);
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
        focusCell('plain', prevIdx);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusCell('plain', findLetterIndex(chars, index, -1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusCell('plain', findLetterIndex(chars, index, 1));
    } else if (e.key === 'ArrowUp' && hasEditableKeyRow) {
      e.preventDefault();
      focusCell('key', index);
    } else if (e.key === 'Enter' && onEnterSubmit) {
      e.preventDefault();
      onEnterSubmit();
    }
  };

  const isContinuousStream = cipher === 'tap';
  const streamItems = useMemo(
    () =>
      chars
        .map((char, index) => ({ char, index }))
        .filter((item) => isRetainedInContinuousStream(item.char)),
    [chars]
  );

  const renderTile = ({ char, index }: { char: string; index: number }) => {
    const isAlpha = isLetter(char);
    const isActive = !disabled && isAlpha && activeIdx === index;
    const userVal = userInputs[index] || '';
    const keyVal = keyInputs?.[index] || '';
    const isCorrect = showEvaluation && isAlpha && userVal === char;
    const isWrong = showEvaluation && isAlpha && userVal !== char;
    const isFilled = !showEvaluation && isAlpha && Boolean(userVal);

    const tileCipherParams =
      isVigenere && isAlpha
        ? { ...cipherParams, vigenereKeyChar: vigenereKeyChars[index] }
        : cipherParams;

    const tileClasses = [
      'char-tile',
      isVigenere ? 'vigenere-tile' : '',
      !isAlpha ? 'punct-tile' : '',
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
        onClick={() =>
          isAlpha && !disabled && focusCell(effectiveActiveRow, index)
        }
      >
        <div className="tile-cipher">
          <CipherGlyph
            cipher={cipher}
            char={char}
            cipherParams={tileCipherParams}
          />
        </div>

        {isVigenere &&
          (isAlpha ? (
            <input
              ref={(el) => {
                keyInputRefs.current[index] = el;
              }}
              type="text"
              size={1}
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck="false"
              enterKeyHint="next"
              aria-label={`Keyword cell ${index + 1}`}
              className={`tile-key-input${
                isActive && effectiveActiveRow === 'key' ? ' active-subcell' : ''
              }`}
              value={keyVal}
              disabled={disabled || !onChangeKeyInputs}
              onClick={(e) => {
                e.stopPropagation();
                if (!disabled && onChangeKeyInputs) {
                  focusCell('key', index);
                }
              }}
              onChange={(e) => handleKeyCellChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyCellKeyDown(index, e)}
              onFocus={() => {
                if (!disabled && onChangeKeyInputs) {
                  setActiveRow('key');
                  setActiveIdx(index);
                }
              }}
              maxLength={2}
            />
          ) : (
            <div className="tile-key-punct" aria-hidden="true" />
          ))}

        {isAlpha ? (
          <input
            ref={(el) => {
              inputRefs.current[index] = el;
            }}
            type="text"
            size={1}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck="false"
            enterKeyHint={onEnterSubmit ? 'done' : 'next'}
            aria-label={isVigenere ? `Plaintext cell ${index + 1}` : undefined}
            className={`tile-native-input${
              isVigenere && isActive && effectiveActiveRow === 'plain'
                ? ' active-subcell'
                : ''
            }`}
            value={userVal}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (!disabled) {
                focusCell('plain', index);
              }
            }}
            onChange={(e) => handleTileChange(index, e.target.value)}
            onKeyDown={(e) => handleTileKeyDown(index, e)}
            onFocus={() => {
              if (!disabled) {
                setActiveRow('plain');
                setActiveIdx(index);
              }
            }}
            maxLength={2}
          />
        ) : (
          <div className="tile-punct">{char}</div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`cipher-scroll-panel${isContinuousStream ? ' tap-scroll-panel' : ''}`}
      ref={scrollPanelRef}
    >
      <div className="quote-content-canvas">
        {isVigenere && activeKeyword && (
          <div className="vigenere-key-banner">
            <span className="vigenere-key-label">Key:</span>
            <span className="vigenere-key-value">{activeKeyword}</span>
          </div>
        )}

        <div className={`quote-display-grid${isContinuousStream ? ' tap-quote-grid' : ''}`}>
          {isContinuousStream
            ? streamItems.map(renderTile)
            : words.map((word, wIdx) => (
                <div key={wIdx} className="word-cluster">
                  {word.map(renderTile)}
                </div>
              ))}
        </div>

        <div className="quote-meta-author">— {quote.author}</div>
      </div>
    </div>
  );
};
