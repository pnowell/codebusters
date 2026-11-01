import React, { useState, useRef, useEffect } from 'react';

export interface DrillModeOption<T extends string = string> {
  readonly id: T;
  readonly label: string;
}

export interface DrillOverflowMenuProps {
  streak: number;
  bestStreak: number;
  current60s: number;
  best60s: number;
  totalQuestions: number;
  correctQuestions: number;
  masteredCount: number;
  onOpenMastery: () => void;
  onOpenLeaderboard?: () => void;
  modeOptions?: readonly DrillModeOption[];
  activeMode?: string;
  onSelectMode?: (modeId: string) => void;
  onCloseFocusRestore?: () => void;
}

export const DrillOverflowMenu: React.FC<DrillOverflowMenuProps> = ({
  streak,
  bestStreak,
  current60s,
  best60s,
  totalQuestions,
  correctQuestions,
  masteredCount,
  onOpenMastery,
  onOpenLeaderboard,
  modeOptions,
  activeMode,
  onSelectMode,
  onCloseFocusRestore,
}) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        onCloseFocusRestore?.();
        return;
      }

      // If the user starts typing an answer key while the popover is open,
      // auto-close the popover and allow the keystroke to submit/type normally.
      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (/^[a-zA-Z0-9]$/.test(e.key) || e.key === 'Backspace')
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDownCapture, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDownCapture, true);
    };
  }, [open, onCloseFocusRestore]);

  const accuracyPct =
    totalQuestions > 0 ? Math.round((correctQuestions / totalQuestions) * 100) : 100;

  return (
    <div className="drill-overflow-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className={`btn-simple btn-drill-overflow ${open ? 'is-open' : ''}`}
        aria-label="Drill stats and options"
        aria-haspopup="true"
        aria-expanded={open}
        title="Stats, Mastery & Leaderboard"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (!next) {
              onCloseFocusRestore?.();
            }
            return next;
          });
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="8" cy="3" r="1.6" />
          <circle cx="8" cy="8" r="1.6" />
          <circle cx="8" cy="13" r="1.6" />
        </svg>
      </button>

      {open && (
        <div className="drill-overflow-popover" role="region" aria-label="Drill stats and actions">
          {modeOptions && modeOptions.length > 0 && onSelectMode && (
            <div className="popover-section">
              <div className="popover-section-label">Mode</div>
              <div className="popover-mode-segmented">
                {modeOptions.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`popover-mode-btn ${activeMode === m.id ? 'active' : ''}`}
                    onClick={() => {
                      setOpen(false);
                      if (m.id !== activeMode) {
                        onSelectMode(m.id);
                      } else {
                        onCloseFocusRestore?.();
                      }
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="popover-section popover-stats-list">
            <div className="popover-stat-row">
              <span className="popover-stat-label">🔥 Streak</span>
              <span className="popover-stat-val">
                <strong>{streak}</strong>{' '}
                <small className="popover-stat-sub">(Best {bestStreak})</small>
              </span>
            </div>
            <div className="popover-stat-row">
              <span className="popover-stat-label">⚡ 60s Score</span>
              <span className="popover-stat-val">
                <strong>{current60s}</strong>{' '}
                <small className="popover-stat-sub">(Best {best60s})</small>
              </span>
            </div>
            <div className="popover-stat-row">
              <span className="popover-stat-label">🎯 Accuracy</span>
              <span className="popover-stat-val">
                <strong>{accuracyPct}%</strong>{' '}
                <small className="popover-stat-sub">
                  ({correctQuestions}/{totalQuestions})
                </small>
              </span>
            </div>
          </div>

          <div className="popover-actions">
            <button
              type="button"
              className="popover-action-btn mastery-action"
              onClick={() => {
                setOpen(false);
                onOpenMastery();
              }}
            >
              <span>📊 Alphabet Mastery</span>
              <span className="popover-action-badge">{masteredCount}/26</span>
            </button>

            {onOpenLeaderboard && (
              <button
                type="button"
                className="popover-action-btn leaderboard-action"
                onClick={() => {
                  setOpen(false);
                  onOpenLeaderboard();
                }}
              >
                <span>🏆 Team Leaderboard</span>
                <span className="popover-action-chevron">›</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
