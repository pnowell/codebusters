import React, { useState } from 'react';
import type { CipherType, GeneralPracticeCiphers, UserSettings } from '../../types';
import {
  GENERAL_PRACTICE_DRILLS,
  isCipherEnabledForStudent,
} from '../../data/drills';
import { useAuth } from '../../context/useAuth';
import { Modal } from '../common/Modal';

interface OptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: UserSettings;
  generalPracticeCiphers: GeneralPracticeCiphers;
  onSaveGeneralPracticeCiphers?: (ciphers: GeneralPracticeCiphers) => void;
}

export const OptionsModal: React.FC<OptionsModalProps> = ({
  isOpen,
  onClose,
  settings,
  generalPracticeCiphers,
  onSaveGeneralPracticeCiphers,
}) => {
  const { user, allowedUser, isAllowed, isConfigured, signIn, signOut } = useAuth();
  const isTeacher = Boolean(isAllowed && allowedUser?.role === 'teacher');
  const [cipherFlags, setCipherFlags] = useState<GeneralPracticeCiphers>(generalPracticeCiphers);

  const toggleCipher = (id: CipherType) => {
    setCipherFlags((prev) => ({
      ...prev,
      [id]: !isCipherEnabledForStudent(id, prev),
    }));
  };

  const handleSave = () => {
    if (isTeacher && onSaveGeneralPracticeCiphers) {
      onSaveGeneralPracticeCiphers(cipherFlags);
    }
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="options-modal-title"
      dialogClassName="modal-dialog card-panel"
    >
      <div className="modal-header">
        <h3 id="options-modal-title">
          {isTeacher ? 'Classroom Options & Settings' : 'Settings'}
        </h3>
        <button className="close-btn" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>

      <div className="modal-body">
        {/* Account & Cloud Sync Status */}
        <div className="options-account-section">
          <label className="section-label">Account & Cloud Sync:</label>
          {isAllowed && user ? (
            <div className="account-info-card">
              <div className="account-details">
                <span className="account-email">{user.email}</span>
                <span className="account-role-badge">
                  {allowedUser?.role === 'teacher' ? '🛡️ Teacher' : '👤 Student'}
                </span>
              </div>
              <button
                type="button"
                className="btn-simple btn-signout"
                onClick={signOut}
              >
                Log Out
              </button>
            </div>
          ) : isConfigured ? (
            <div className="account-login-card">
              <p className="account-prompt-text">
                Sign in with Google to sync your stats and completed quotes across devices.
              </p>
              <button
                type="button"
                className="btn-google-signin"
                onClick={signIn}
              >
                Sign In with Google
              </button>
            </div>
          ) : (
            <div className="account-guest-note">
              <span>
                💾 Guest Mode: All progress is saved locally. (Add credentials to <code>.env.local</code> to enable Google Sign-In & cloud sync).
              </span>
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="options-nickname-input">Name / Nickname:</label>
          <input
            id="options-nickname-input"
            type="text"
            className="text-input"
            value={settings.studentName}
            readOnly
          />
        </div>

        {isTeacher && (
          <div className="form-group">
            <label>Enabled Ciphers (Visible to Students):</label>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.45rem' }}>
              Controls which drills, ciphers, leaderboards, and General Practice workouts are visible to students. Letter Offsets is always enabled, and teachers can always access all implemented features.
            </div>
            <div className="cipher-checkbox-list">
              {GENERAL_PRACTICE_DRILLS.map((c) => {
                const isChecked = isCipherEnabledForStudent(c.id, cipherFlags);
                return (
                  <label key={c.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleCipher(c.id)}
                    />
                    <span className="cipher-label-text">{c.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="modal-footer">
        {isTeacher ? (
          <>
            <button type="button" className="btn-simple" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={handleSave}>
              Save Settings
            </button>
          </>
        ) : (
          <button type="button" className="btn-simple" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </Modal>
  );
};
