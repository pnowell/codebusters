import React, { useState } from 'react';
import type { TestPacket, QuestionWorkspace } from '../../types';
import { getQuoteById } from '../../data/quotes';
import { getDrill } from '../../data/drills';
import { isLetter } from '../../utils/ciphers';

interface TestReviewScreenProps {
  testPacket: TestPacket;
  workspaces: Record<number, QuestionWorkspace>;
  remainingSeconds: number;
  onJumpToQuestion: (questionIndex: number) => void;
  onSubmitTest: () => void;
}

export const TestReviewScreen: React.FC<TestReviewScreenProps> = ({
  testPacket,
  workspaces,
  remainingSeconds,
  onJumpToQuestion,
  onSubmitTest,
}) => {
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Compute status for each question
  const questionStatuses = testPacket.questions.map((q, idx) => {
    const quote = getQuoteById(q.quoteId);
    const targetAlphaCount = quote ? quote.quote.toUpperCase().split('').filter(isLetter).length : 0;
    const ws = workspaces[idx];
    const filledCount = ws
      ? ws.userInputs.filter((c, cIdx) => {
          if (!quote) return false;
          const originalChar = quote.quote.toUpperCase()[cIdx];
          return isLetter(originalChar) && c !== '';
        }).length
      : 0;

    let status: 'complete' | 'in_progress' | 'untouched' = 'untouched';
    if (filledCount === targetAlphaCount && targetAlphaCount > 0) {
      status = 'complete';
    } else if (filledCount > 0) {
      status = 'in_progress';
    }

    const drillInfo = getDrill(q.cipher);
    const cipherTitle = drillInfo ? drillInfo.shortTitle : q.cipher;

    return {
      index: idx,
      questionNumber: q.questionNumber,
      cipherTitle,
      cipher: q.cipher,
      points: q.points,
      isTiebreaker: !!q.isTiebreaker,
      filledCount,
      targetAlphaCount,
      status,
    };
  });

  const completedCount = questionStatuses.filter(s => s.status === 'complete').length;
  const inProgressCount = questionStatuses.filter(s => s.status === 'in_progress').length;
  const untouchedCount = questionStatuses.filter(s => s.status === 'untouched').length;
  const hasIncomplete = inProgressCount > 0 || untouchedCount > 0;

  const handleEndTestClick = () => {
    if (hasIncomplete && remainingSeconds > 30) {
      setShowConfirmModal(true);
    } else {
      onSubmitTest();
    }
  };

  return (
    <div className="test-review-screen">
      <div className="test-review-header">
        <div className="test-review-title-group">
          <h2>Review & Submit Test</h2>
          <p className="test-review-subtitle">
            Check your progress below before submitting. You can jump back to any problem to review or make changes.
          </p>
        </div>

        <div className="test-review-summary-pills">
          <div className="summary-pill completed-pill">
            <span className="pill-number">{completedCount}</span>
            <span className="pill-label">Completed</span>
          </div>
          <div className="summary-pill progress-pill">
            <span className="pill-number">{inProgressCount}</span>
            <span className="pill-label">In Progress</span>
          </div>
          <div className="summary-pill untouched-pill">
            <span className="pill-number">{untouchedCount}</span>
            <span className="pill-label">Untouched</span>
          </div>
        </div>
      </div>

      {/* Question Status Grid */}
      <div className="test-review-table-container">
        <table className="test-review-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Cipher</th>
              <th>Points</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {questionStatuses.map(qs => (
              <tr key={qs.questionNumber} className={`status-row status-${qs.status}`}>
                <td className="col-num">
                  <span className="q-badge">Q{qs.questionNumber}</span>
                  {qs.isTiebreaker && <span className="tb-star" title="Tiebreaker Question">★</span>}
                </td>
                <td className="col-cipher">{qs.cipherTitle}</td>
                <td className="col-pts">{qs.points} pts</td>
                <td className="col-status">
                  {qs.status === 'complete' && (
                    <span className="status-badge badge-complete">
                      ✓ Done ({qs.filledCount}/{qs.targetAlphaCount})
                    </span>
                  )}
                  {qs.status === 'in_progress' && (
                    <span className="status-badge badge-progress">
                      ✎ In Progress ({qs.filledCount}/{qs.targetAlphaCount})
                    </span>
                  )}
                  {qs.status === 'untouched' && (
                    <span className="status-badge badge-untouched">
                      ⚠️ Untouched (0/{qs.targetAlphaCount})
                    </span>
                  )}
                </td>
                <td className="col-action">
                  <button
                    className="btn-simple btn-review-jump"
                    onClick={() => onJumpToQuestion(qs.index)}
                  >
                    Edit ➔
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Submission Footer */}
      <div className="test-review-actions-bar">
        {hasIncomplete && (
          <div className="test-review-warning-note">
            ⚠️ You have {inProgressCount + untouchedCount} incomplete question{inProgressCount + untouchedCount > 1 ? 's' : ''}. Unanswered letters are counted as errors.
          </div>
        )}

        <button className="btn-main-action btn-submit-test-final" onClick={handleEndTestClick}>
          End Test & Submit Solutions ✓
        </button>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmModal && (
        <div className="modal-backdrop" onClick={() => setShowConfirmModal(false)}>
          <div className="modal-card confirm-modal" onClick={e => e.stopPropagation()}>
            <h3 className="confirm-modal-title">Submit Test Early?</h3>
            <p className="confirm-modal-text">
              You still have <strong>{formatTime(remainingSeconds)}</strong> remaining on the clock and{' '}
              <strong>{inProgressCount + untouchedCount} question(s)</strong> with missing answers.
            </p>
            <p className="confirm-modal-text-sub">
              Are you sure you want to finish now and score your test?
            </p>
            <div className="confirm-modal-buttons">
              <button
                className="btn-simple"
                onClick={() => setShowConfirmModal(false)}
              >
                Keep Solving ➔
              </button>
              <button
                className="btn-main-action btn-danger"
                onClick={() => {
                  setShowConfirmModal(false);
                  onSubmitTest();
                }}
              >
                Submit Score Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
