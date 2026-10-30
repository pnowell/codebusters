import React, { useState } from 'react';
import type { TestPacket, TestAttempt } from '../../types';
import { getLocalTestAttempt } from '../../services/testService';

interface PracticeTestsListProps {
  tests: TestPacket[];
  attempts: Record<string, TestAttempt>;
  isLoading?: boolean;
  onSelectTest: (test: TestPacket, attempt: TestAttempt | null) => void;
  onBack: () => void;
}

export const PracticeTestsList: React.FC<PracticeTestsListProps> = ({
  tests,
  attempts,
  isLoading = false,
  onSelectTest,
  onBack,
}) => {
  const [now] = useState(() => Date.now());

  return (
    <div className="practice-tests-view">
      {/* 1. Header */}
      <header className="practice-tests-header">
        <button
          className="btn-simple btn-tests-back"
          onClick={onBack}
          title="Return to Main Menu"
        >
          ← Main Menu
        </button>
        <div className="practice-tests-header-title">
          <h2>Practice Tests</h2>
        </div>
      </header>

      {/* 2. List of Tests */}
      <main className="practice-tests-scroll-list">
        {isLoading && tests.length === 0 ? (
          <div className="tests-list-empty">
            <div className="empty-icon">⏳</div>
            <p>Loading available practice tests...</p>
          </div>
        ) : tests.length === 0 ? (
          <div className="tests-list-empty">
            <div className="empty-icon">📝</div>
            <p>No practice tests available yet.</p>
            <small>New tests authored by your teacher will appear here automatically.</small>
          </div>
        ) : (
          tests.map((test) => {
            // Resolve attempt: check memory/cloud attempts map or localStorage backup
            const cloudAttempt = attempts[test.testId];
            const localAttempt = getLocalTestAttempt(test.testId);

            let resolvedAttempt: TestAttempt | null = null;
            if (localAttempt && cloudAttempt) {
              const localTime = Math.max(localAttempt.submittedAt || 0, localAttempt.startedAt || 0);
              const cloudTime = Math.max(cloudAttempt.submittedAt || 0, cloudAttempt.startedAt || 0);
              if (localTime >= cloudTime) {
                resolvedAttempt = localAttempt;
              } else {
                resolvedAttempt = cloudAttempt;
              }
            } else {
              resolvedAttempt = localAttempt || cloudAttempt || null;
            }

            const isTimeRemaining = resolvedAttempt?.startedAt
              ? now < (resolvedAttempt.startedAt + test.timeLimitSeconds * 1000)
              : true;
            const isCompleted =
              resolvedAttempt?.status === 'submitted' || resolvedAttempt?.status === 'expired';
            const isInProgress = resolvedAttempt?.status === 'in_progress' && isTimeRemaining;
            const results = resolvedAttempt?.results;

            const totalPoints = test.questions.reduce((sum, q) => sum + q.points, 0);
            const minutes = Math.round(test.timeLimitSeconds / 60);

            const scorePercentage =
              results && results.maxPossibleScore > 0
                ? Math.round((results.totalScore / results.maxPossibleScore) * 100)
                : 0;

            return (
              <div
                key={test.testId}
                className={`test-list-row ${isCompleted ? 'row-completed' : ''} ${
                  isInProgress ? 'row-in-progress' : ''
                }`}
                onClick={() => onSelectTest(test, resolvedAttempt)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectTest(test, resolvedAttempt);
                  }
                }}
              >
                {/* Top Row: Title + Status Badge */}
                <div className="test-row-top">
                  <h3 className="test-row-title">{test.title}</h3>
                  {isCompleted && results ? (
                    <span className="test-row-score-badge">
                      🏆 {results.totalScore} / {results.maxPossibleScore} pts ({scorePercentage}%)
                    </span>
                  ) : isInProgress ? (
                    <span className="test-row-status-pill pill-in-progress">
                      ⏱️ In Progress
                    </span>
                  ) : (
                    <span className="test-row-status-pill pill-available">
                      Available
                    </span>
                  )}
                </div>

                {/* Bottom Row: Metadata Chips + CTA text */}
                <div className="test-row-bottom">
                  <div className="test-row-meta">
                    <span className="test-card-meta-item">⏱️ {minutes} Mins</span>
                    <span className="test-card-meta-item">🧩 {test.questions.length} Questions</span>
                    <span className="test-card-meta-item">⭐ {totalPoints} Pts</span>
                  </div>

                  <div className="test-row-action-indicator">
                    {isCompleted ? (
                      <span className="action-text action-results">View Results ➔</span>
                    ) : isInProgress ? (
                      <span className="action-text action-resume">Resume Test ➔</span>
                    ) : (
                      <span className="action-text action-start">Start Test ➔</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
};
