import React from 'react';
import type { FloatingGhostItem } from '../../../hooks/useFloatingGhosts';
import type { HeatTierInfo } from '../../../hooks/useVelocityTracker';
import { FloatingGhosts } from './FloatingGhosts';

export interface FlashcardStats {
  current60s: number;
  best60s: number;
  streak: number;
  bestStreak: number;
  correctQuestions: number;
  totalQuestions: number;
}

export interface FlashcardStageActions {
  masteredCount: number;
  onOpenMastery: () => void;
  onOpenLeaderboard?: () => void;
}

export interface FlashcardWorkspaceProps {
  ghosts: FloatingGhostItem[];
  onRemoveGhost: (id: string) => void;
  heatTier: HeatTierInfo['tier'];
  barPercent: number;
  newRecordAlert: boolean;
  stats: FlashcardStats;
  stageActions?: FlashcardStageActions;
  isWrong: boolean;
  wrongHintContent?: React.ReactNode;
  promptContent: React.ReactNode;
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputVal: string;
  inputMode: 'numeric' | 'text';
  pattern?: string;
  autoCapitalize: 'characters' | 'off';
  maxLength: number;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inlineSubmit?: {
    onSubmit: () => void;
    disabled: boolean;
  };
}

export const FlashcardWorkspace: React.FC<FlashcardWorkspaceProps> = ({
  ghosts,
  onRemoveGhost,
  heatTier,
  barPercent,
  newRecordAlert,
  stats,
  stageActions,
  isWrong,
  wrongHintContent,
  promptContent,
  inputRef,
  inputVal,
  inputMode,
  pattern,
  autoCapitalize,
  maxLength,
  onInputChange,
  onInputKeyDown,
  inlineSubmit,
}) => {
  const clampedPercent = Number.isFinite(barPercent)
    ? Math.max(0, Math.min(100, barPercent))
    : 0;

  const accuracyPct =
    stats.totalQuestions > 0
      ? Math.round((stats.correctQuestions / stats.totalQuestions) * 100)
      : null;

  return (
    <div className="workspace-anchor">
      <FloatingGhosts ghosts={ghosts} onRemove={onRemoveGhost} />

      <div className="offset-card-wrapper">
        <div
          className={`offset-card workspace-tier-${heatTier} ${isWrong ? 'feedback-wrong' : ''}`}
        >
          <div className="workspace-pace-track" aria-hidden="true">
            <div
              className="workspace-pace-fill"
              style={{ width: `${clampedPercent}%` }}
            />
          </div>

          <div className="workspace-stats-strip" aria-label="Live drill statistics">
            <div className="workspace-stat-chip">
              <div className="workspace-stat-main">
                <span className="workspace-stat-label">⚡ 60s</span>
                <strong className="workspace-stat-val">{stats.current60s}</strong>
              </div>
              <span className="workspace-stat-sub">Best {stats.best60s}</span>
            </div>

            <div className="workspace-stat-divider" aria-hidden="true" />

            <div className="workspace-stat-chip">
              <div className="workspace-stat-main">
                <span className="workspace-stat-label">🔥 Streak</span>
                <strong className="workspace-stat-val">{stats.streak}</strong>
              </div>
              <span className="workspace-stat-sub">Best {stats.bestStreak}</span>
            </div>

            <div className="workspace-stat-divider" aria-hidden="true" />

            <div className="workspace-stat-chip">
              <div className="workspace-stat-main">
                <span className="workspace-stat-label">🎯 Acc</span>
                <strong className="workspace-stat-val">
                  {accuracyPct !== null ? `${accuracyPct}%` : '—'}
                </strong>
              </div>
              <span className="workspace-stat-sub">
                {stats.totalQuestions > 0
                  ? `${stats.correctQuestions}/${stats.totalQuestions}`
                  : '0/0'}
              </span>
            </div>
          </div>

          <div className="workspace-horizontal-row">
            <div className="workspace-prompt-side">{promptContent}</div>

            <div className="workspace-divider" aria-hidden="true">
              →
            </div>

            <div className="workspace-input-side">
              <div
                className="user-answer-box-wrapper"
                onClick={() => inputRef.current?.focus()}
              >
                <input
                  ref={inputRef}
                  type="text"
                  inputMode={inputMode}
                  pattern={pattern}
                  autoCapitalize={autoCapitalize}
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck="false"
                  enterKeyHint="done"
                  maxLength={maxLength}
                  className="user-answer-native-input"
                  value={inputVal}
                  placeholder="?"
                  onChange={onInputChange}
                  onKeyDown={onInputKeyDown}
                />
              </div>

              {inlineSubmit && (
                <button
                  type="button"
                  className="btn-inline-submit"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={inlineSubmit.onSubmit}
                  disabled={inlineSubmit.disabled}
                  title="Submit Answer (Enter)"
                  aria-label="Submit Answer"
                >
                  ⏎
                </button>
              )}
            </div>
          </div>

          <div className="workspace-hint-slot" aria-live="polite">
            {isWrong && wrongHintContent ? (
              <div className="answer-hint">{wrongHintContent}</div>
            ) : newRecordAlert ? (
              <div className="workspace-new-best-pill" role="status">
                ★ NEW 60s BEST: {stats.best60s}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {stageActions && (
        <div className="drill-stage-actions-row">
          <button
            type="button"
            className="popover-action-btn stage-action-btn mastery-action"
            onMouseDown={(e) => e.preventDefault()}
            onClick={stageActions.onOpenMastery}
          >
            <span>📊 Alphabet Mastery</span>
            <span className="popover-action-badge">
              {stageActions.masteredCount}/26
            </span>
          </button>

          {stageActions.onOpenLeaderboard && (
            <button
              type="button"
              className="popover-action-btn stage-action-btn leaderboard-action"
              onMouseDown={(e) => e.preventDefault()}
              onClick={stageActions.onOpenLeaderboard}
            >
              <span>🏆 Team Leaderboard</span>
              <span className="popover-action-chevron">›</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
