import React from 'react';
import type { WorkoutSummaryData } from '../../types';
import { formatDuration } from '../../utils/format';
import { Modal } from '../common/Modal';

interface WorkoutSummaryModalProps {
  summary: WorkoutSummaryData | null;
  onStartNextRound: () => void;
  onExitToMenu: () => void;
}

export const WorkoutSummaryModal: React.FC<WorkoutSummaryModalProps> = ({
  summary,
  onStartNextRound,
  onExitToMenu,
}) => {
  return (
    <Modal
      isOpen={Boolean(summary)}
      onClose={onExitToMenu}
      ariaLabelledBy="summary-modal-title"
      dialogClassName="modal-content workout-summary-card"
    >
      {summary && (
        <>
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
        </>
      )}
    </Modal>
  );
};
