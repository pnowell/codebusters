import React from 'react';
import { useAuth } from '../../context/useAuth';
import { Modal } from '../common/Modal';

export const NotAllowedModal: React.FC = () => {
  const { error, rejectedEmail, clearError, signIn } = useAuth();

  return (
    <Modal
      isOpen={error === 'ACCOUNT_NOT_ON_ALLOWLIST'}
      onClose={clearError}
      ariaLabelledBy="not-allowed-modal-title"
      dialogClassName="modal-dialog card-panel not-allowed-dialog"
    >
      <div className="modal-header">
        <h3 id="not-allowed-modal-title">🔒 Team Roster Only</h3>
        <button className="close-btn" onClick={clearError} aria-label="Close notice">
          ✕
        </button>
      </div>

      <div className="modal-body not-allowed-body">
        <div className="not-allowed-icon">📋</div>
        <h4>Google Account Not on Allowlist</h4>
        <p className="not-allowed-desc">
          The account <strong className="highlight-email">{rejectedEmail}</strong> is not
          currently registered on the DaVinci Decoders classroom roster.
        </p>
        <p className="not-allowed-subdesc">
          You can continue practicing in <strong>Guest Mode</strong> (all progress is safely
          saved on this device), or ask your teacher to add your email address to the team list.
        </p>

        <div className="not-allowed-actions">
          <button className="btn-main-action" onClick={clearError}>
            Continue in Guest Mode
          </button>
          <button
            className="btn-secondary-action"
            onClick={() => {
              clearError();
              signIn();
            }}
          >
            Try Another Account
          </button>
        </div>
      </div>
    </Modal>
  );
};
