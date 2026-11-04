import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TestAttempt, TestPacket } from '../../types';
import { formatClock } from '../../utils/format';
import {
  getDisplayNameForUid,
  subscribeTeamProfiles,
} from '../../services/profileService';
import {
  setLobbyReadyState,
  subscribeTestAttemptById,
} from '../../services/testService';
import { resolveUserCohort } from '../../utils/testSync';
import { Modal } from '../common/Modal';

interface TestBriefingModalProps {
  testPacket: TestPacket;
  currentUid: string;
  existingAttempt: TestAttempt | null;
  onLaunchAttempt: (attempt: TestAttempt) => void;
  onViewResults?: (attempt: TestAttempt) => void;
  onClose: () => void;
}

export const TestBriefingModal: React.FC<TestBriefingModalProps> = ({
  testPacket,
  currentUid,
  existingAttempt,
  onLaunchAttempt,
  onViewResults,
  onClose,
}) => {
  const { memberUids, attemptId, teamName, isCollaborative } = useMemo(
    () => resolveUserCohort(testPacket, currentUid),
    [testPacket, currentUid]
  );

  const [wasInProgressOnOpen] = useState<boolean>(
    () => existingAttempt?.status === 'in_progress'
  );
  const [liveAttempt, setLiveAttempt] = useState<TestAttempt | null>(existingAttempt);
  const [now, setNow] = useState<number>(() => Date.now());
  const [, setProfilesTick] = useState<number>(0);
  const [isUpdatingReady, setIsUpdatingReady] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hasLaunchedRef = useRef<boolean>(false);
  const isLobbyReadyRef = useRef<boolean>(false);

  useEffect(() => {
    const clockInterval = setInterval(() => setNow(Date.now()), 1000);
    const unsubProfiles = subscribeTeamProfiles(() => {
      setProfilesTick((v) => v + 1);
    });
    const unsubAttempt = subscribeTestAttemptById(attemptId, (attempt) => {
      setLiveAttempt(attempt);
    });

    return () => {
      clearInterval(clockInterval);
      unsubProfiles();
      unsubAttempt();
    };
  }, [attemptId]);

  const readyUids = liveAttempt?.readyUids ?? [];
  const isCurrentUserReady =
    liveAttempt?.status === 'lobby' && readyUids.includes(currentUid);

  useEffect(() => {
    isLobbyReadyRef.current = isCurrentUserReady;
  }, [isCurrentUserReady]);

  // Auto-launch into TestRunner as soon as a lobby reaches unanimous 'in_progress'
  useEffect(() => {
    if (hasLaunchedRef.current) return;
    if (!liveAttempt) return;

    if (
      (liveAttempt.status === 'submitted' || liveAttempt.status === 'expired') &&
      liveAttempt.results &&
      onViewResults
    ) {
      hasLaunchedRef.current = true;
      onViewResults(liveAttempt);
      return;
    }

    if (liveAttempt.status === 'in_progress' && !wasInProgressOnOpen) {
      hasLaunchedRef.current = true;
      onLaunchAttempt(liveAttempt);
    }
  }, [liveAttempt, onLaunchAttempt, onViewResults, wasInProgressOnOpen]);

  const totalPoints = testPacket.questions.reduce((sum, q) => sum + q.points, 0);
  const minutes = Math.round(testPacket.timeLimitSeconds / 60);

  const isResumable = Boolean(
    liveAttempt &&
      liveAttempt.status === 'in_progress' &&
      now < liveAttempt.startedAt + testPacket.timeLimitSeconds * 1000
  );

  const remainingSeconds =
    isResumable && liveAttempt
      ? Math.max(
          0,
          Math.round(
            (liveAttempt.startedAt + testPacket.timeLimitSeconds * 1000 - now) / 1000
          )
        )
      : 0;

  const handleCancelClose = () => {
    if (isLobbyReadyRef.current && !hasLaunchedRef.current) {
      isLobbyReadyRef.current = false;
      void setLobbyReadyState(testPacket, currentUid, false);
    }
    onClose();
  };

  const handleToggleReadyOrStart = async () => {
    if (isUpdatingReady || hasLaunchedRef.current) return;
    setErrorMsg(null);
    setIsUpdatingReady(true);

    try {
      const targetReady = !isCurrentUserReady;
      const updated = await setLobbyReadyState(testPacket, currentUid, targetReady);
      if (updated && updated.status === 'in_progress' && !hasLaunchedRef.current) {
        hasLaunchedRef.current = true;
        onLaunchAttempt(updated);
      }
    } catch (err) {
      console.warn('[TestBriefingModal] Failed to update ready state:', err);
      setErrorMsg('Could not join test session. Check your connection and try again.');
    } finally {
      setIsUpdatingReady(false);
    }
  };

  const handleRejoin = () => {
    if (!liveAttempt || hasLaunchedRef.current) return;
    hasLaunchedRef.current = true;
    onLaunchAttempt(liveAttempt);
  };

  const readyCount = memberUids.filter((uid) => readyUids.includes(uid)).length;

  return (
    <Modal
      isOpen={true}
      onClose={handleCancelClose}
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
              <strong>Free Navigation:</strong> Jump back and forth between questions at any time. {isCollaborative ? 'Teammate edits sync live!' : 'Your work saves automatically.'}
            </li>
          </ul>
        </div>

        {/* Collaborative Team Join Roll Call */}
        {isCollaborative && !isResumable && (
          <div className="team-rollcall-card">
            <div className="team-rollcall-header">
              <span className="team-rollcall-title">
                👥 {teamName || 'Your Team'}
              </span>
              <span className="team-rollcall-count">
                {readyCount} / {memberUids.length} Ready
              </span>
            </div>

            <div className="team-rollcall-list">
              {memberUids.map((uid) => {
                const isMemberReady = readyUids.includes(uid);
                const name = getDisplayNameForUid(uid);
                return (
                  <div
                    key={uid}
                    className={`team-rollcall-row ${
                      isMemberReady ? 'rollcall-ready' : 'rollcall-waiting'
                    }`}
                  >
                    <span className="rollcall-check" aria-hidden="true">
                      {isMemberReady ? '✓' : '○'}
                    </span>
                    <span className="rollcall-name">
                      {name}
                      {uid === currentUid ? ' (You)' : ''}
                    </span>
                    <span className="rollcall-state">
                      {isMemberReady ? 'Ready' : 'Waiting...'}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="team-rollcall-note">
              Timer starts automatically once everyone on your team clicks Ready.
            </p>
          </div>
        )}

        {isResumable && (
          <div className="briefing-resume-banner">
            ℹ️ {isCollaborative ? 'Your team session is in progress' : 'You have an in-progress session'} with{' '}
            <strong>{formatClock(remainingSeconds)}</strong> left on the clock.
          </div>
        )}

        {errorMsg && <div className="cohort-error-banner">⚠️ {errorMsg}</div>}
      </div>

      <div className="briefing-actions">
        <button type="button" className="btn-simple" onClick={handleCancelClose}>
          Cancel
        </button>
        {isResumable ? (
          <button type="button" className="btn-main-action btn-resume" onClick={handleRejoin}>
            {isCollaborative ? 'Rejoin Test' : 'Resume Test'} ({formatClock(remainingSeconds)}) ➔
          </button>
        ) : isCollaborative ? (
          <button
            type="button"
            className={
              isCurrentUserReady
                ? 'btn-simple btn-ready-waiting'
                : 'btn-main-action btn-begin'
            }
            onClick={() => void handleToggleReadyOrStart()}
            disabled={isUpdatingReady}
          >
            {isCurrentUserReady
              ? `✓ Ready (${readyCount}/${memberUids.length}) — Undo`
              : "I'm Ready to Start ✓"}
          </button>
        ) : (
          <button
            type="button"
            className="btn-main-action btn-begin"
            onClick={() => void handleToggleReadyOrStart()}
            disabled={isUpdatingReady}
          >
            {isUpdatingReady ? 'Starting...' : 'Begin Practice Test ➔'}
          </button>
        )}
      </div>
    </Modal>
  );
};
