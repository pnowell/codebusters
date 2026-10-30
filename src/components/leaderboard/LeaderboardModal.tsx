import React, { useState, useEffect } from 'react';
import type { DrillId } from '../../types';
import type { OffsetsMode } from '../../services/storage';
import { loadDrillScore } from '../../services/storage';
import { subscribeLeaderboard, type LeaderboardEntry } from '../../services/leaderboard';
import { useAuth } from '../../context/useAuth';

export type LeaderboardBoardId =
  | 'offsetsLetterToNum'
  | 'offsetsNumToLetter'
  | 'atbash'
  | 'pigpen'
  | 'galactic';

interface LeaderboardTabConfig {
  id: LeaderboardBoardId;
  label: string;
  icon: string;
}

const LEADERBOARD_TABS: readonly LeaderboardTabConfig[] = [
  { id: 'offsetsLetterToNum', label: 'Letter → #', icon: '🔤' },
  { id: 'offsetsNumToLetter', label: '# → Letter', icon: '🔢' },
  { id: 'atbash', label: 'Atbash', icon: '🔄' },
  { id: 'pigpen', label: 'Pigpen', icon: '🔲' },
  { id: 'galactic', label: 'Galactic', icon: '🌌' },
] as const;

function resolveBoardId(drillOrMode?: DrillId | OffsetsMode): LeaderboardBoardId {
  if (drillOrMode === 'numToLetter' || drillOrMode === 'offsetsNumToLetter') return 'offsetsNumToLetter';
  if (drillOrMode === 'atbash') return 'atbash';
  if (drillOrMode === 'pigpen') return 'pigpen';
  if (drillOrMode === 'galactic') return 'galactic';
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
  const { user } = useAuth();
  const [board, setBoard] = useState<LeaderboardBoardId>(initialBoard);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const handleBoardChange = (newBoard: LeaderboardBoardId) => {
    if (newBoard === board) return;
    setIsLoading(true);
    setError(null);
    setBoard(newBoard);
  };

  // Subscribe to real-time leaderboard data for the selected drill
  useEffect(() => {
    const unsubscribe = subscribeLeaderboard(
      board,
      (newEntries) => {
        setEntries(newEntries);
        setIsLoading(false);
      },
      () => {
        setError('Failed to load leaderboard scores.');
        setIsLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [board]);

  const localScore = loadDrillScore(board);
  const userRankIndex = entries.findIndex(e => e.uid === user?.uid);
  const userRank = userRankIndex !== -1 ? userRankIndex + 1 : null;
  const userEntry = userRankIndex !== -1 ? entries[userRankIndex] : null;

  const displayMyScore = userEntry ? userEntry.score : localScore.best60s;
  const displayMyStreak = userEntry ? userEntry.bestStreak : localScore.bestStreak;

  const getRankBadge = (rank: number) => {
    if (rank === 1) return <span className="leaderboard-medal gold">🥇 1st</span>;
    if (rank === 2) return <span className="leaderboard-medal silver">🥈 2nd</span>;
    if (rank === 3) return <span className="leaderboard-medal bronze">🥉 3rd</span>;
    return <span className="leaderboard-rank-num">#{rank}</span>;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog card-panel leaderboard-modal-dialog"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="leaderboard-modal-title"
      >
        <div className="modal-header">
          <div className="leaderboard-title-group">
            <h3 id="leaderboard-modal-title">🏆 Team Leaderboards</h3>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close leaderboard">
            ✕
          </button>
        </div>

        <div className="modal-body leaderboard-modal-body">
          {/* Multi-drill Switcher Tabs */}
          <div className="leaderboard-mode-tabs" role="tablist" aria-label="Select Leaderboard">
            {LEADERBOARD_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={board === tab.id}
                className={`leaderboard-tab ${board === tab.id ? 'active' : ''}`}
                onClick={() => handleBoardChange(tab.id)}
              >
                <span className="tab-icon">{tab.icon}</span>
                <span className="tab-label">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* User's Personal Standing Card */}
          <div className="leaderboard-my-card">
            <div className="my-card-header">
              <span className="my-card-label">Your Personal Best</span>
              {userRank !== null ? (
                <span className="my-card-rank">Rank #{userRank} of {entries.length}</span>
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
                <p>Loading team standings...</p>
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
                      className={`leaderboard-row ${isCurrentUser ? 'current-user-row' : ''} ${rank <= 3 ? `top-${rank}` : ''}`}
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
      </div>
    </div>
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
