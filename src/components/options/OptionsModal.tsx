import React, { useEffect, useMemo, useState } from 'react';
import type { CipherType, GeneralPracticeCiphers, UserSettings } from '../../types';
import {
  GENERAL_PRACTICE_DRILLS,
  isCipherEnabledForStudent,
} from '../../data/drills';
import {
  fetchStudentRoster,
  saveStudentBetaTesters,
  type StudentRosterEntry,
} from '../../services/rosterService';
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
  const isBetaTester = Boolean(
    isAllowed && allowedUser?.role === 'student' && allowedUser?.betaTester
  );

  const [cipherFlags, setCipherFlags] = useState<GeneralPracticeCiphers>(
    generalPracticeCiphers
  );
  const [rosterEntries, setRosterEntries] = useState<StudentRosterEntry[]>([]);
  const [selectedBetaIds, setSelectedBetaIds] = useState<Set<string>>(() => new Set());
  const [isRosterLoading, setIsRosterLoading] = useState<boolean>(isTeacher);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen || !isTeacher) return;

    let cancelled = false;
    void fetchStudentRoster().then(({ entries, error }) => {
      if (cancelled) return;
      setRosterEntries(entries);
      setSelectedBetaIds(
        new Set(entries.filter((e) => e.betaTester).map((e) => e.docId))
      );
      setRosterError(error);
      setIsRosterLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, isTeacher]);

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of rosterEntries) {
      const key = entry.displayName.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const dupes = new Set<string>();
    counts.forEach((count, key) => {
      if (count > 1) dupes.add(key);
    });
    return dupes;
  }, [rosterEntries]);

  const formatStudentLabel = (entry: StudentRosterEntry): string =>
    duplicateNames.has(entry.displayName.toLowerCase())
      ? `${entry.displayName} (${entry.maskedEmailHint})`
      : entry.displayName;

  const selectedBetaStudents = useMemo(
    () => rosterEntries.filter((e) => selectedBetaIds.has(e.docId)),
    [rosterEntries, selectedBetaIds]
  );

  const availableStudentsToAdd = useMemo(
    () => rosterEntries.filter((e) => !selectedBetaIds.has(e.docId)),
    [rosterEntries, selectedBetaIds]
  );

  const toggleCipher = (id: CipherType) => {
    setCipherFlags((prev) => ({
      ...prev,
      [id]: !isCipherEnabledForStudent(id, prev),
    }));
  };

  const handleAddBetaTester = (docId: string) => {
    if (!docId) return;
    setSelectedBetaIds((prev) => {
      const next = new Set(prev);
      next.add(docId);
      return next;
    });
  };

  const handleRemoveBetaTester = (docId: string) => {
    setSelectedBetaIds((prev) => {
      const next = new Set(prev);
      next.delete(docId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!isTeacher || isSaving) return;
    setSaveError(null);
    setIsSaving(true);

    try {
      if (onSaveGeneralPracticeCiphers) {
        onSaveGeneralPracticeCiphers(cipherFlags);
      }

      if (!isRosterLoading && !rosterError) {
        const ok = await saveStudentBetaTesters(rosterEntries, selectedBetaIds);
        if (!ok) {
          setSaveError(
            'Could not save Beta Testers changes. Check your connection and try again.'
          );
          return;
        }
      }

      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="options-modal-title"
      dialogClassName="modal-dialog card-panel options-modal-dialog"
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
                  {allowedUser?.role === 'teacher' ? (
                    '🛡️ Teacher'
                  ) : isBetaTester ? (
                    <>
                      👤 Student ·{' '}
                      <span className="account-role-beta">βeta Tester</span>
                    </>
                  ) : (
                    '👤 Student'
                  )}
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
          <>
            <div className="form-group">
              <label>Enabled Ciphers (Visible to Students):</label>
              <div className="options-helper-note">
                Controls which drills, ciphers, leaderboards, and General Practice workouts are visible to all students. Letter Offsets is always enabled, and teachers can always access all implemented features.
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

            <div className="form-group">
              <label htmlFor="options-add-beta-tester">
                Beta Testers (Preview Hidden Features):
              </label>
              <div className="options-helper-note">
                Students in this group can access hidden drills, ciphers, General Practice workouts, and leaderboards before class. Does not grant access to draft practice tests or teacher tools.
              </div>

              <div className="beta-testers-box">
                {isRosterLoading ? (
                  <div className="beta-testers-empty">Loading student roster…</div>
                ) : rosterError ? (
                  <div className="options-save-error">{rosterError}</div>
                ) : (
                  <>
                    <div
                      className="beta-testers-pills"
                      aria-label="Selected beta testers"
                    >
                      {selectedBetaStudents.length === 0 ? (
                        <span className="beta-testers-empty">
                          No beta testers selected.
                        </span>
                      ) : (
                        selectedBetaStudents.map((student) => {
                          const label = formatStudentLabel(student);
                          return (
                            <span key={student.docId} className="beta-tester-pill">
                              <span
                                className="beta-tester-pill-symbol"
                                aria-hidden="true"
                              >
                                β
                              </span>
                              <span>{label}</span>
                              <button
                                type="button"
                                className="beta-tester-remove-btn"
                                onClick={() => handleRemoveBetaTester(student.docId)}
                                aria-label={`Remove ${label} from Beta Testers`}
                                title={`Remove ${label}`}
                              >
                                ✕
                              </button>
                            </span>
                          );
                        })
                      )}
                    </div>

                    {availableStudentsToAdd.length > 0 && (
                      <select
                        id="options-add-beta-tester"
                        className="beta-testers-select"
                        value=""
                        onChange={(e) => handleAddBetaTester(e.target.value)}
                        aria-label="Add student to Beta Testers"
                      >
                        <option value="">+ Add student to Beta Testers…</option>
                        {availableStudentsToAdd.map((student) => (
                          <option key={student.docId} value={student.docId}>
                            {formatStudentLabel(student)}
                          </option>
                        ))}
                      </select>
                    )}
                  </>
                )}
              </div>
            </div>

            {saveError && <div className="options-save-error">{saveError}</div>}
          </>
        )}
      </div>

      <div className="modal-footer">
        {isTeacher ? (
          <>
            <button
              type="button"
              className="btn-simple"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleSave()}
              disabled={isSaving}
            >
              {isSaving ? 'Saving…' : 'Save Settings'}
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
