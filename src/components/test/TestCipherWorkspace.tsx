import React, { useMemo } from 'react';
import { CollapsibleReference } from '../drills/shared/CollapsibleReference';
import { ReferenceSheet } from '../drills/shared/ReferenceSheet';
import { QuoteTileGrid } from '../drills/shared/QuoteTileGrid';
import { isLetter } from '../../utils/ciphers';
import type { CipherWorkspaceParams, Quote, TestQuestion } from '../../types';

interface TestCipherWorkspaceProps {
  question: TestQuestion;
  quote: Quote;
  userInputs: string[];
  onChangeUserInputs: (inputs: string[]) => void;
  keyInputs?: string[];
  onChangeKeyInputs?: (inputs: string[]) => void;
  disabled?: boolean;
}

export const TestCipherWorkspace: React.FC<TestCipherWorkspaceProps> = ({
  question,
  quote,
  userInputs,
  onChangeUserInputs,
  keyInputs,
  onChangeKeyInputs,
  disabled = false,
}) => {
  const chars = useMemo(() => quote.quote.toUpperCase().split(''), [quote.quote]);
  const totalLetters = useMemo(() => chars.filter(isLetter).length, [chars]);
  const filledLetters = useMemo(
    () => userInputs.filter((c, idx) => isLetter(chars[idx] ?? '') && c !== '').length,
    [chars, userInputs]
  );

  const cipherParams = useMemo<CipherWorkspaceParams | undefined>(() => {
    if (question.cipher === 'caesar') {
      return { caesarOffset: question.caesarOffset ?? 1, caesarRange: 'pm3' };
    }
    if (question.cipher === 'vigenere') {
      return { vigenereKeyword: question.vigenereKeyword ?? 'KEY' };
    }
    return undefined;
  }, [question.caesarOffset, question.cipher, question.vigenereKeyword]);

  return (
    <div className="test-cipher-workspace">
      {question.description && (
        <div className="test-question-prompt">
          <p>{question.description}</p>
        </div>
      )}

      <CollapsibleReference
        className="sticky-ref-container reference-sheet"
        showLabel="Show Reference Sheet"
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
