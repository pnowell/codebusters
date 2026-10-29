import React, { useState } from 'react';
import type { TestPacket, TestEvaluationResult, QuestionResult } from '../../types';
import { getDrill } from '../../data/drills';
import { getQuoteById } from '../../data/quotes';
import { groupIntoWords, isLetter } from '../../utils/ciphers';

interface TestResultsModalProps {
  testPacket: TestPacket;
  results: TestEvaluationResult;
  onClose: () => void;
}

const QuestionDetailCard: React.FC<{
  questionResult: QuestionResult;
  questionNumber: number;
}> = ({ questionResult }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const quote = getQuoteById(questionResult.quoteId);
  const drill = getDrill(questionResult.cipher);
  const cipherTitle = drill ? drill.shortTitle : questionResult.cipher;

  const targetChars = questionResult.targetPlaintext.toUpperCase().split('');
  const studentChars = questionResult.studentInput.toUpperCase().split('');
  const words = groupIntoWords(targetChars);

  const getTierBadge = () => {
    switch (questionResult.scoreTier) {
      case 'full':
        return (
          <span className="results-tier-badge tier-full">
            Full Credit ({questionResult.errorCount} {questionResult.errorCount === 1 ? 'error' : 'errors'})
          </span>
        );
      case 'half':
        return (
          <span className="results-tier-badge tier-half">
            Half Credit ({questionResult.errorCount} errors)
          </span>
        );
      case 'none':
        return (
          <span className="results-tier-badge tier-none">
            No Credit ({questionResult.errorCount} errors)
          </span>
        );
    }
  };

  return (
    <div className={`results-question-card tier-${questionResult.scoreTier}`}>
      <div
        className="results-question-header"
        onClick={() => setIsExpanded(prev => !prev)}
      >
        <div className="results-q-title-group">
          <span className="results-q-num">Q{questionResult.questionNumber}</span>
          <span className="results-q-cipher">{cipherTitle}</span>
          {questionResult.isTiebreaker && (
            <span className="results-tb-badge">★ TIEBREAKER</span>
          )}
        </div>

        <div className="results-q-score-group">
          <span className="results-q-points">
            <strong>{questionResult.pointsEarned}</strong> / {questionResult.maxPoints} pts
          </span>
          {getTierBadge()}
          <span className="results-accordion-arrow">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {isExpanded && (
        <div className="results-question-body">
          {quote?.author && (
            <div className="results-q-author">Quote by: {quote.author}</div>
          )}

          <div className="results-diff-container">
            <div className="results-diff-canvas">
              {words.map((word, wIdx) => (
                <div key={wIdx} className="results-word-cluster">
                  {word.map(({ char, index }) => {
                    const isAlpha = isLetter(char);
                    const targetChar = char;
                    const studentChar = studentChars[index] || '';

                    if (!isAlpha) {
                      return (
                        <div key={index} className="results-char-tile punct-tile">
                          <div className="tile-punct">{char}</div>
                        </div>
                      );
                    }

                    const isCorrect = studentChar === targetChar;
                    const isMissing = studentChar === '';
                    const isIncorrect = !isCorrect && !isMissing;

                    return (
                      <div
                        key={index}
                        className={`results-char-tile ${
                          isCorrect ? 'tile-correct' : isIncorrect ? 'tile-error' : 'tile-missing'
                        }`}
                      >
                        <div className="results-student-letter">
                          {studentChar || '·'}
                        </div>
                        {!isCorrect && (
                          <div className="results-target-correction">
                            {targetChar}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="results-diff-legend">
            <span className="legend-item legend-correct">■ Correct</span>
            <span className="legend-item legend-error">■ Incorrect</span>
            <span className="legend-item legend-missing">· Missing/Omitted</span>
          </div>
        </div>
      )}
    </div>
  );
};

export const TestResultsModal: React.FC<TestResultsModalProps> = ({
  testPacket,
  results,
  onClose,
}) => {
  const percentage = Math.round(
    (results.totalScore / (results.maxPossibleScore || 1)) * 100
  );

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  };

  const fullCount = results.questions.filter(q => q.scoreTier === 'full').length;
  const halfCount = results.questions.filter(q => q.scoreTier === 'half').length;
  const noneCount = results.questions.filter(q => q.scoreTier === 'none').length;

  return (
    <div className="modal-backdrop test-results-modal-backdrop">
      <div className="modal-card test-results-modal-card">
        {/* Header Summary Banner */}
        <div className="results-summary-header">
          <div className="results-trophy-icon">🏆</div>
          <h2 className="results-summary-title">Test Results</h2>
          <div className="results-summary-subtitle">{testPacket.title}</div>

          <div className="results-main-stats-grid">
            <div className="results-stat-box score-stat-box">
              <span className="stat-label">TOTAL SCORE</span>
              <span className="stat-value">
                {results.totalScore} <span className="stat-max">/ {results.maxPossibleScore}</span>
              </span>
              <span className="stat-percentage">{percentage}%</span>
            </div>

            <div className="results-stat-box time-stat-box">
              <span className="stat-label">TIME SPENT</span>
              <span className="stat-value">{formatTime(results.timeSpentSeconds)}</span>
              <span className="stat-max">Limit: {formatTime(testPacket.timeLimitSeconds)}</span>
            </div>

            <div className="results-stat-box breakdown-stat-box">
              <span className="stat-label">SCORING BREAKDOWN</span>
              <div className="stat-breakdown-row">
                <span className="breakdown-tag tag-full">Full: {fullCount}</span>
                <span className="breakdown-tag tag-half">Half: {halfCount}</span>
                <span className="breakdown-tag tag-none">0: {noneCount}</span>
              </div>
              <span className="stat-so-rules">SoCal Division A Error Bracket Rules</span>
            </div>
          </div>
        </div>

        {/* Question by Question Review */}
        <div className="results-scroll-list">
          <h3 className="results-questions-heading">Problem Breakdown & Error Analysis</h3>
          {results.questions.map(q => (
            <QuestionDetailCard
              key={q.questionNumber}
              questionNumber={q.questionNumber}
              questionResult={q}
            />
          ))}
        </div>

        {/* Modal Action Bar */}
        <div className="results-footer-bar">
          <button className="btn-main-action btn-results-close" onClick={onClose}>
            Back to Main Menu ➔
          </button>
        </div>
      </div>
    </div>
  );
};
