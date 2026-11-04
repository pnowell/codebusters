import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicProfile, TestAttempt, TestCohort, TestPacket } from '../../types';
import { subscribeTeamProfiles } from '../../services/profileService';
import {
  deleteTestAttempt,
  subscribeAttemptsForTest,
  updateTestConfiguration,
} from '../../services/testService';
import { getCohortAttemptId, normalizeUidList } from '../../utils/testSync';
import { Modal } from '../common/Modal';

interface TestCohortModalProps {
  testPacket: TestPacket;
  onClose: () => void;
}

export const TestCohortModal: React.FC<TestCohortModalProps> = ({
  testPacket,
  onClose,
}) => {
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [attemptsMap, setAttemptsMap] = useState<Record<string, TestAttempt>>({});
  const [isActive, setIsActive] = useState<boolean>(testPacket.active);
  const [cohorts, setCohorts] = useState<TestCohort[]>(() =>
    testPacket.cohorts && testPacket.cohorts.length > 0
      ? testPacket.cohorts.map((c) => ({
          id: c.id,
          name: c.name ?? '',
          studentUids: [...c.studentUids],
        }))
      : []
  );
  const [selectedCohortId, setSelectedCohortId] = useState<string | null>(
    () => testPacket.cohorts?.[0]?.id ?? null
  );
  const [includeTeachers, setIncludeTeachers] = useState<boolean>(false);
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cohortIdSeqRef = useRef<number>((testPacket.cohorts?.length ?? 0) + 1);

  const nextCohortId = () => {
    const seq = cohortIdSeqRef.current;
    cohortIdSeqRef.current += 1;
    const suffix =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().slice(0, 8)
        : String(seq);
    return `cohort-${suffix}-${seq}`;
  };

  useEffect(() => {
    const unsubProfiles = subscribeTeamProfiles((list) => {
      setProfiles(list);
    });
    const unsubAttempts = subscribeAttemptsForTest(testPacket.testId, (map) => {
      setAttemptsMap(map);
    });
    return () => {
      unsubProfiles();
      unsubAttempts();
    };
  }, [testPacket.testId]);

  const profileByUid = useMemo(() => {
    const map = new Map<string, PublicProfile>();
    profiles.forEach((p) => map.set(p.uid, p));
    return map;
  }, [profiles]);

  const assignedUids = useMemo(() => {
    const set = new Set<string>();
    cohorts.forEach((c) => c.studentUids.forEach((uid) => set.add(uid)));
    return set;
  }, [cohorts]);

  const unassignedProfiles = useMemo(() => {
    return profiles
      .filter((p) => (includeTeachers ? true : p.role === 'student'))
      .filter((p) => !assignedUids.has(p.uid))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [profiles, includeTeachers, assignedUids]);

  const handleAddCohort = () => {
    const nextIndex = cohorts.length + 1;
    const newId = nextCohortId();
    const nextCohort: TestCohort = {
      id: newId,
      name: `Team ${nextIndex}`,
      studentUids: [],
    };
    setCohorts((prev) => [...prev, nextCohort]);
    setSelectedCohortId(newId);
  };

  const handleRemoveCohort = (cohortId: string) => {
    setCohorts((prev) => {
      const filtered = prev.filter((c) => c.id !== cohortId);
      if (selectedCohortId === cohortId) {
        setSelectedCohortId(filtered[0]?.id ?? null);
      }
      return filtered;
    });
  };

  const handleRenameCohort = (cohortId: string, name: string) => {
    setCohorts((prev) =>
      prev.map((c) => (c.id === cohortId ? { ...c, name } : c))
    );
  };

  const handleAssignUser = (uid: string) => {
    if (cohorts.length === 0 || !selectedCohortId) {
      const newId = nextCohortId();
      setCohorts([{ id: newId, name: 'Team 1', studentUids: [uid] }]);
      setSelectedCohortId(newId);
      return;
    }

    setCohorts((prev) =>
      prev.map((c) =>
        c.id === selectedCohortId && !c.studentUids.includes(uid)
          ? { ...c, studentUids: [...c.studentUids, uid] }
          : c
      )
    );
  };

  const handleUnassignUser = (cohortId: string, uid: string) => {
    setCohorts((prev) =>
      prev.map((c) =>
        c.id === cohortId
          ? { ...c, studentUids: c.studentUids.filter((id) => id !== uid) }
          : c
      )
    );
  };

  const handleAutoPair = () => {
    if (unassignedProfiles.length === 0) return;
    const newCohorts: TestCohort[] = [...cohorts];
    let baseIdx = newCohorts.length + 1;

    for (let i = 0; i < unassignedProfiles.length; i += 2) {
      const pair = unassignedProfiles.slice(i, i + 2).map((p) => p.uid);
      newCohorts.push({
        id: nextCohortId(),
        name: `Team ${baseIdx}`,
        studentUids: pair,
      });
      baseIdx += 1;
    }

    setCohorts(newCohorts);
    if (!selectedCohortId && newCohorts.length > 0) {
      setSelectedCohortId(newCohorts[0].id);
    }
  };

  const handleResetAttempt = async (attemptId: string) => {
    setErrorMsg(null);
    const ok = await deleteTestAttempt(attemptId);
    if (!ok) {
      setErrorMsg('Failed to reset attempt. Check your connection or Firestore rules.');
    }
    setConfirmResetId(null);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMsg(null);

    const cleanedCohorts: TestCohort[] = cohorts
      .map((c) => ({
        id: c.id,
        ...(c.name && c.name.trim() ? { name: c.name.trim() } : {}),
        studentUids: normalizeUidList(c.studentUids),
      }))
      .filter((c) => c.studentUids.length > 0);

    const ok = await updateTestConfiguration(testPacket.testId, {
      active: isActive,
      cohorts: cleanedCohorts,
    });

    setIsSaving(false);
    if (ok) {
      onClose();
    } else {
      setErrorMsg('Could not save test settings. Verify teacher permissions in Firestore.');
    }
  };

  const renderAttemptStatus = (studentUids: string[]) => {
    if (studentUids.length === 0) return null;
    const attemptId = getCohortAttemptId(testPacket.testId, studentUids);
    const attempt = attemptsMap[attemptId];
    if (!attempt) return null;

    let label = '';
    let statusClass = '';
    if (attempt.status === 'lobby') {
      const readyCount = attempt.readyUids?.length ?? 0;
      label = `Lobby (${readyCount}/${studentUids.length} Ready)`;
      statusClass = 'cohort-attempt-lobby';
    } else if (attempt.status === 'in_progress') {
      label = 'In Progress';
      statusClass = 'cohort-attempt-active';
    } else if (attempt.results) {
      label = `${attempt.status === 'expired' ? 'Expired' : 'Submitted'}: ${attempt.results.totalScore}/${attempt.results.maxPossibleScore} pts`;
      statusClass = 'cohort-attempt-done';
    } else {
      label = attempt.status;
      statusClass = 'cohort-attempt-done';
    }

    return (
      <div className="cohort-attempt-bar">
        <span className={`cohort-attempt-badge ${statusClass}`}>{label}</span>
        {confirmResetId === attemptId ? (
          <div className="cohort-reset-confirm">
            <span>Reset run?</span>
            <button
              type="button"
              className="btn-cohort-danger"
              onClick={() => void handleResetAttempt(attemptId)}
            >
              Yes, Reset
            </button>
            <button
              type="button"
              className="btn-cohort-mini"
              onClick={() => setConfirmResetId(null)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-cohort-mini"
            onClick={() => setConfirmResetId(attemptId)}
            title="Delete this team's attempt so they can start fresh"
          >
            Reset Attempt
          </button>
        )}
      </div>
    );
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      ariaLabelledBy="cohort-modal-title"
      backdropClassName="briefing-modal-backdrop"
      dialogClassName="cohort-modal-card"
    >
      <div className="cohort-modal-header">
        <div>
          <h2 id="cohort-modal-title" className="cohort-modal-title">
            ⚙️ Configure Test & Teams
          </h2>
          <p className="cohort-modal-subtitle">{testPacket.title}</p>
        </div>
        <button type="button" className="btn-simple btn-cohort-close" onClick={onClose}>
          ✕
        </button>
      </div>

      {/* 1. Visibility Toggle */}
      <label className="cohort-visibility-row">
        <div className="cohort-visibility-info">
          <span className="cohort-visibility-label">
            {isActive ? '🟢 Active — Visible to Students' : '🔒 Draft — Hidden from Students'}
          </span>
          <span className="cohort-visibility-hint">
            Teachers can always view and preview inactive tests.
          </span>
        </div>
        <input
          type="checkbox"
          className="cohort-active-checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
      </label>

      {/* 2. Cohorts & Unassigned Roster */}
      <div className="cohort-modal-body">
        <div className="cohort-toolbar">
          <span className="cohort-section-heading">
            Student Teams ({cohorts.length})
          </span>
          <div className="cohort-toolbar-actions">
            <button
              type="button"
              className="btn-simple btn-cohort-action"
              onClick={handleAutoPair}
              disabled={unassignedProfiles.length === 0}
              title="Automatically pair unassigned students in groups of 2"
            >
              ⚡ Auto-Pair ({unassignedProfiles.length})
            </button>
            <button
              type="button"
              className="btn-simple btn-cohort-action"
              onClick={handleAddCohort}
            >
              + Add Team
            </button>
          </div>
        </div>

        {cohorts.length === 0 ? (
          <div className="cohort-empty-box">
            No teams configured. Unassigned users take this test individually, or click{' '}
            <strong>+ Add Team</strong> / <strong>⚡ Auto-Pair</strong> to form collaborative groups.
          </div>
        ) : (
          <div className="cohort-groups-list">
            {cohorts.map((cohort, idx) => {
              const isSelected = cohort.id === selectedCohortId;
              return (
                <div
                  key={cohort.id}
                  className={`cohort-group-card ${isSelected ? 'cohort-group-selected' : ''}`}
                  onClick={() => setSelectedCohortId(cohort.id)}
                >
                  <div className="cohort-group-header">
                    <input
                      type="text"
                      className="cohort-name-input"
                      value={cohort.name ?? ''}
                      placeholder={`Team ${idx + 1}`}
                      maxLength={40}
                      onChange={(e) => handleRenameCohort(cohort.id, e.target.value)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCohortId(cohort.id);
                      }}
                      aria-label={`Team ${idx + 1} name`}
                    />
                    <button
                      type="button"
                      className="btn-cohort-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveCohort(cohort.id);
                      }}
                      title="Remove team"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="cohort-members-chips">
                    {cohort.studentUids.length === 0 ? (
                      <span className="cohort-empty-hint">
                        Click students below to add to this team...
                      </span>
                    ) : (
                      cohort.studentUids.map((uid) => {
                        const prof = profileByUid.get(uid);
                        const name = prof?.displayName || uid.slice(0, 8);
                        return (
                          <span key={uid} className="cohort-member-chip">
                            <span>{name}</span>
                            <button
                              type="button"
                              className="chip-remove-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUnassignUser(cohort.id, uid);
                              }}
                              aria-label={`Remove ${name}`}
                            >
                              ✕
                            </button>
                          </span>
                        );
                      })
                    )}
                  </div>

                  {renderAttemptStatus(cohort.studentUids)}
                </div>
              );
            })}
          </div>
        )}

        {/* Unassigned Pool */}
        <div className="cohort-unassigned-section">
          <div className="cohort-unassigned-header">
            <span className="cohort-section-heading">
              Unassigned Roster ({unassignedProfiles.length})
            </span>
            <label className="cohort-include-teachers">
              <input
                type="checkbox"
                checked={includeTeachers}
                onChange={(e) => setIncludeTeachers(e.target.checked)}
              />
              <span>Include teachers</span>
            </label>
          </div>

          {unassignedProfiles.length === 0 ? (
            <p className="cohort-empty-hint">
              All signed-in students are assigned to a team (new students appear here once they sign in).
            </p>
          ) : (
            <div className="cohort-unassigned-pool">
              {unassignedProfiles.map((prof) => (
                <button
                  key={prof.uid}
                  type="button"
                  className="cohort-unassigned-chip"
                  onClick={() => handleAssignUser(prof.uid)}
                  title="Add to selected team"
                >
                  + {prof.displayName}
                  {prof.role === 'teacher' ? ' (Teacher)' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {errorMsg && <div className="cohort-error-banner">⚠️ {errorMsg}</div>}

      <div className="cohort-modal-footer">
        <button type="button" className="btn-simple" onClick={onClose} disabled={isSaving}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-main-action"
          onClick={() => void handleSave()}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Settings ✓'}
        </button>
      </div>
    </Modal>
  );
};
