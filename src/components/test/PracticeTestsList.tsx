import React, { useEffect, useState } from 'react';
import type { TestAttempt, TestPacket } from '../../types';
import {
  getDisplayNamesForUids,
  subscribeTeamProfiles,
} from '../../services/profileService';
import { resolveAttemptForTest } from '../../services/testService';
import { resolveUserCohort } from '../../utils/testSync';

interface PracticeTestsListProps {
  tests: TestPacket[];
  attempts: Record<string, TestAttempt>;
  currentUid?: string;
  isTeacher?: boolean;
  isLoading?: boolean;
  onSelectTest: (test: TestPacket, attempt: TestAttempt | null) => void;
  onNewTest?: () => void;
  onEditTest?: (testId: string) => void;
  onOpenQuotesBrowser?: () => void;
  onBack: () => void;
}

export const PracticeTestsList: React.FC<PracticeTestsListProps> = ({
  tests,
  attempts,
  currentUid,
  isTeacher = false,
  isLoading = false,
  onSelectTest,
  onNewTest,
  onEditTest,
  onOpenQuotesBrowser,
  onBack,
}) => {
  const [now, setNow] = useState(() => Date.now());
  const [, setProfilesVersion] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    const unsubProfiles = subscribeTeamProfiles(() => {
      setProfilesVersion((v) => v + 1);
    });
    return () => {
      clearInterval(timer);
      unsubProfiles();
    };
  }, []);

  return (
    <div className="practice-tests-view">
      {/* 1. Header */}
      <header className="practice-tests-header">
        <div className="practice-tests-header-left">
          <button
            type="button"
            className="btn-simple btn-tests-back"
            onClick={onBack}
            title="Return to Main Menu"
          >
            ← Main Menu
          </button>
          <div className="practice-tests-header-title">
            <h2>Practice Tests</h2>
          </div>
        </div>

        {isTeacher && (
          <div className="practice-tests-teacher-actions">
            {onOpenQuotesBrowser && (
              <button
                type="button"
                className="btn-simple btn-quotes-browser"
                onClick={onOpenQuotesBrowser}
                title="Browse, filter, and flag quotes in the database"
              >
                📚 Quote Browser
              </button>
            )}
            {onNewTest && (
              <button
                type="button"
                className="btn-main-action btn-new-test"
                onClick={onNewTest}
                title="Create a new practice test"
              >
                + New Test
              </button>
            )}
          </div>
        )}
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
            const { memberUids, teamName, isCollaborative } = resolveUserCohort(
              test,
              currentUid
            );
            const resolvedAttempt = resolveAttemptForTest(test, currentUid, attempts);

            const isTimeRemaining = resolvedAttempt?.startedAt
              ? now < resolvedAttempt.startedAt + test.timeLimitSeconds * 1000
              : true;
            const isCompleted =
              resolvedAttempt?.status === 'submitted' ||
              resolvedAttempt?.status === 'expired';
            const isInProgress =
              resolvedAttempt?.status === 'in_progress' && isTimeRemaining;
            const readyCount = resolvedAttempt?.readyUids?.length ?? 0;
            const isLobbyWaiting =
              !isCompleted &&
              !isInProgress &&
              resolvedAttempt?.status === 'lobby' &&
              readyCount > 0;
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
                  isInProgress || isLobbyWaiting ? 'row-in-progress' : ''
                } ${!test.active ? 'row-inactive-draft' : ''}`}
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
                {/* Top Row: Title + Teacher Config + Status Badge */}
                <div className="test-row-top">
                  <div className="test-row-title-wrap">
                    <h3 className="test-row-title">{test.title}</h3>
                    {!test.active && (
                      <span className="test-row-draft-badge">🔒 Inactive</span>
                    )}
                  </div>

                  <div className="test-row-top-right">
                    {isTeacher && onEditTest && (
                      <button
                        type="button"
                        className="btn-simple btn-configure-test"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditTest(test.testId);
                        }}
                        title="Edit test questions, visibility, and student teams"
                      >
                        ✏️ Edit
                      </button>
                    )}

                    {isCompleted && results ? (
                      <span className="test-row-score-badge">
                        🏆 {results.totalScore} / {results.maxPossibleScore} pts (
                        {scorePercentage}%)
                      </span>
                    ) : isInProgress ? (
                      <span className="test-row-status-pill pill-in-progress">
                        ⏱️ In Progress
                      </span>
                    ) : isLobbyWaiting ? (
                      <span className="test-row-status-pill pill-in-progress">
                        ⏳ {readyCount}/{memberUids.length} Ready
                      </span>
                    ) : (
                      <span className="test-row-status-pill pill-available">
                        Available
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom Row: Metadata Chips + CTA text */}
                <div className="test-row-bottom">
                  <div className="test-row-meta">
                    <span className="test-card-meta-item">⏱️ {minutes} Mins</span>
                    <span className="test-card-meta-item">
                      🧩 {test.questions.length} Questions
                    </span>
                    <span className="test-card-meta-item">⭐ {totalPoints} Pts</span>
                    {isCollaborative && (
                      <span className="test-card-meta-item meta-team-chip">
                        👥 {teamName ? `${teamName}: ` : ''}
                        {getDisplayNamesForUids(memberUids)}
                      </span>
                    )}
                  </div>

                  <div className="test-row-action-indicator">
                    {isCompleted ? (
                      <span className="action-text action-results">View Results ➔</span>
                    ) : isInProgress ? (
                      <span className="action-text action-resume">
                        {isCollaborative ? 'Rejoin Test ➔' : 'Resume Test ➔'}
                      </span>
                    ) : isLobbyWaiting ? (
                      <span className="action-text action-resume">
                        Join Team ({readyCount}/{memberUids.length}) ➔
                      </span>
                    ) : isCollaborative ? (
                      <span className="action-text action-start">Join Team ➔</span>
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
