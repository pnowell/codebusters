import React, { useMemo } from 'react';
import { CollapsibleReference } from '../drills/shared/CollapsibleReference';
import { ReferenceSheet } from '../drills/shared/ReferenceSheet';
import { QuoteTileGrid } from '../drills/shared/QuoteTileGrid';
import { caesarChar, isLetter } from '../../utils/ciphers';
import type { Quote, TestQuestion } from '../../types';

interface TestCipherWorkspaceProps {
  question: TestQuestion;
  quote: Quote;
  userInputs: string[];
  onChangeUserInputs: (inputs: string[]) => void;
  disabled?: boolean;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export const TestCipherWorkspace: React.FC<TestCipherWorkspaceProps> = ({
  question,
  quote,
  userInputs,
  onChangeUserInputs,
  disabled = false,
}) => {
  const chars = useMemo(() => quote.quote.toUpperCase().split(''), [quote.quote]);
  const totalLetters = useMemo(() => chars.filter(isLetter).length, [chars]);
  const filledLetters = useMemo(
    () => userInputs.filter((c, idx) => isLetter(chars[idx] ?? '') && c !== '').length,
    [chars, userInputs]
  );

  const renderReferenceSheet = () => {
    if (
      question.cipher === 'atbash' ||
      question.cipher === 'pigpen' ||
      question.cipher === 'galactic'
    ) {
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
              Caesar Shift:{' '}
              <strong>
                {question.params?.caesarShift ? `+${question.params.caesarShift}` : 'Standard'}
              </strong>
            </div>
            <div className="caesar-ref-grid">
              <div className="caesar-ref-row">
                <span className="caesar-row-label">Plain:</span>
                {ALPHABET.map((l) => (
                  <span key={l} className="caesar-cell plain-cell">
                    {l}
                  </span>
                ))}
              </div>
              <div className="caesar-ref-row">
                <span className="caesar-row-label">Cipher:</span>
                {ALPHABET.map((l) => (
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
          <ReferenceSheet cipher="vigenere" />
        </CollapsibleReference>
      );
    }

    if (question.cipher === 'aristocrat') {
      return (
        <CollapsibleReference
          className="sticky-ref-container reference-sheet"
          showLabel="Show Frequency Table"
        >
          <ReferenceSheet cipher="frequencies" />
        </CollapsibleReference>
      );
    }

    return null;
  };

  return (
    <div className="test-cipher-workspace">
      {question.description && (
        <div className="test-question-prompt">
          <p>{question.description}</p>
        </div>
      )}

      {renderReferenceSheet()}

      <QuoteTileGrid
        cipher={question.cipher}
        params={question.params}
        quote={quote}
        userInputs={userInputs}
        onChangeUserInputs={onChangeUserInputs}
        disabled={disabled}
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
