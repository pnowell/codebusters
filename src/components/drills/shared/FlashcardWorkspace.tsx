import React from 'react';
import type { FloatingGhostItem } from '../../../hooks/useFloatingGhosts';
import type { HeatTierInfo } from '../../../hooks/useVelocityTracker';
import { FloatingGhosts } from './FloatingGhosts';

export interface FlashcardWorkspaceProps {
  ghosts: FloatingGhostItem[];
  onRemoveGhost: (id: string) => void;
  heatTier: HeatTierInfo['tier'];
  barPercent: number;
  newRecordAlert: boolean;
  best60s: number;
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
  best60s,
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

  return (
    <div className="offset-card-wrapper">
      <FloatingGhosts ghosts={ghosts} onRemove={onRemoveGhost} />

      <div
        className={`offset-card workspace-tier-${heatTier} ${isWrong ? 'feedback-wrong' : ''}`}
      >
        <div className="workspace-pace-track" aria-hidden="true">
          <div
            className="workspace-pace-fill"
            style={{ width: `${clampedPercent}%` }}
          />
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
              ★ NEW 60s BEST: {best60s}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
