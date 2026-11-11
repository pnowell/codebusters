import React, { useState, useEffect, useMemo } from 'react';
import {
  isCipherEnabledForStudent,
  type CipherType,
} from '../../data/drills';
import type {
  DrillId,
  GeneralPracticeCiphers,
  OffsetsMode,
  PublicProfile,
} from '../../types';
import { loadDrillScore } from '../../services/storage';
import { computeLeaderboardEntries } from '../../services/leaderboard';
import { subscribeTeamProfiles } from '../../services/profileService';
import {
  getGeneralPracticeCiphers,
  subscribeCachedClassroomCiphers,
} from '../../services/classroomConfigService';
import { useAuth } from '../../context/useAuth';
import { Modal } from '../common/Modal';

export type LeaderboardBoardId = DrillId;

interface LeaderboardTabConfig {
  id: LeaderboardBoardId;
  label: string;
  cipherId: CipherType;
}

const LEADERBOARD_TAB_ROWS: readonly (readonly LeaderboardTabConfig[])[] = [
  [
    { id: 'offsetsLetterToNum', label: 'ABC → #', cipherId: 'offsets' },
    { id: 'offsetsNumToLetter', label: '# → ABC', cipherId: 'offsets' },
  ],
  [
    { id: 'letterMathEasy', label: 'ABC ± # (Easy)', cipherId: 'letterMath' },
    { id: 'letterMathHard', label: 'ABC ± # (Hard)', cipherId: 'letterMath' },
  ],
  [
    { id: 'atbash', label: 'Atbash', cipherId: 'atbash' },
    { id: 'pigpen', label: 'Pigpen', cipherId: 'pigpen' },
    { id: 'galactic', label: 'Galactic', cipherId: 'galactic' },
  ],
  [
    { id: 'tap', label: 'Tap Code', cipherId: 'tap' },
    { id: 'knights', label: 'Knights Templar', cipherId: 'knights' },
  ],
];

function resolveBoardId(drillOrMode?: DrillId | OffsetsMode): LeaderboardBoardId {
  if (drillOrMode === 'numToLetter' || drillOrMode === 'offsetsNumToLetter') {
    return 'offsetsNumToLetter';
  }
  if (drillOrMode === 'letterToNum' || drillOrMode === 'offsetsLetterToNum') {
    return 'offsetsLetterToNum';
  }
  if (
    drillOrMode === 'letterMathEasy' ||
    drillOrMode === 'letterMathHard' ||
    drillOrMode === 'atbash' ||
    drillOrMode === 'pigpen' ||
    drillOrMode === 'galactic' ||
    drillOrMode === 'tap' ||
    drillOrMode === 'knights'
  ) {
    return drillOrMode;
  }
  return 'offsetsLetterToNum';
}

interface LeaderboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDrill?: DrillId | OffsetsMode;
  initialMode?: OffsetsMode;
}

interface LeaderboardModalContentProps {
  onClose: () => void;
  initialBoard: LeaderboardBoardId;
}

const LeaderboardModalContent: React.FC<LeaderboardModalContentProps> = ({
  onClose,
  initialBoard,
}) => {
  const { user, allowedUser } = useAuth();
  const isTeacher = allowedUser?.role === 'teacher';
  const [board, setBoard] = useState<LeaderboardBoardId>(initialBoard);
  const [classroomCiphers, setClassroomCiphers] = useState<GeneralPracticeCiphers>(
    getGeneralPracticeCiphers
  );
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeCachedClassroomCiphers(setClassroomCiphers);
  }, []);

  // Subscribe once while the modal is open and derive each tab's standings via useMemo
  useEffect(() => {
    return subscribeTeamProfiles(
      (nextProfiles) => {
        setProfiles(nextProfiles);
        setError(null);
        setIsLoading(false);
      },
      () => {
        setError('Failed to load leaderboard scores.');
        setIsLoading(false);
      }
    );
  }, []);

  const visibleTabRows = useMemo(
    () =>
      LEADERBOARD_TAB_ROWS.map((row) =>
        row.filter(
          (tab) =>
            tab.cipherId === 'offsets' ||
            isTeacher ||
            isCipherEnabledForStudent(tab.cipherId, classroomCiphers)
        )
      ).filter((row) => row.length > 0),
    [classroomCiphers, isTeacher]
  );

  const visibleTabs = useMemo(() => visibleTabRows.flat(), [visibleTabRows]);

  const activeBoard: LeaderboardBoardId = visibleTabs.some((t) => t.id === board)
    ? board
    : 'offsetsLetterToNum';

  const entries = useMemo(
    () => computeLeaderboardEntries(profiles, activeBoard),
    [profiles, activeBoard]
  );

  const localScore = loadDrillScore(activeBoard);
  const userRankIndex = entries.findIndex((e) => e.uid === user?.uid);
  const userRank = userRankIndex !== -1 ? userRankIndex + 1 : null;
  const userEntry = userRankIndex !== -1 ? entries[userRankIndex] : null;

  const useAuthoritativeCloudScore = Boolean(user?.uid && !isLoading && !error);
  const displayMyScore = useAuthoritativeCloudScore
    ? (userEntry?.score ?? 0)
    : (userEntry ? userEntry.score : localScore.best60s);
  const displayMyStreak = useAuthoritativeCloudScore
    ? (userEntry?.bestStreak ?? 0)
    : (userEntry ? userEntry.bestStreak : localScore.bestStreak);

  const getRankBadge = (rank: number) => {
    if (rank === 1) return <span className="leaderboard-medal gold">🥇 1st</span>;
    if (rank === 2) return <span className="leaderboard-medal silver">🥈 2nd</span>;
    if (rank === 3) return <span className="leaderboard-medal bronze">🥉 3rd</span>;
    return <span className="leaderboard-rank-num">#{rank}</span>;
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      ariaLabelledBy="leaderboard-modal-title"
      dialogClassName="modal-dialog card-panel leaderboard-modal-dialog"
    >
      <div className="modal-header">
        <div className="leaderboard-title-group">
          <h3 id="leaderboard-modal-title">🏆 Leaderboards</h3>
        </div>
        <button className="close-btn" onClick={onClose} aria-label="Close leaderboards">
          ✕
        </button>
      </div>

      <div className="modal-body leaderboard-modal-body">
        {/* Multi-drill Switcher Tabs (Grouped Centered Rows) */}
        <div className="leaderboard-mode-tabs" role="tablist" aria-label="Select Leaderboard">
          {visibleTabRows.map((row, rowIdx) => (
            <div key={rowIdx} className="leaderboard-tab-row">
              {row.map((tab) => {
                const isHiddenFromStudents =
                  isTeacher &&
                  tab.cipherId !== 'offsets' &&
                  !isCipherEnabledForStudent(tab.cipherId, classroomCiphers);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeBoard === tab.id}
                    className={`leaderboard-tab ${activeBoard === tab.id ? 'active' : ''}`}
                    onClick={() => setBoard(tab.id)}
                    title={
                      isHiddenFromStudents
                        ? `${tab.label} (Hidden from students — enable in Settings)`
                        : undefined
                    }
                  >
                    <span>{tab.label}</span>
                    {isHiddenFromStudents && (
                      <span className="leaderboard-tab-lock" aria-hidden="true">
                        🔒
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* User's Personal Standing Card */}
        <div className="leaderboard-my-card">
          <div className="my-card-header">
            <span className="my-card-label">Your Personal Best</span>
            {userRank !== null ? (
              <span className="my-card-rank">
                Rank #{userRank} of {entries.length}
              </span>
            ) : (
              <span className="my-card-rank-unranked">Play to Rank</span>
            )}
          </div>

          <div className="my-card-stats">
            <div className="my-card-stat-pill">
              <span className="stat-label">60s Blitz</span>
              <span className="stat-val">⚡ {displayMyScore}</span>
            </div>
            <div className="my-card-stat-pill">
              <span className="stat-label">Best Streak</span>
              <span className="stat-val">🔥 {displayMyStreak}</span>
            </div>
          </div>
        </div>

        {/* Leaderboard Table / Cards */}
        <div className="leaderboard-list-container">
          {isLoading ? (
            <div className="leaderboard-loading">
              <span className="spinner-dots">•••</span>
              <p>Loading standings...</p>
            </div>
          ) : error ? (
            <div className="leaderboard-error">
              <p>{error}</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="leaderboard-empty">
              <span className="empty-icon">🎯</span>
              <p>No records on this board yet!</p>
              <small>Complete a 60-second speed run to claim 1st place.</small>
            </div>
          ) : (
            <div className="leaderboard-list">
              {entries.map((entry, index) => {
                const rank = index + 1;
                const isCurrentUser = Boolean(user && entry.uid === user.uid);

                return (
                  <div
                    key={entry.uid}
                    className={`leaderboard-row ${isCurrentUser ? 'current-user-row' : ''} ${
                      rank <= 3 ? `top-${rank}` : ''
                    }`}
                  >
                    <div className="row-left">
                      {getRankBadge(rank)}
                      <span className="student-name">
                        {entry.displayName}
                        {isCurrentUser && <span className="you-tag">YOU</span>}
                      </span>
                    </div>

                    <div className="row-right">
                      <div className="score-badge" title="60-second blitz score">
                        <span className="score-icon">⚡</span>
                        <span className="score-number">{entry.score}</span>
                      </div>
                      <div className="streak-badge" title="Best consecutive streak">
                        <span className="streak-icon">🔥</span>
                        <span className="streak-number">{entry.bestStreak}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({
  isOpen,
  onClose,
  initialDrill,
  initialMode,
}) => {
  const { isAllowed } = useAuth();
  if (!isOpen || !isAllowed) return null;

  const targetBoard = resolveBoardId(initialDrill ?? initialMode);

  return (
    <LeaderboardModalContent
      key={targetBoard}
      onClose={onClose}
      initialBoard={targetBoard}
    />
  );
};
