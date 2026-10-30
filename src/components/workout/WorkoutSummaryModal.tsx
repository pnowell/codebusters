import React from 'react';
import type { CipherType } from '../../data/drills';
import type { OffsetsMode } from '../../services/storage';

export interface WorkoutStepResult {
  cipherId: CipherType;
  title: string;
  timeSeconds?: number;
  accuracy?: number;
  author?: string;
  offsets60s?: number;
  offsetsMode?: OffsetsMode;
}

export interface WorkoutSummaryData {
  round: number;
  totalTimeSeconds: number;
  results: WorkoutStepResult[];
}

interface WorkoutSummaryModalProps {
  summary: WorkoutSummaryData | null;
  onStartNextRound: () => void;
  onExitToMenu: () => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

export const WorkoutSummaryModal: React.FC<WorkoutSummaryModalProps> = ({
  summary,
  onStartNextRound,
  onExitToMenu,
}) => {
  if (!summary) return null;

  return (
    <div className="modal-overlay" onClick={onExitToMenu}>
      <div
        className="modal-content workout-summary-card"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="summary-modal-title"
      >
        <div className="summary-trophy-banner">
          <span className="trophy-emoji">🏆</span>
          <h2 id="summary-modal-title" className="summary-title">
            Round {summary.round} Complete!
          </h2>
          <div className="summary-subtitle">
            Total Circuit Time: <strong>{formatDuration(summary.totalTimeSeconds)}</strong>
          </div>
        </div>

        <div className="summary-results-list">
          {summary.results.map((res, idx) => {
            if (res.cipherId === 'offsets') {
              return (
                <div key={idx} className="summary-result-row">
                  <div className="summary-row-left">
                    <span className="summary-row-badge">⏱️ Warm-up</span>
                    <span className="summary-row-name">
                      Letter Offsets{' '}
                      <small style={{ opacity: 0.75, fontWeight: 500 }}>
                        ({res.offsetsMode === 'numToLetter' ? '# → Letter' : 'Letter → #'})
                      </small>
                    </span>
                  </div>
                  <div className="summary-row-stats">
                    <span>
                      60s Blitz: <strong>{res.offsets60s ?? 0}</strong>
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div key={idx} className="summary-result-row">
                <div className="summary-row-left">
                  <span className="summary-row-badge">📜 Cipher {idx}</span>
                  <div>
                    <div className="summary-row-name">{res.title}</div>
                    {res.author && (
                      <div className="summary-row-subtext">— {res.author}</div>
                    )}
                  </div>
                </div>
                <div className="summary-row-stats">
                  <span>
                    {res.timeSeconds ? formatDuration(res.timeSeconds) : 'Solved'}
                  </span>
                  {typeof res.accuracy === 'number' && (
                    <span className="summary-acc-badge">
                      {Math.round(res.accuracy)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="summary-actions">
          <button
            type="button"
            className="btn-primary summary-btn-next"
            onClick={onStartNextRound}
          >
            🔄 Start Round {summary.round + 1}
          </button>
          <button
            type="button"
            className="btn-simple summary-btn-menu"
            onClick={onExitToMenu}
          >
            🏠 Main Menu
          </button>
        </div>
      </div>
    </div>
  );
};
