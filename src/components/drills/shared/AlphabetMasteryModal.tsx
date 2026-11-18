import React, { useMemo, useState } from 'react';
import {
  countMasteredDeckCards,
  getDrillDeckLetters,
  normalizeDrillDeckProgress,
} from '../../../hooks/useSpacedDeck';
import { offsetToLetter } from '../../../utils/ciphers';
import type { DrillId, DrillProgress, OffsetsMode } from '../../../types';
import { Modal } from '../../common/Modal';

interface AlphabetMasteryModalProps {
  isOpen: boolean;
  onClose: () => void;
  progress: DrillProgress;
  onResetProgress: () => void;
  drillId?: DrillId;
  mode?: OffsetsMode;
  title?: string;
}

const ALL_OFFSETS = Array.from({ length: 26 }, (_, i) => i);
const ROW_1_OFFSETS = ALL_OFFSETS.slice(0, 13); // A to M
const ROW_2_OFFSETS = ALL_OFFSETS.slice(13);     // N to Z

export const AlphabetMasteryModal: React.FC<AlphabetMasteryModalProps> = ({
  isOpen,
  onClose,
  progress,
  onResetProgress,
  drillId,
  mode,
  title,
}) => {
  const [isConfirmingReset, setIsConfirmingReset] = useState<boolean>(false);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setIsConfirmingReset(false);
    }
  }

  const handleClose = () => {
    setIsConfirmingReset(false);
    onClose();
  };

  const normalizedProgress = useMemo(
    () => normalizeDrillDeckProgress(drillId, progress),
    [drillId, progress]
  );
  const deckSize = getDrillDeckLetters(drillId).length;
  const masteredCount = useMemo(
    () => countMasteredDeckCards(drillId, normalizedProgress),
    [drillId, normalizedProgress]
  );

  const renderBadge = (offset: number) => {
    const letter = offsetToLetter(offset);
    if (
      (drillId === 'knights' && letter === 'J') ||
      (drillId === 'tap' && letter === 'K')
    ) {
      return null;
    }

    const displayLabel =
      drillId === 'knights' && letter === 'I'
        ? 'I/J'
        : drillId === 'tap' && letter === 'C'
          ? 'C/K'
          : letter;
    const isDualLetter = displayLabel.length > 1;
    const p = normalizedProgress[letter];

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
      isDualLetter ? 'is-dual-letter' : '',
      statusClass,
    ]
      .filter(Boolean)
      .join(' ');
    const badgeTitle = `${displayLabel}: ${statusLabel}`;

    return (
      <div key={letter} className={classes} title={badgeTitle}>
        {displayLabel}
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      ariaLabelledBy="mastery-modal-title"
      dialogClassName="modal-content"
    >
      <div className="modal-header">
        <div>
          <h3 id="mastery-modal-title" className="modal-title">
            {title || `Alphabet Mastery ${mode ? `(${mode === 'numToLetter' ? '# → ABC' : 'ABC → #'})` : ''}`}
          </h3>
          <div className="modal-subtitle" style={{ fontSize: '0.8rem', color: '#34d399', fontWeight: 700, marginTop: '2px' }}>
            {masteredCount} / {deckSize} Mastered (Streak 3+)
          </div>
        </div>
        <button
          type="button"
          className="modal-close-btn"
          onClick={handleClose}
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
        {!isConfirmingReset ? (
          <>
            <div className="modal-danger-warning">
              ⚠️ <strong>Reset Notice:</strong> Resetting clears individual letter streaks and returns all {deckSize} {deckSize === 25 ? 'symbols' : 'letters'} to unseen in the deck.
            </div>
            <button
              type="button"
              className="modal-reset-btn"
              onClick={() => setIsConfirmingReset(true)}
            >
              ↺ Reset Alphabet Mastery
            </button>
          </>
        ) : (
          <div className="modal-confirm-reset-box">
            <div className="modal-danger-warning" style={{ color: '#f87171', fontWeight: 600 }}>
              Are you sure you want to reset all letter mastery streaks? All {deckSize} {deckSize === 25 ? 'symbols' : 'letters'} will return to unseen.
            </div>
            <div className="modal-confirm-actions">
              <button
                type="button"
                className="btn-simple btn-cancel-reset"
                onClick={() => setIsConfirmingReset(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-reset-btn btn-confirm-reset"
                onClick={() => {
                  setIsConfirmingReset(false);
                  onResetProgress();
                }}
              >
                Yes, Reset Mastery ✓
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
