import React, { useState } from 'react';
import type { CipherType, UserSettings } from '../../types';
import { IMPLEMENTED_DRILLS } from '../../data/drills';
import { useAuth } from '../../context/useAuth';
import { Modal } from '../common/Modal';

interface OptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: UserSettings;
  onSaveSettings: (newSettings: UserSettings) => void;
}

export const OptionsModal: React.FC<OptionsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
}) => {
  const { user, allowedUser, isAllowed, isConfigured, signIn, signOut } = useAuth();
  const [studentName, setStudentName] = useState<string>(settings.studentName);
  const [unlocked, setUnlocked] = useState<CipherType[]>(settings.unlockedCiphers);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  const toggleCipher = (id: CipherType) => {
    setUnlocked((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleSave = () => {
    onSaveSettings({
      ...settings,
      studentName,
      unlockedCiphers: unlocked,
    });
    onClose();
  };

  const handleCopyClassLink = () => {
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?unlocked=${unlocked.join(',')}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="options-modal-title"
      dialogClassName="modal-dialog card-panel"
    >
      <div className="modal-header">
        <h3 id="options-modal-title">Classroom Options & Settings</h3>
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
                Sign in with Google to sync your stats, unlocked ciphers, and completed quotes across devices.
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
          <label>Student Name / Nickname:</label>
          <input
            type="text"
            className="text-input"
            value={studentName}
            placeholder="e.g. Alex"
            onChange={(e) => setStudentName(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Ciphers included in General Practice:</label>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.45rem' }}>
            Letter Offsets is always included as the warm-up step.
          </div>
          <div className="cipher-checkbox-list">
            {IMPLEMENTED_DRILLS.filter((c) => c.id !== 'offsets').map((c) => {
              const isChecked = unlocked.includes(c.id);
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

        <div className="teacher-share-box">
          <p>
            <strong>Coach Tip:</strong> Copy this link to share in Zoom chat so students automatically get the right ciphers unlocked on their devices:
          </p>
          <button className="btn-simple" onClick={handleCopyClassLink}>
            {copiedLink ? '✓ Link Copied to Clipboard!' : '📋 Copy Class Sync Link'}
          </button>
        </div>
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
