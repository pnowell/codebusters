import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MemberPresence,
  QuestionWorkspace,
  TestAttempt,
  TestEvaluationResult,
  TestPacket,
} from '../../types';
import { getQuoteById } from '../../data/quotes';
import { formatClock } from '../../utils/format';
import { getQuestionProgress } from '../../utils/testProgress';
import {
  applyPendingCellOps,
  deserializeWorkspacesFromFirestore,
  diffQuestionInputs,
  getActiveTeammateUidsForTab,
  PRESENCE_STALE_MS,
  resolveUserCohort,
  type PendingCellOp,
} from '../../utils/testSync';
import {
  getDisplayNameForUid,
  getDisplayNamesForUids,
  getShortDisplayNameForUid,
  subscribeTeamProfiles,
} from '../../services/profileService';
import {
  expireTestAttemptTransaction,
  flushWorkspaceCellOps,
  saveLocalTestAttempt,
  setEarlySubmitReadyState,
  subscribeTestAttemptById,
  updateMemberPresence,
} from '../../services/testService';
import { Modal } from '../common/Modal';
import { TestCipherWorkspace } from './TestCipherWorkspace';
import { TestReviewScreen } from './TestReviewScreen';
import { TestResultsView } from './TestResultsView';

interface TestRunnerProps {
  testPacket: TestPacket;
  currentUid: string;
  initialAttempt?: TestAttempt | null;
  onExitToMenu: () => void;
}

const CELL_FLUSH_DEBOUNCE_MS = 150;
const PRESENCE_HEARTBEAT_MS = 30_000;

export const TestRunner: React.FC<TestRunnerProps> = ({
  testPacket,
  currentUid,
  initialAttempt,
  onExitToMenu,
}) => {
  const cohortInfo = useMemo(
    () => resolveUserCohort(testPacket, currentUid),
    [testPacket, currentUid]
  );

  const attemptId = initialAttempt?.attemptId || cohortInfo.attemptId;
  const memberUids = useMemo(() => {
    if (initialAttempt?.studentUids && initialAttempt.studentUids.length > 0) {
      return initialAttempt.studentUids;
    }
    return cohortInfo.memberUids;
  }, [initialAttempt?.studentUids, cohortInfo.memberUids]);

  const teamName = initialAttempt?.teamName ?? cohortInfo.teamName;
  const isCollaborative = memberUids.length > 1;

  const totalQuestions = testPacket.questions.length;
  const reviewIndex = totalQuestions;

  const [startedAt, setStartedAt] = useState<number>(() => {
    if (initialAttempt?.startedAt && initialAttempt.startedAt > 0) {
      return initialAttempt.startedAt;
    }
    return Date.now();
  });

  const [activeQIndex, setActiveQIndex] = useState<number>(0);

  const [workspaces, setWorkspaces] = useState<Record<number, QuestionWorkspace>>(() =>
    deserializeWorkspacesFromFirestore(
      initialAttempt?.workspaces,
      testPacket.questions,
      getQuoteById
    )
  );

  const [presence, setPresence] = useState<Record<string, MemberPresence> | undefined>(
    () => initialAttempt?.presence
  );
  const [submitReadyUids, setSubmitReadyUids] = useState<string[]>(
    () => initialAttempt?.submitReadyUids ?? []
  );
  const [presenceNow, setPresenceNow] = useState<number>(() => Date.now());
  const [, setProfilesTick] = useState<number>(0);

  const [isFinished, setIsFinished] = useState<boolean>(() => {
    return (
      initialAttempt?.status === 'submitted' || initialAttempt?.status === 'expired'
    );
  });
  const [finalStatus, setFinalStatus] = useState<'submitted' | 'expired'>(() =>
    initialAttempt?.status === 'expired' ? 'expired' : 'submitted'
  );
  const [results, setResults] = useState<TestEvaluationResult | null>(() => {
    return initialAttempt?.results ?? null;
  });

  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [isSubmittingVote, setIsSubmittingVote] = useState<boolean>(false);

  const opSeqRef = useRef<number>(0);
  const pendingCellOpsRef = useRef<Map<string, PendingCellOp>>(new Map());
  const pendingMetaRef = useRef<
    Record<number, { completed: boolean; lastEditedAt: number; lastEditedBy?: string }>
  >({});
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightFlushRef = useRef<Promise<void> | null>(null);
  const hasTriggeredExpireRef = useRef<boolean>(false);

  const endTime = useMemo(
    () => startedAt + testPacket.timeLimitSeconds * 1000,
    [startedAt, testPacket.timeLimitSeconds]
  );

  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    Math.max(0, Math.round((endTime - Date.now()) / 1000))
  );

  const incompleteCount = useMemo(
    () =>
      testPacket.questions.filter(
        (q, idx) => !getQuestionProgress(q, workspaces[idx]).isComplete
      ).length,
    [testPacket.questions, workspaces]
  );

  const attemptRef = useRef<TestAttempt>({
    attemptId,
    testId: testPacket.testId,
    teamName,
    studentUids: memberUids,
    submitReadyUids,
    presence,
    startedAt,
    status: isFinished ? finalStatus : 'in_progress',
    workspaces,
    results: results ?? undefined,
  });

  useEffect(() => {
    attemptRef.current = {
      attemptId,
      testId: testPacket.testId,
      teamName,
      studentUids: memberUids,
      submitReadyUids,
      presence,
      startedAt,
      status: isFinished ? finalStatus : 'in_progress',
      workspaces,
      results: results ?? undefined,
    };
  }, [
    attemptId,
    testPacket.testId,
    teamName,
    memberUids,
    submitReadyUids,
    presence,
    startedAt,
    isFinished,
    finalStatus,
    workspaces,
    results,
  ]);

  const flushPendingEdits = useCallback(async (): Promise<void> => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    if (inFlightFlushRef.current) {
      await inFlightFlushRef.current;
    }

    if (pendingCellOpsRef.current.size === 0) return;

    const snapshotOps = Array.from(pendingCellOpsRef.current.values());
    const snapshotMeta = { ...pendingMetaRef.current };

    const run = (async () => {
      if (currentUid === 'student') {
        for (const op of snapshotOps) {
          const cur = pendingCellOpsRef.current.get(`${op.qIdx}:${op.charIdx}`);
          if (cur && cur.seq <= op.seq) {
            pendingCellOpsRef.current.delete(`${op.qIdx}:${op.charIdx}`);
          }
        }
        saveLocalTestAttempt(attemptRef.current);
        return;
      }

      const ok = await flushWorkspaceCellOps(attemptId, snapshotOps, snapshotMeta);
      if (ok) {
        for (const op of snapshotOps) {
          const cur = pendingCellOpsRef.current.get(`${op.qIdx}:${op.charIdx}`);
          if (cur && cur.seq <= op.seq) {
            pendingCellOpsRef.current.delete(`${op.qIdx}:${op.charIdx}`);
          }
        }
      }
    })();

    inFlightFlushRef.current = run;
    try {
      await run;
    } finally {
      if (inFlightFlushRef.current === run) {
        inFlightFlushRef.current = null;
      }
    }
  }, [attemptId, currentUid]);

  // Subscribe to live Firestore updates for this attempt & team profile names
  useEffect(() => {
    const unsubProfiles = subscribeTeamProfiles(() => {
      setProfilesTick((v) => v + 1);
    });

    const staleTimer = setInterval(() => {
      setPresenceNow(Date.now());
    }, 5000);

    if (currentUid === 'student') {
      return () => {
        unsubProfiles();
        clearInterval(staleTimer);
      };
    }

    let seenInitialDoc = Boolean(initialAttempt);
    const unsubAttempt = subscribeTestAttemptById(
      attemptId,
      (remoteAttempt) => {
        if (!remoteAttempt) {
          if (seenInitialDoc) {
            // Teacher reset/deleted the attempt while active
            onExitToMenu();
          }
          return;
        }
        seenInitialDoc = true;

        if (remoteAttempt.startedAt > 0) {
          setStartedAt(remoteAttempt.startedAt);
        }
        setPresence(remoteAttempt.presence);
        setPresenceNow(Date.now());
        setSubmitReadyUids(remoteAttempt.submitReadyUids ?? []);

        const mergedWorkspaces = applyPendingCellOps(
          remoteAttempt.workspaces,
          pendingCellOpsRef.current.values(),
          testPacket.questions,
          getQuoteById
        );
        setWorkspaces(mergedWorkspaces);

        if (
          (remoteAttempt.status === 'submitted' ||
            remoteAttempt.status === 'expired') &&
          remoteAttempt.results
        ) {
          setResults(remoteAttempt.results);
          setFinalStatus(remoteAttempt.status);
          setIsFinished(true);
          setShowSubmitModal(false);
        }
      },
      {
        questions: testPacket.questions,
        getQuote: getQuoteById,
      }
    );

    return () => {
      unsubProfiles();
      clearInterval(staleTimer);
      unsubAttempt();
    };
  }, [attemptId, currentUid, initialAttempt, onExitToMenu, testPacket.questions]);

  // Broadcast active tab presence & periodic keepalive while solving
  useEffect(() => {
    if (isFinished || currentUid === 'student') return;

    void updateMemberPresence(attemptId, currentUid, activeQIndex);
    const heartbeat = setInterval(() => {
      void updateMemberPresence(attemptId, currentUid, activeQIndex);
    }, PRESENCE_HEARTBEAT_MS);

    return () => {
      clearInterval(heartbeat);
    };
  }, [activeQIndex, attemptId, currentUid, isFinished]);

  // Flush pending edits & clear presence on unmount
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (attemptRef.current.status === 'in_progress') {
        void flushPendingEdits();
        void updateMemberPresence(attemptId, currentUid, -1);
      }
    };
  }, [attemptId, currentUid, flushPendingEdits]);

  const triggerExpire = useCallback(async () => {
    if (isFinished || hasTriggeredExpireRef.current) return;
    hasTriggeredExpireRef.current = true;

    await flushPendingEdits();
    const expired = await expireTestAttemptTransaction(
      testPacket,
      attemptId,
      currentUid,
      getQuoteById,
      attemptRef.current
    );
    if (expired && expired.results) {
      setResults(expired.results);
      setFinalStatus(expired.status === 'submitted' ? 'submitted' : 'expired');
      setIsFinished(true);
      setShowSubmitModal(false);
    }
  }, [attemptId, currentUid, flushPendingEdits, isFinished, testPacket]);

  // Wall-clock Countdown Timer
  useEffect(() => {
    if (isFinished) return;

    const timer = setInterval(() => {
      const left = Math.max(0, Math.round((endTime - Date.now()) / 1000));
      setRemainingSeconds((prev) => (prev === left ? prev : left));

      if (left <= 0) {
        clearInterval(timer);
        void triggerExpire();
      }
    }, 250);

    return () => clearInterval(timer);
  }, [endTime, isFinished, triggerExpire]);

  const handleUserInputsChange = (newInputs: string[]) => {
    if (isFinished) return;
    const prevInputs = workspaces[activeQIndex]?.userInputs ?? [];
    const diffs = diffQuestionInputs(prevInputs, newInputs);
    if (diffs.length === 0) return;

    const now = Date.now();
    const { isComplete } = getQuestionProgress(
      testPacket.questions[activeQIndex],
      newInputs
    );

    for (const diff of diffs) {
      opSeqRef.current += 1;
      pendingCellOpsRef.current.set(`${activeQIndex}:${diff.charIdx}`, {
        qIdx: activeQIndex,
        charIdx: diff.charIdx,
        value: diff.value,
        seq: opSeqRef.current,
        editedAt: now,
        editedBy: currentUid !== 'student' ? currentUid : undefined,
      });
    }

    pendingMetaRef.current[activeQIndex] = {
      completed: isComplete,
      lastEditedAt: now,
      ...(currentUid !== 'student' ? { lastEditedBy: currentUid } : {}),
    };

    const nextWorkspaces: Record<number, QuestionWorkspace> = {
      ...workspaces,
      [activeQIndex]: {
        userInputs: newInputs,
        completed: isComplete,
        lastEditedAt: now,
        ...(currentUid !== 'student' ? { lastEditedBy: currentUid } : {}),
      },
    };

    setWorkspaces(nextWorkspaces);

    if (currentUid === 'student') {
      saveLocalTestAttempt({
        ...attemptRef.current,
        workspaces: nextWorkspaces,
      });
    }

    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = setTimeout(() => {
      void flushPendingEdits();
    }, CELL_FLUSH_DEBOUNCE_MS);
  };

  const switchTab = (nextIndex: number) => {
    if (nextIndex === activeQIndex) return;
    if (pendingCellOpsRef.current.size > 0) {
      void flushPendingEdits();
    }
    setActiveQIndex(nextIndex);
  };

  const handlePrev = () => {
    if (activeQIndex > 0) {
      switchTab(activeQIndex - 1);
    }
  };

  const handleNext = () => {
    if (activeQIndex < reviewIndex) {
      switchTab(activeQIndex + 1);
    }
  };

  const handleOpenSubmitModal = () => {
    if (pendingCellOpsRef.current.size > 0) {
      void flushPendingEdits();
    }
    setShowSubmitModal(true);
  };

  const isCurrentUserSubmitReady = submitReadyUids.includes(currentUid);

  const handleKeepSolving = () => {
    setShowSubmitModal(false);
    if (isCollaborative && isCurrentUserSubmitReady && !isFinished) {
      void setEarlySubmitReadyState(
        testPacket,
        attemptId,
        currentUid,
        false,
        getQuoteById,
        attemptRef.current
      );
    }
  };

  const handleConfirmOrToggleSubmit = async () => {
    if (isSubmittingVote || isFinished) return;
    setIsSubmittingVote(true);

    try {
      await flushPendingEdits();
      const targetReady = isCollaborative ? !isCurrentUserSubmitReady : true;
      const updated = await setEarlySubmitReadyState(
        testPacket,
        attemptId,
        currentUid,
        targetReady,
        getQuoteById,
        attemptRef.current
      );

      if (updated) {
        setSubmitReadyUids(updated.submitReadyUids ?? []);
        if (
          (updated.status === 'submitted' || updated.status === 'expired') &&
          updated.results
        ) {
          setResults(updated.results);
          setFinalStatus(updated.status);
          setIsFinished(true);
          setShowSubmitModal(false);
        }
      }
    } finally {
      setIsSubmittingVote(false);
    }
  };

  const handleExit = async () => {
    if (!isFinished) {
      await flushPendingEdits();
      void updateMemberPresence(attemptId, currentUid, -1);
    }
    onExitToMenu();
  };

  const currentQuestion = testPacket.questions[activeQIndex];
  const currentQuote = currentQuestion
    ? getQuoteById(currentQuestion.quoteId)
    : undefined;
  const currentWorkspace = workspaces[activeQIndex];

  const isTimeCritical = remainingSeconds <= 60;
  const isTimeWarning = remainingSeconds <= 300 && !isTimeCritical;

  const otherSubmitReadyUids = useMemo(
    () =>
      memberUids.filter(
        (uid) => uid !== currentUid && submitReadyUids.includes(uid)
      ),
    [memberUids, currentUid, submitReadyUids]
  );

  const submitReadyCount = useMemo(
    () => memberUids.filter((uid) => submitReadyUids.includes(uid)).length,
    [memberUids, submitReadyUids]
  );

  const formatTeammateLocation = (uid: string): string | null => {
    const entry = presence?.[uid];
    if (!entry || presenceNow - entry.updatedAt > PRESENCE_STALE_MS) return null;
    if (entry.activeQIndex < 0) return null;
    if (entry.activeQIndex === reviewIndex) return 'on Review';
    return `viewing Q${entry.activeQIndex + 1}`;
  };

  if (isFinished && results) {
    return (
      <TestResultsView
        testPacket={testPacket}
        results={results}
        studentUids={memberUids}
        teamName={teamName}
        onBack={onExitToMenu}
      />
    );
  }

  return (
    <div className="test-runner-container">
      {/* 1. Header Navigation Bar */}
      <header className="test-runner-header">
        <div className="test-header-left">
          <button
            className="btn-simple btn-test-exit"
            onClick={() => void handleExit()}
            title="Pause and Exit to Practice Tests"
          >
            ← Tests
          </button>
          <button
            className="btn-simple btn-nav-step"
            onClick={handlePrev}
            disabled={activeQIndex === 0}
            title="Previous Problem"
          >
            ← Prev
          </button>
        </div>

        <div className="test-header-center">
          <div className="test-header-meta">
            {activeQIndex < totalQuestions ? (
              <>
                <span className="test-q-counter">
                  Problem {activeQIndex + 1} of {totalQuestions}
                </span>
                <span className="test-q-pts">[{currentQuestion?.points} pts]</span>
                {currentQuestion?.isTiebreaker && (
                  <span className="test-tb-badge">★ TIEBREAKER</span>
                )}
              </>
            ) : (
              <span className="test-q-counter">Review & Submit</span>
            )}
          </div>

          <div
            className={`test-countdown-clock ${isTimeCritical ? 'clock-critical' : ''} ${
              isTimeWarning ? 'clock-warning' : ''
            }`}
          >
            ⏱️ {formatClock(remainingSeconds)}
          </div>
        </div>

        <div className="test-header-right">
          {activeQIndex < totalQuestions - 1 ? (
            <button
              className="btn-simple btn-nav-step"
              onClick={handleNext}
              title="Next Problem"
            >
              Next →
            </button>
          ) : activeQIndex === totalQuestions - 1 ? (
            <button
              className="btn-simple btn-nav-step btn-review-cta"
              onClick={handleNext}
            >
              Review 📋
            </button>
          ) : (
            <button
              className="btn-simple btn-nav-step btn-submit-cta"
              onClick={handleOpenSubmitModal}
            >
              Submit ✓
            </button>
          )}
        </div>
      </header>

      {/* 2. Question Navigator Strip with Teammate Presence */}
      <nav className="test-navigator-strip" aria-label="Question Navigation">
        {testPacket.questions.map((q, idx) => {
          const { status } = getQuestionProgress(q, workspaces[idx]);
          const isComplete = status === 'complete';
          const isInProgress = status === 'in_progress';
          const isActive = activeQIndex === idx;
          const viewers = isCollaborative
            ? getActiveTeammateUidsForTab(
                presence,
                memberUids,
                currentUid,
                idx,
                presenceNow
              )
            : [];

          return (
            <button
              key={q.questionNumber}
              className={`test-nav-tab ${isActive ? 'tab-active' : ''} ${
                isComplete
                  ? 'tab-complete'
                  : isInProgress
                    ? 'tab-progress'
                    : 'tab-untouched'
              }`}
              onClick={() => switchTab(idx)}
              title={
                viewers.length > 0
                  ? `Question ${q.questionNumber}: ${q.cipher} (${getDisplayNamesForUids(viewers)} viewing)`
                  : `Question ${q.questionNumber}: ${q.cipher}`
              }
            >
              <span className="tab-q-label">Q{q.questionNumber}</span>
              {isComplete && <span className="tab-status-icon">✓</span>}
              {isInProgress && <span className="tab-status-icon">✎</span>}
              {viewers.map((uid) => {
                const shortName = getShortDisplayNameForUid(uid);
                return (
                  <span key={uid} className="tab-presence-chip">
                    {shortName}
                  </span>
                );
              })}
            </button>
          );
        })}

        {(() => {
          const reviewViewers = isCollaborative
            ? getActiveTeammateUidsForTab(
                presence,
                memberUids,
                currentUid,
                reviewIndex,
                presenceNow
              )
            : [];
          return (
            <button
              className={`test-nav-tab tab-review ${
                activeQIndex === reviewIndex ? 'tab-active' : ''
              }`}
              onClick={() => switchTab(reviewIndex)}
              title="Review and Submit Test"
            >
              <span className="tab-q-label">Review 📋</span>
              {reviewViewers.map((uid) => {
                const shortName = getShortDisplayNameForUid(uid);
                return (
                  <span key={uid} className="tab-presence-chip">
                    {shortName}
                  </span>
                );
              })}
            </button>
          );
        })()}
      </nav>

      {/* 2b. Non-blocking Teammate Submit-Ready Banner */}
      {isCollaborative && otherSubmitReadyUids.length > 0 && (
        <div className="teammate-submit-banner" role="status">
          <span>
            ✅ <strong>{getDisplayNamesForUids(otherSubmitReadyUids)}</strong>{' '}
            {otherSubmitReadyUids.length === 1 ? 'is' : 'are'} ready to submit (
            {submitReadyCount}/{memberUids.length})
          </span>
          <button
            type="button"
            className="btn-simple btn-banner-submit"
            onClick={handleOpenSubmitModal}
          >
            Review & Confirm ✓
          </button>
        </div>
      )}

      {/* 3. Main Workspace Area */}
      <main className="test-runner-body">
        {activeQIndex < totalQuestions &&
          currentQuestion &&
          currentQuote &&
          currentWorkspace && (
            <TestCipherWorkspace
              key={currentQuestion.questionNumber}
              question={currentQuestion}
              quote={currentQuote}
              userInputs={currentWorkspace.userInputs}
              onChangeUserInputs={handleUserInputsChange}
              disabled={isFinished}
            />
          )}

        {activeQIndex === reviewIndex && (
          <TestReviewScreen
            testPacket={testPacket}
            workspaces={workspaces}
            onJumpToQuestion={(idx) => switchTab(idx)}
            onSubmitTest={handleOpenSubmitModal}
          />
        )}
      </main>

      {/* 4. Submit Confirmation Modal */}
      <Modal
        isOpen={showSubmitModal}
        onClose={handleKeepSolving}
        ariaLabelledBy="confirm-submit-title"
        backdropClassName="confirm-modal-backdrop"
        dialogClassName="confirm-modal"
      >
        <h3 id="confirm-submit-title" className="confirm-modal-title">
          {isCollaborative ? 'Submit Team Test?' : 'Submit Practice Test?'}
        </h3>
        {incompleteCount > 0 ? (
          <>
            <p className="confirm-modal-text">
              You have <strong>{formatClock(remainingSeconds)}</strong> remaining on the
              clock and{' '}
              <strong>
                {incompleteCount} problem{incompleteCount > 1 ? 's' : ''}
              </strong>{' '}
              incomplete or not started.
            </p>
            <div className="confirm-modal-warning">
              ⚠️ Unanswered letters are counted as errors under Science Olympiad rules.
            </div>
          </>
        ) : (
          <p className="confirm-modal-text">
            {isCollaborative ? 'Your team has' : 'You have'} completed all{' '}
            <strong>{totalQuestions} problems</strong> with{' '}
            <strong>{formatClock(remainingSeconds)}</strong> remaining on the clock!
          </p>
        )}

        {isCollaborative ? (
          <div className="team-rollcall-card">
            <div className="team-rollcall-header">
              <span className="team-rollcall-title">
                👥 Team Confirmation
              </span>
              <span className="team-rollcall-count">
                {submitReadyCount} / {memberUids.length} Confirmed
              </span>
            </div>

            <div className="team-rollcall-list">
              {memberUids.map((uid) => {
                const confirmed = submitReadyUids.includes(uid);
                const name = getDisplayNameForUid(uid);
                const loc = !confirmed ? formatTeammateLocation(uid) : null;
                return (
                  <div
                    key={uid}
                    className={`team-rollcall-row ${
                      confirmed ? 'rollcall-ready' : 'rollcall-waiting'
                    }`}
                  >
                    <span className="rollcall-check" aria-hidden="true">
                      {confirmed ? '✓' : '○'}
                    </span>
                    <span className="rollcall-name">
                      {name}
                      {uid === currentUid ? ' (You)' : ''}
                    </span>
                    <span className="rollcall-state">
                      {confirmed ? 'Ready' : loc || 'Working...'}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="team-rollcall-note">
              Early submission scores your test once every teammate confirms.
            </p>
          </div>
        ) : (
          <p className="confirm-modal-text-sub">
            Are you sure you want to finish now and score your test?
          </p>
        )}

        <div className="confirm-modal-buttons">
          <button
            type="button"
            className="btn-simple"
            onClick={handleKeepSolving}
          >
            Keep Solving ➔
          </button>
          {isCollaborative ? (
            <button
              type="button"
              className={
                isCurrentUserSubmitReady
                  ? 'btn-simple btn-ready-waiting'
                  : 'btn-main-action btn-submit-confirm'
              }
              onClick={() => void handleConfirmOrToggleSubmit()}
              disabled={isSubmittingVote}
            >
              {isCurrentUserSubmitReady
                ? `✓ Confirmed (${submitReadyCount}/${memberUids.length}) — Undo`
                : 'Ready to Submit ✓'}
            </button>
          ) : (
            <button
              type="button"
              className="btn-main-action btn-submit-confirm"
              onClick={() => void handleConfirmOrToggleSubmit()}
              disabled={isSubmittingVote}
            >
              Submit Score Now ✓
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
};
