import React, { useState } from 'react';
import type { TestPacket, TestAttempt } from '../../types';
import { formatClock } from '../../utils/format';
import { Modal } from '../common/Modal';

interface TestBriefingModalProps {
  testPacket: TestPacket;
  existingAttempt: TestAttempt | null;
  onBegin: () => void;
  onResume: () => void;
  onClose: () => void;
}

export const TestBriefingModal: React.FC<TestBriefingModalProps> = ({
  testPacket,
  existingAttempt,
  onBegin,
  onResume,
  onClose,
}) => {
  const totalPoints = testPacket.questions.reduce((sum, q) => sum + q.points, 0);
  const minutes = Math.round(testPacket.timeLimitSeconds / 60);

  const [now] = useState(() => Date.now());
  const isResumable =
    existingAttempt &&
    existingAttempt.status === 'in_progress' &&
    now < existingAttempt.startedAt + testPacket.timeLimitSeconds * 1000;

  const remainingSeconds = isResumable
    ? Math.max(
        0,
        Math.round(
          (existingAttempt.startedAt + testPacket.timeLimitSeconds * 1000 - now) / 1000
        )
      )
    : 0;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      ariaLabelledBy="briefing-modal-title"
      backdropClassName="briefing-modal-backdrop"
      dialogClassName="briefing-modal-card"
    >
      <div className="briefing-header">
        <div className="briefing-icon">📝</div>
        <h2 id="briefing-modal-title" className="briefing-title">
          {testPacket.title}
        </h2>
        <div className="briefing-badge">Science Olympiad Division A</div>
      </div>

      <div className="briefing-stats-strip">
        <div className="briefing-stat">
          <span className="stat-label">TIME LIMIT</span>
          <span className="stat-value">⏱️ {minutes} Mins</span>
        </div>
        <div className="briefing-stat">
          <span className="stat-label">PROBLEMS</span>
          <span className="stat-value">🧩 {testPacket.questions.length} Questions</span>
        </div>
        <div className="briefing-stat">
          <span className="stat-label">TOTAL VALUE</span>
          <span className="stat-value">⭐ {totalPoints} Points</span>
        </div>
      </div>

      <div className="briefing-body">
        <p className="briefing-description">{testPacket.description}</p>

        <div className="briefing-rules-box">
          <h4>📋 Rules & Guidance</h4>
          <ul>
            <li>
              <strong>Official Reference Tables:</strong> Each question provides a collapsible reference table (Pigpen, Galactic, Atbash, etc.).
            </li>
            <li>
              <strong>Scoring Bracket:</strong> 0–2 errors = Full Credit, 3–4 errors = Half Credit, 5+ errors = No Credit.
            </li>
            <li>
              <strong>Unanswered letters:</strong> Count as errors under official Science Olympiad rules.
            </li>
            <li>
              <strong>Free Navigation:</strong> Jump back and forth between questions at any time. Your work saves automatically.
            </li>
          </ul>
        </div>

        {isResumable && (
          <div className="briefing-resume-banner">
            ℹ️ You have an in-progress session with{' '}
            <strong>{formatClock(remainingSeconds)}</strong> left on the clock.
          </div>
        )}
      </div>

      <div className="briefing-actions">
        <button className="btn-simple" onClick={onClose}>
          Cancel
        </button>
        {isResumable ? (
          <button className="btn-main-action btn-resume" onClick={onResume}>
            Resume Test ({formatClock(remainingSeconds)}) ➔
          </button>
        ) : (
          <button className="btn-main-action btn-begin" onClick={onBegin}>
            Begin Practice Test ➔
          </button>
        )}
      </div>
    </Modal>
  );
};
