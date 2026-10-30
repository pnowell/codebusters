import React from 'react';
import type { TestPacket, QuestionWorkspace } from '../../types';
import { getDrill } from '../../data/drills';
import { getQuestionProgress } from '../../utils/testProgress';

interface TestReviewScreenProps {
  testPacket: TestPacket;
  workspaces: Record<number, QuestionWorkspace>;
  onJumpToQuestion: (questionIndex: number) => void;
  onSubmitTest: () => void;
}

export const TestReviewScreen: React.FC<TestReviewScreenProps> = ({
  testPacket,
  workspaces,
  onJumpToQuestion,
  onSubmitTest,
}) => {
  // Compute status for each question
  const questionStatuses = testPacket.questions.map((q, idx) => {
    const { filledCount, targetAlphaCount, status } = getQuestionProgress(q, workspaces[idx]);
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
  const notStartedCount = questionStatuses.filter(s => s.status === 'untouched').length;
  const hasIncomplete = inProgressCount > 0 || notStartedCount > 0;

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
            <span className="pill-number">{notStartedCount}</span>
            <span className="pill-label">Not started</span>
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
                      ✓ Complete ({qs.filledCount}/{qs.targetAlphaCount})
                    </span>
                  )}
                  {qs.status === 'in_progress' && (
                    <span className="status-badge badge-progress">
                      ✎ In Progress ({qs.filledCount}/{qs.targetAlphaCount})
                    </span>
                  )}
                  {qs.status === 'untouched' && (
                    <span className="status-badge badge-untouched">
                      Not started (0/{qs.targetAlphaCount})
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
            ⚠️ You have {inProgressCount + notStartedCount} incomplete question{inProgressCount + notStartedCount > 1 ? 's' : ''}. Unanswered letters are counted as errors.
          </div>
        )}

        <button className="btn-main-action btn-submit-test-final" onClick={onSubmitTest}>
          End Test & Submit Solutions ✓
        </button>
      </div>
    </div>
  );
};
