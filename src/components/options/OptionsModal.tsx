import React, { useState } from 'react';
import type { CipherType, GeneralPracticeCiphers, UserSettings } from '../../types';
import { GENERAL_PRACTICE_DRILLS } from '../../data/drills';
import { useAuth } from '../../context/useAuth';
import { Modal } from '../common/Modal';

interface OptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: UserSettings;
  onSaveSettings: (newSettings: UserSettings) => void;
  generalPracticeCiphers: GeneralPracticeCiphers;
  onSaveGeneralPracticeCiphers?: (ciphers: GeneralPracticeCiphers) => void;
}

export const OptionsModal: React.FC<OptionsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  generalPracticeCiphers,
  onSaveGeneralPracticeCiphers,
}) => {
  const { user, allowedUser, isAllowed, isConfigured, signIn, signOut } = useAuth();
  const isTeacher = Boolean(isAllowed && allowedUser?.role === 'teacher');
  const [studentName, setStudentName] = useState<string>(settings.studentName);
  const [cipherFlags, setCipherFlags] = useState<GeneralPracticeCiphers>(generalPracticeCiphers);

  const toggleCipher = (id: CipherType) => {
    setCipherFlags((prev) => ({
      ...prev,
      [id]: !(prev[id] ?? true),
    }));
  };

  const handleSave = () => {
    onSaveSettings({
      ...settings,
      studentName,
    });
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
          <label>Name / Nickname:</label>
          <input
            type="text"
            className="text-input"
            value={studentName}
            placeholder="e.g. Alex"
            onChange={(e) => setStudentName(e.target.value)}
          />
        </div>

        {isTeacher && (
          <div className="form-group">
            <label>Ciphers included in General Practice:</label>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.45rem' }}>
              Applies globally to everyone. Letter Offsets is always included in the warm-up rotation.
            </div>
            <div className="cipher-checkbox-list">
              {GENERAL_PRACTICE_DRILLS.map((c) => {
                const isChecked = cipherFlags[c.id] !== false;
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
        <button className="btn-simple" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={handleSave}>
          Save Settings
        </button>
      </div>
    </Modal>
  );
};
