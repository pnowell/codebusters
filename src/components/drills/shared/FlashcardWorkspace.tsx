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
  masteredCount?: number;
  onOpenMastery?: () => void;
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
  layout?: 'horizontal' | 'stacked';
  confirmReveal?: string | null;
  isWrong: boolean;
  wrongAnswer?: string | null;
  correctAnswer?: string | null;
  lockoutDurationMs?: number;
  lockoutId?: number;
  shakeCycle?: number;
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
  layout = 'horizontal',
  confirmReveal = null,
  isWrong,
  wrongAnswer = null,
  correctAnswer = null,
  lockoutDurationMs = 1500,
  lockoutId = 0,
  shakeCycle = 0,
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

  const safeLockoutMs =
    Number.isFinite(lockoutDurationMs) && lockoutDurationMs > 0
      ? Math.round(lockoutDurationMs)
      : 1500;

  const shakeClass = isWrong
    ? shakeCycle % 2 === 1
      ? 'wrong-shake-a'
      : 'wrong-shake-b'
    : '';

  const isConfirming = !isWrong && confirmReveal !== null;
  const hideNativeInput = isWrong || isConfirming;
  const isWideAnswer = Boolean(
    (isConfirming && confirmReveal.length > 1) ||
      (isWrong && correctAnswer && correctAnswer.length > 1)
  );

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

          <div
            className={
              layout === 'stacked'
                ? 'workspace-stacked-layout'
                : 'workspace-horizontal-row'
            }
          >
            <div className="workspace-prompt-side">{promptContent}</div>

            {layout === 'horizontal' && (
              <div className="workspace-divider" aria-hidden="true">
                →
              </div>
            )}

            <div className="workspace-input-side">
              <div className="user-answer-box-slot">
                <div
                  className={[
                    'user-answer-box-wrapper',
                    isWrong ? 'is-locked' : '',
                    isConfirming ? 'is-correct-confirm' : '',
                    isWideAnswer ? 'is-wide-answer' : '',
                    shakeClass,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    if (!hideNativeInput) {
                      inputRef.current?.focus();
                    }
                  }}
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
                    aria-disabled={hideNativeInput}
                    className={`user-answer-native-input ${hideNativeInput ? 'is-hidden-for-reveal' : ''}`.trim()}
                    value={inputVal}
                    placeholder="?"
                    onChange={onInputChange}
                    onKeyDown={onInputKeyDown}
                  />

                  {isConfirming && (
                    <span
                      className="correct-confirm-reveal"
                      role="status"
                      aria-live="polite"
                      aria-label={`Correct answer ${confirmReveal}`}
                    >
                      {confirmReveal}
                    </span>
                  )}

                  {isWrong && correctAnswer !== null && (
                    <span
                      key={`correct-${lockoutId}`}
                      className="wrong-correct-reveal"
                      aria-live="polite"
                      aria-label={`Correct answer ${correctAnswer}`}
                    >
                      {correctAnswer}
                    </span>
                  )}
                </div>

                {isWrong && wrongAnswer !== null && (
                  <span
                    key={`wrong-${lockoutId}`}
                    className="wrong-user-echo"
                    aria-hidden="true"
                  >
                    {wrongAnswer}
                  </span>
                )}
              </div>

              {inlineSubmit && (
                <button
                  type="button"
                  className={`btn-inline-submit ${hideNativeInput ? 'is-hidden-for-reveal' : ''}`.trim()}
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
            {isWrong ? (
              <div
                key={lockoutId}
                className="wrong-lockout-bar"
                aria-hidden="true"
              >
                <div
                  className="wrong-lockout-fill"
                  style={{ animationDuration: `${safeLockoutMs}ms` }}
                />
              </div>
            ) : newRecordAlert ? (
              <div className="workspace-new-best-pill" role="status">
                ★ NEW 60s BEST: {stats.best60s}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {stageActions &&
        (stageActions.onOpenMastery || stageActions.onOpenLeaderboard) && (
          <div className="drill-stage-actions-row">
            {stageActions.onOpenMastery && (
              <button
                type="button"
                className="popover-action-btn stage-action-btn mastery-action"
                onMouseDown={(e) => e.preventDefault()}
                onClick={stageActions.onOpenMastery}
              >
                <span>📊 Alphabet Mastery</span>
                <span className="popover-action-badge">
                  {stageActions.masteredCount ?? 0}/26
                </span>
              </button>
            )}

            {stageActions.onOpenLeaderboard && (
              <button
                type="button"
                className="popover-action-btn stage-action-btn leaderboard-action"
                onMouseDown={(e) => e.preventDefault()}
                onClick={stageActions.onOpenLeaderboard}
              >
                <span>🏆 Leaderboards</span>
                <span className="popover-action-chevron">›</span>
              </button>
            )}
          </div>
        )}
    </div>
  );
};
