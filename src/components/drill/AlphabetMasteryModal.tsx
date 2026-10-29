import React from 'react';
import { offsetToLetter } from '../../utils/ciphers';
import type { OffsetsProgress, OffsetsMode } from '../../services/storage';

interface AlphabetMasteryModalProps {
  isOpen: boolean;
  onClose: () => void;
  progress: OffsetsProgress;
  onResetProgress: () => void;
  currentOffset: number;
  mode?: OffsetsMode;
}

const ALL_OFFSETS = Array.from({ length: 26 }, (_, i) => i);
const ROW_1_OFFSETS = ALL_OFFSETS.slice(0, 13); // A to M
const ROW_2_OFFSETS = ALL_OFFSETS.slice(13);     // N to Z
const ANCHOR_OFFSETS = [2, 5, 8, 11, 14, 17, 20, 23] as const;

export const AlphabetMasteryModal: React.FC<AlphabetMasteryModalProps> = ({
  isOpen,
  onClose,
  progress,
  onResetProgress,
  currentOffset,
  mode,
}) => {
  if (!isOpen) return null;

  const masteredCount = progress
    ? Object.values(progress).filter(p => p && typeof p === 'object' && (p.streak || 0) >= 3).length
    : 0;

  const renderBadge = (offset: number) => {
    const letter = offsetToLetter(offset);
    const p = progress[letter];
    const isAnchor = ANCHOR_OFFSETS.includes(offset as any);
    const isCurrent = currentOffset === offset;

    let statusClass = 'status-unseen';
    let statusLabel = 'Unseen';

    if (p && p.attempts > 0) {
      if (p.streak >= 3) {
        statusClass = 'status-mastered';
        statusLabel = `Mastered (${p.correct}/${p.attempts}, streak ${p.streak})`;
      } else if (p.streak === 0) {
        statusClass = 'status-missed';
        statusLabel = `Needs Practice (${p.correct}/${p.attempts})`;
      } else {
        statusClass = 'status-learning';
        statusLabel = `Learning (${p.correct}/${p.attempts}, streak ${p.streak})`;
      }
    }

    const classes = [
      'mastery-badge',
      statusClass,
      isAnchor ? 'is-anchor' : '',
      isCurrent ? 'is-current' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const title = `${letter} (${offset}): ${statusLabel}${isAnchor ? ' • Anchor' : ''}`;

    return (
      <div key={letter} className={classes} title={title}>
        {letter}
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mastery-modal-title"
      >
        <div className="modal-header">
          <div>
            <h3 id="mastery-modal-title" className="modal-title">
              Alphabet Mastery {mode ? `(${mode === 'numToLetter' ? '# → Letter' : 'Letter → #'})` : ''}
            </h3>
            <div className="modal-subtitle" style={{ fontSize: '0.8rem', color: '#34d399', fontWeight: 700, marginTop: '2px' }}>
              {masteredCount} / 26 Mastered (Streak 3+)
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        <div className="modal-legend">
          <div className="legend-item">
            <span className="legend-dot dot-unseen" />
            <span>Unseen</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot dot-learning" />
            <span>Learning (1–2)</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot dot-mastered" />
            <span>Mastered (3+)</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot dot-missed" />
            <span>Needs Practice</span>
          </div>
        </div>

        <div className="mastery-grid" style={{ margin: '0.5rem 0' }}>
          <div className="mastery-row">
            {ROW_1_OFFSETS.map(renderBadge)}
          </div>
          <div className="mastery-row">
            {ROW_2_OFFSETS.map(renderBadge)}
          </div>
        </div>

        <div className="modal-danger-zone">
          <div className="modal-danger-warning">
            ⚠️ <strong>Reset Notice:</strong> Resetting clears individual letter streaks and returns all 26 letters to unseen in the deck.
          </div>
          <button
            type="button"
            className="modal-reset-btn"
            onClick={onResetProgress}
          >
            ↺ Reset Alphabet Mastery
          </button>
        </div>
      </div>
    </div>
  );
};
