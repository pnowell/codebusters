import React, { useCallback, useMemo, useState } from 'react';
import { CollapsibleReference } from '../drills/shared/CollapsibleReference';
import { ReferenceSheet } from '../drills/shared/ReferenceSheet';
import { QuoteTileGrid } from '../drills/shared/QuoteTileGrid';
import {
  aristocratEncryptText,
  computeCiphertextFrequencies,
} from '../../utils/aristocrat';
import { isLetter } from '../../utils/ciphers';
import { resolveQuestionAristocratAlphabet } from '../../utils/testSync';
import type {
  AristocratCornerTuple,
  AristocratEditAction,
  CipherWorkspaceParams,
  Quote,
  TestQuestion,
} from '../../types';

interface TestCipherWorkspaceProps {
  question: TestQuestion;
  questionIndex: number;
  quote: Quote;
  userInputs: string[];
  onChangeUserInputs: (inputs: string[]) => void;
  keyInputs?: string[];
  onChangeKeyInputs?: (inputs: string[]) => void;
  aristocratReplacements?: Partial<Record<string, string>>;
  aristocratCorners?: Partial<Record<string, AristocratCornerTuple>>;
  onAristocratEdit?: (action: AristocratEditAction) => void;
  disabled?: boolean;
}

export const TestCipherWorkspace: React.FC<TestCipherWorkspaceProps> = ({
  question,
  questionIndex,
  quote,
  userInputs,
  onChangeUserInputs,
  keyInputs,
  onChangeKeyInputs,
  aristocratReplacements,
  aristocratCorners,
  onAristocratEdit,
  disabled = false,
}) => {
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

  const chars = useMemo(() => quote.quote.toUpperCase().split(''), [quote.quote]);
  const totalLetters = useMemo(() => chars.filter(isLetter).length, [chars]);
  const filledLetters = useMemo(
    () => userInputs.filter((c, idx) => isLetter(chars[idx] ?? '') && c !== '').length,
    [chars, userInputs]
  );

  const aristocratAlphabet = useMemo(
    () =>
      question.cipher === 'aristocrat'
        ? resolveQuestionAristocratAlphabet(question, questionIndex)
        : undefined,
    [question, questionIndex]
  );

  const aristocratFrequencies = useMemo(
    () =>
      question.cipher === 'aristocrat' && aristocratAlphabet
        ? computeCiphertextFrequencies(
            aristocratEncryptText(quote.quote, aristocratAlphabet)
          )
        : undefined,
    [aristocratAlphabet, question.cipher, quote.quote]
  );

  const cipherParams = useMemo<CipherWorkspaceParams | undefined>(() => {
    if (question.cipher === 'caesar') {
      return { caesarOffset: question.caesarOffset ?? 1, caesarRange: 'pm3' };
    }
    if (question.cipher === 'vigenere') {
      return { vigenereKeyword: question.vigenereKeyword ?? 'KEY' };
    }
    if (question.cipher === 'aristocrat') {
      return {
        aristocratAlphabet,
        aristocratFrequencies,
        aristocratReplacements,
        aristocratCorners,
        aristocratActiveCipherLetter: activeCipherLetter,
        aristocratTableFocusNonce: tableFocusNonce,
        aristocratDisabled: disabled,
        onAristocratEdit,
        onSelectAristocratCipherLetter: handleSelectAristocratCipherLetter,
      };
    }
    return undefined;
  }, [
    activeCipherLetter,
    aristocratAlphabet,
    aristocratCorners,
    aristocratFrequencies,
    aristocratReplacements,
    disabled,
    handleSelectAristocratCipherLetter,
    onAristocratEdit,
    question.caesarOffset,
    question.cipher,
    question.vigenereKeyword,
    tableFocusNonce,
  ]);

  return (
    <div className="test-cipher-workspace">
      {question.description && (
        <div className="test-question-prompt">
          <p>{question.description}</p>
        </div>
      )}

      <CollapsibleReference
        className="sticky-ref-container reference-sheet"
        showLabel={
          question.cipher === 'aristocrat'
            ? 'Show Replacement & Frequency Tables'
            : 'Show Reference Sheet'
        }
      >
        <ReferenceSheet cipher={question.cipher} cipherParams={cipherParams} />
      </CollapsibleReference>

      <QuoteTileGrid
        cipher={question.cipher}
        quote={quote}
        userInputs={userInputs}
        onChangeUserInputs={onChangeUserInputs}
        keyInputs={question.cipher === 'vigenere' ? keyInputs : undefined}
        onChangeKeyInputs={
          question.cipher === 'vigenere' ? onChangeKeyInputs : undefined
        }
        disabled={disabled}
        cipherParams={cipherParams}
      />

      <div className="test-workspace-footer">
        <div className="test-progress-text">
          Letters Filled: <strong>{filledLetters} / {totalLetters}</strong> (
          {Math.round((filledLetters / (totalLetters || 1)) * 100)}%)
        </div>
      </div>
    </div>
  );
};
