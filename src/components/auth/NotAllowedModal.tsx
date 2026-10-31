import React from 'react';
import { useAuth } from '../../context/useAuth';
import { Modal } from '../common/Modal';

function describeAuthError(error: string): { title: string; heading: string; body: string; hint: string } {
  if (error.includes('SCRIPT_BLOCKED:')) {
    const blockedUrl = error.split('SCRIPT_BLOCKED:')[1]?.replace(/\)$/, '') || 'https://apis.google.com/js/api.js';
    return {
      title: '🛡️ Sign-In Script Blocked',
      heading: 'A Browser Extension Blocked Google Sign-In',
      body: `Failed to load ${blockedUrl}.`,
      hint: 'Chrome Site Settings alone does not override extensions — pause ad/tracker blockers (such as Privacy Badger, uBlock Origin, Ghostery, or Brave Shields) for localhost, reload the page, and try again.',
    };
  }
  if (error.includes('popup-blocked')) {
    return {
      title: '🪟 Sign-In Popup Blocked',
      heading: 'Google Sign-In Window Was Blocked',
      body: 'Your browser blocked the Google Sign-In popup window from opening.',
      hint: 'If you opened this page inside an IDE preview pane, open http://localhost:5173/ directly in Chrome or Safari instead — or allow pop-ups for localhost in your browser address bar.',
    };
  }
  if (error.includes('unauthorized-domain')) {
    return {
      title: '🌐 Unauthorized Domain',
      heading: 'Domain Not Authorized in Firebase',
      body: `The current hostname (${window.location.hostname}) is not on the Firebase Auth authorized domains list.`,
      hint: 'Open http://localhost:5173/ (instead of 127.0.0.1), or add this hostname in Firebase Console → Authentication → Settings → Authorized domains.',
    };
  }
  return {
    title: '⚠️ Sign-In Error',
    heading: 'Could Not Complete Google Sign-In',
    body: `Firebase returned: ${error}`,
    hint: 'Check browser extensions (Privacy Badger, uBlock Origin, Brave Shields) and ensure On-device site data / cookies are allowed for localhost, then reload and try again.',
  };
}

export const NotAllowedModal: React.FC = () => {
  const { error, rejectedEmail, clearError, signIn } = useAuth();
  const isAllowlistError = error === 'ACCOUNT_NOT_ON_ALLOWLIST';
  const details = error && !isAllowlistError ? describeAuthError(error) : null;

  return (
    <Modal
      isOpen={Boolean(error)}
      onClose={clearError}
      ariaLabelledBy="not-allowed-modal-title"
      dialogClassName="modal-dialog card-panel not-allowed-dialog"
    >
      <div className="modal-header">
        <h3 id="not-allowed-modal-title">
          {isAllowlistError ? '🔒 Team Roster Only' : details?.title}
        </h3>
        <button className="close-btn" onClick={clearError} aria-label="Close notice">
          ✕
        </button>
      </div>

      {isAllowlistError ? (
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
      ) : (
        details && (
          <div className="modal-body not-allowed-body">
            <div className="not-allowed-icon">🔐</div>
            <h4>{details.heading}</h4>
            <p className="not-allowed-desc">{details.body}</p>
            <p className="not-allowed-subdesc">{details.hint}</p>

            <div className="not-allowed-actions">
              <button
                className="btn-main-action"
                onClick={() => {
                  clearError();
                  signIn();
                }}
              >
                Try Again
              </button>
              <button className="btn-secondary-action" onClick={clearError}>
                Continue in Guest Mode
              </button>
            </div>
          </div>
        )
      )}
    </Modal>
  );
};
