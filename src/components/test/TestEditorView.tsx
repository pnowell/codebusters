import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LookupCipherType,
  PublicProfile,
  Quote,
  QuoteCategory,
  QuoteFlag,
  TestAttempt,
  TestCohort,
  TestPacket,
  TestQuestion,
} from '../../types';
import type { TestEditorTab } from '../../utils/routing';
import {
  getQuoteById,
  MAX_LOOKUP_LENGTH,
  pickRandomCleanLookupQuote,
} from '../../data/quotes';
import {
  getQuoteFlagsMap,
  subscribeQuoteFlags,
} from '../../services/quoteFlagService';
import {
  fetchStudentQuoteCompletions,
  getCachedStudentQuoteCompletions,
} from '../../services/quoteCompletionService';
import { subscribeTeamProfiles } from '../../services/profileService';
import {
  deleteTestAttempt,
  deleteTestPacketAndAttempts,
  generateUniqueTestId,
  saveTestPacket,
  subscribeAttemptsForTest,
} from '../../services/testService';
import { getCohortAttemptId, normalizeUidList } from '../../utils/testSync';
import { Modal } from '../common/Modal';
import { QuoteTileGrid } from '../drills/shared/QuoteTileGrid';
import { QuoteBrowserPanel } from '../quotes/QuoteBrowserPanel';

interface EditableQuestion {
  uid: string;
  cipher: LookupCipherType;
  quoteId: number;
  points: number;
  isTiebreaker: boolean;
  description: string;
}

export interface TestEditorViewProps {
  mode: 'create' | 'edit';
  initialPacket?: TestPacket;
  existingTests: TestPacket[];
  initialTab?: TestEditorTab;
  onTabChange?: (tab: TestEditorTab) => void;
  onBack: () => void;
  onSaved: (savedTestId: string) => void;
  onDuplicate?: (draftTemplate: TestPacket) => void;
  onDeleted: () => void;
}

const CIPHER_OPTIONS: { id: LookupCipherType; label: string; promptName: string }[] = [
  { id: 'atbash', label: 'Atbash', promptName: 'Atbash Cipher' },
  { id: 'pigpen', label: 'Pigpen', promptName: 'Pigpen Cipher' },
  { id: 'galactic', label: 'Galactic', promptName: 'Standard Galactic Alphabet' },
];

const CATEGORY_SHORT_LABELS: Record<QuoteCategory, string> = {
  kid_joke: 'Joke',
  kid_science: 'Science',
  kid_book: 'Book',
  kid_movie: 'Movie',
  kid_lyric: 'Lyric',
  general: 'General',
};

const DEFAULT_DESCRIPTION =
  'Science Olympiad Codebusters practice packet. Up to 2 letter errors on a question still earn Full Credit!';

const EMPTY_INPUTS: string[] = [];
const NOOP_INPUTS = () => {};

function createClientUid(prefix: string, seq: number): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : String(Date.now() % 100000);
  return `${prefix}-${rand}-${seq}`;
}

function buildAutoPrompt(
  cipher: LookupCipherType,
  isTiebreaker: boolean,
  author?: string
): string {
  const cipherMeta =
    CIPHER_OPTIONS.find((c) => c.id === cipher)?.promptName ?? 'Cipher';
  const prefix = isTiebreaker ? '[Tiebreaker] ' : '';
  const byline =
    author && author.trim() && author.trim().toLowerCase() !== 'unknown'
      ? ` attributed to ${author.trim()}`
      : '';
  return `${prefix}Decode this ${cipherMeta} message${byline}.`;
}

function buildStarterQuestions(existingTests: readonly TestPacket[]): EditableQuestion[] {
  const used = new Set<number>();
  for (const t of existingTests) {
    for (const q of t.questions) {
      used.add(q.quoteId);
    }
  }
  for (const [quoteId, students] of getCachedStudentQuoteCompletions().entries()) {
    if (students.length > 0) {
      used.add(quoteId);
    }
  }
  const ciphers: LookupCipherType[] = ['atbash', 'pigpen', 'galactic'];
  return ciphers.map((cipher, idx) => {
    const picked = pickRandomCleanLookupQuote(used);
    used.add(picked.id);
    return {
      uid: createClientUid('q', idx + 1),
      cipher,
      quoteId: picked.id,
      points: 150,
      isTiebreaker: false,
      description: buildAutoPrompt(cipher, false, picked.author),
    };
  });
}

function serializeDraftSnapshot(params: {
  title: string;
  description: string;
  timeLimitMinutes: number;
  isActive: boolean;
  questions: EditableQuestion[];
  cohorts: TestCohort[];
}): string {
  return JSON.stringify({
    title: params.title.trim(),
    description: params.description.trim(),
    timeLimitMinutes: Math.round(params.timeLimitMinutes),
    isActive: Boolean(params.isActive),
    questions: params.questions.map((q) => ({
      cipher: q.cipher,
      quoteId: q.quoteId,
      points: Math.round(q.points),
      isTiebreaker: Boolean(q.isTiebreaker),
      description: q.description.trim(),
    })),
    cohorts: params.cohorts
      .map((c) => ({
        id: c.id,
        name: (c.name ?? '').trim(),
        studentUids: normalizeUidList(c.studentUids),
      }))
      .filter((c) => c.studentUids.length > 0),
  });
}

export const TestEditorView: React.FC<TestEditorViewProps> = ({
  mode,
  initialPacket,
  existingTests,
  initialTab = 'questions',
  onTabChange,
  onBack,
  onSaved,
  onDuplicate,
  onDeleted,
}) => {
  const isEditMode = mode === 'edit' && Boolean(initialPacket?.testId);
  const editingTestId = isEditMode ? initialPacket!.testId : null;

  const [activeTab, setActiveTab] = useState<TestEditorTab>(initialTab);
  const qSeqRef = useRef<number>((initialPacket?.questions.length ?? 3) + 1);
  const cohortSeqRef = useRef<number>((initialPacket?.cohorts?.length ?? 0) + 1);

  // Form state — Tab 1 (Details & Questions)
  const [title, setTitle] = useState<string>(() => initialPacket?.title ?? '');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number>(() =>
    initialPacket?.timeLimitSeconds
      ? Math.max(1, Math.round(initialPacket.timeLimitSeconds / 60))
      : 35
  );
  const [description, setDescription] = useState<string>(
    () => initialPacket?.description ?? DEFAULT_DESCRIPTION
  );
  const [questions, setQuestions] = useState<EditableQuestion[]>(() => {
    if (initialPacket && initialPacket.questions.length > 0) {
      return initialPacket.questions.map((q, idx) => ({
        uid: createClientUid('q', idx + 1),
        cipher: q.cipher,
        quoteId: q.quoteId,
        points: q.points,
        isTiebreaker: Boolean(q.isTiebreaker),
        description: q.description ?? '',
      }));
    }
    return buildStarterQuestions(existingTests);
  });

  // Form state — Tab 2 (Visibility, Teams & Attempts)
  const [isActive, setIsActive] = useState<boolean>(() =>
    isEditMode ? Boolean(initialPacket?.active) : false
  );
  const [cohorts, setCohorts] = useState<TestCohort[]>(() =>
    initialPacket?.cohorts && initialPacket.cohorts.length > 0
      ? initialPacket.cohorts.map((c) => ({
          id: c.id,
          name: c.name ?? '',
          studentUids: [...c.studentUids],
        }))
      : []
  );
  const [selectedCohortId, setSelectedCohortId] = useState<string | null>(
    () => initialPacket?.cohorts?.[0]?.id ?? null
  );
  const [includeTeachers, setIncludeTeachers] = useState<boolean>(false);

  // Subscriptions: Profiles, Attempts (edit mode), Quote Flags, and Student Completions
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [attemptsMap, setAttemptsMap] = useState<Record<string, TestAttempt>>({});
  const [flagsMap, setFlagsMap] = useState<ReadonlyMap<number, QuoteFlag>>(() =>
    getQuoteFlagsMap()
  );
  const [finishedByQuotesMap, setFinishedByQuotesMap] = useState<
    ReadonlyMap<number, string[]>
  >(() => getCachedStudentQuoteCompletions());
  const [usersReadBlocked, setUsersReadBlocked] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    void fetchStudentQuoteCompletions(existingTests).then((snapshot) => {
      if (cancelled) return;
      setFinishedByQuotesMap(snapshot.finishedByQuotesMap);
      setUsersReadBlocked(snapshot.usersReadBlocked);
    });
    return () => {
      cancelled = true;
    };
  }, [existingTests]);

  useEffect(() => {
    const unsubProfiles = subscribeTeamProfiles((list) => setProfiles(list));
    const unsubFlags = subscribeQuoteFlags((map) => setFlagsMap(new Map(map)));
    const unsubAttempts = editingTestId
      ? subscribeAttemptsForTest(editingTestId, (map) => setAttemptsMap(map))
      : () => {};

    return () => {
      unsubProfiles();
      unsubFlags();
      unsubAttempts();
    };
  }, [editingTestId]);

  // UI state: puzzle previews, quote picker overlay, confirmation modals, errors
  const [expandedPreviewUids, setExpandedPreviewUids] = useState<Set<string>>(
    () => new Set()
  );
  const [pickerQuestionUid, setPickerQuestionUid] = useState<string | null>(null);
  const [showDiscardModal, setShowDiscardModal] = useState<boolean>(false);
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);
  const [confirmResetAllOrphans, setConfirmResetAllOrphans] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Baseline snapshot for dirty-check
  const [initialSnapshot] = useState<string>(() =>
    serializeDraftSnapshot({
      title,
      description,
      timeLimitMinutes,
      isActive,
      questions,
      cohorts,
    })
  );

  const currentSnapshot = useMemo(
    () =>
      serializeDraftSnapshot({
        title,
        description,
        timeLimitMinutes,
        isActive,
        questions,
        cohorts,
      }),
    [title, description, timeLimitMinutes, isActive, questions, cohorts]
  );

  const isDirty =
    mode === 'create' ? Boolean(title.trim()) || currentSnapshot !== initialSnapshot : currentSnapshot !== initialSnapshot;

  // Detect whether cipher/quote/order changed relative to saved testPacket (for attempt safety warning)
  const questionsStructureChanged = useMemo(() => {
    if (!isEditMode || !initialPacket) return false;
    if (questions.length !== initialPacket.questions.length) return true;
    return questions.some((q, idx) => {
      const orig = initialPacket.questions[idx];
      return !orig || q.quoteId !== orig.quoteId || q.cipher !== orig.cipher;
    });
  }, [isEditMode, initialPacket, questions]);

  // Quote Picker browser-back integration
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (e.state?.modal !== 'quotePicker') {
        setPickerQuestionUid(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const openQuotePickerForQuestion = (questionUid: string) => {
    window.history.pushState(
      {
        ...(window.history.state || {}),
        modal: 'quotePicker',
      },
      '',
      window.location.href
    );
    setPickerQuestionUid(questionUid);
  };

  const closeQuotePicker = useCallback(() => {
    if (window.history.state?.modal === 'quotePicker') {
      window.history.back();
    } else {
      setPickerQuestionUid(null);
    }
  }, []);

  const handleSwitchTab = (tab: TestEditorTab) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  // Used quote tracking across current draft & other existing tests
  const duplicateQuoteIdsInDraft = useMemo(() => {
    const counts = new Map<number, number>();
    questions.forEach((q) => {
      counts.set(q.quoteId, (counts.get(q.quoteId) ?? 0) + 1);
    });
    const dupes = new Set<number>();
    counts.forEach((count, id) => {
      if (count > 1) dupes.add(id);
    });
    return dupes;
  }, [questions]);

  const usedInCurrentTestIds = useMemo(
    () => new Set(questions.map((q) => q.quoteId)),
    [questions]
  );

  const usedInOtherTestsByQuoteId = useMemo(() => {
    const map = new Map<number, string[]>();
    existingTests.forEach((t) => {
      if (editingTestId && t.testId === editingTestId) return;
      t.questions.forEach((q) => {
        const arr = map.get(q.quoteId);
        if (arr) {
          if (!arr.includes(t.title)) arr.push(t.title);
        } else {
          map.set(q.quoteId, [t.title]);
        }
      });
    });
    return map;
  }, [existingTests, editingTestId]);

  const freshQuoteExcludeIds = useMemo(() => {
    const exclude = new Set<number>(usedInCurrentTestIds);
    for (const quoteId of usedInOtherTestsByQuoteId.keys()) {
      exclude.add(quoteId);
    }
    for (const [quoteId, students] of finishedByQuotesMap.entries()) {
      if (students.length > 0) {
        exclude.add(quoteId);
      }
    }
    return exclude;
  }, [usedInCurrentTestIds, usedInOtherTestsByQuoteId, finishedByQuotesMap]);

  const totalPoints = useMemo(
    () => questions.reduce((sum, q) => sum + (Number.isFinite(q.points) ? q.points : 0), 0),
    [questions]
  );

  // Question CRUD helpers
  const handleAddQuestion = () => {
    const cycleCiphers: LookupCipherType[] = ['atbash', 'pigpen', 'galactic'];
    const nextCipher = cycleCiphers[questions.length % cycleCiphers.length];
    const picked = pickRandomCleanLookupQuote(freshQuoteExcludeIds);
    const uid = createClientUid('q', qSeqRef.current);
    qSeqRef.current += 1;

    setQuestions((prev) => [
      ...prev,
      {
        uid,
        cipher: nextCipher,
        quoteId: picked.id,
        points: 150,
        isTiebreaker: false,
        description: buildAutoPrompt(nextCipher, false, picked.author),
      },
    ]);
  };

  const handleUpdateQuestion = (
    uid: string,
    patch: Partial<Omit<EditableQuestion, 'uid'>>
  ) => {
    setQuestions((prev) =>
      prev.map((q) => (q.uid === uid ? { ...q, ...patch } : q))
    );
  };

  const handleMoveQuestion = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= questions.length) return;
    setQuestions((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(targetIdx, 0, moved);
      return copy;
    });
  };

  const handleRemoveQuestion = (uid: string) => {
    if (questions.length <= 1) return;
    setQuestions((prev) => prev.filter((q) => q.uid !== uid));
    setExpandedPreviewUids((prev) => {
      if (!prev.has(uid)) return prev;
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
  };

  const handlePickRandomForQuestion = (question: EditableQuestion) => {
    const picked = pickRandomCleanLookupQuote(freshQuoteExcludeIds);
    const prevQuote = getQuoteById(question.quoteId);
    const prevDefault = buildAutoPrompt(
      question.cipher,
      question.isTiebreaker,
      prevQuote?.author
    );
    const shouldRefreshPrompt =
      !question.description.trim() || question.description.trim() === prevDefault;

    handleUpdateQuestion(question.uid, {
      quoteId: picked.id,
      ...(shouldRefreshPrompt
        ? {
            description: buildAutoPrompt(
              question.cipher,
              question.isTiebreaker,
              picked.author
            ),
          }
        : {}),
    });
  };

  const handleSelectQuoteFromPicker = (picked: Quote) => {
    if (!pickerQuestionUid) return;
    const targetQ = questions.find((q) => q.uid === pickerQuestionUid);
    if (targetQ) {
      const prevQuote = getQuoteById(targetQ.quoteId);
      const prevDefault = buildAutoPrompt(
        targetQ.cipher,
        targetQ.isTiebreaker,
        prevQuote?.author
      );
      const shouldRefreshPrompt =
        !targetQ.description.trim() || targetQ.description.trim() === prevDefault;

      handleUpdateQuestion(targetQ.uid, {
        quoteId: picked.id,
        ...(shouldRefreshPrompt
          ? {
              description: buildAutoPrompt(
                targetQ.cipher,
                targetQ.isTiebreaker,
                picked.author
              ),
            }
          : {}),
      });
    }
    closeQuotePicker();
  };

  const toggleQuestionPreview = (uid: string) => {
    setExpandedPreviewUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  // Tab 2: Cohort & Roster helpers
  const nextCohortId = () => {
    const id = createClientUid('cohort', cohortSeqRef.current);
    cohortSeqRef.current += 1;
    return id;
  };

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
    setCohorts((prev) => [
      ...prev,
      { id: newId, name: `Team ${nextIndex}`, studentUids: [] },
    ]);
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

  const matchedAttemptIds = useMemo(() => {
    const ids = new Set<string>();
    if (!editingTestId) return ids;
    cohorts.forEach((c) => {
      if (c.studentUids.length > 0) {
        ids.add(getCohortAttemptId(editingTestId, c.studentUids));
      }
    });
    return ids;
  }, [cohorts, editingTestId]);

  const unmatchedAttempts = useMemo(() => {
    return Object.values(attemptsMap)
      .filter((att) => !matchedAttemptIds.has(att.attemptId))
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }, [attemptsMap, matchedAttemptIds]);

  const formatAttemptMembers = (uids: string[]): string => {
    if (uids.length === 0) return 'Unknown user';
    return uids
      .map((uid) => profileByUid.get(uid)?.displayName || uid.slice(0, 8))
      .join(' & ');
  };

  const handleResetAttempt = async (attemptId: string) => {
    setErrorMsg(null);
    const ok = await deleteTestAttempt(attemptId);
    if (!ok) {
      setErrorMsg('Failed to reset attempt. Check your connection or Firestore rules.');
    }
    setConfirmResetId(null);
  };

  const handleResetAllUnmatched = async () => {
    setErrorMsg(null);
    const results = await Promise.all(
      unmatchedAttempts.map((att) => deleteTestAttempt(att.attemptId))
    );
    if (results.some((ok) => !ok)) {
      setErrorMsg('Failed to reset one or more attempts.');
    }
    setConfirmResetAllOrphans(false);
    setConfirmResetId(null);
  };

  const getAttemptBadgeMeta = (attempt: TestAttempt, memberCount: number) => {
    if (attempt.status === 'lobby') {
      const readyCount = attempt.readyUids?.length ?? 0;
      return {
        label: `Lobby (${readyCount}/${Math.max(1, memberCount)} Ready)`,
        statusClass: 'cohort-attempt-lobby',
      };
    }
    if (attempt.status === 'in_progress') {
      return { label: 'In Progress', statusClass: 'cohort-attempt-active' };
    }
    if (attempt.results) {
      return {
        label: `${attempt.status === 'expired' ? 'Expired' : 'Submitted'}: ${attempt.results.totalScore}/${attempt.results.maxPossibleScore} pts`,
        statusClass: 'cohort-attempt-done',
      };
    }
    return { label: attempt.status, statusClass: 'cohort-attempt-done' };
  };

  const renderResetControl = (attemptId: string) => {
    if (confirmResetId === attemptId) {
      return (
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
      );
    }
    return (
      <button
        type="button"
        className="btn-cohort-mini"
        onClick={() => setConfirmResetId(attemptId)}
        title="Delete this attempt so they can start fresh"
      >
        Reset Attempt
      </button>
    );
  };

  // Save / Duplicate / Delete / Back handlers
  const handleBackClick = () => {
    if (isDirty) {
      setShowDiscardModal(true);
    } else {
      onBack();
    }
  };

  const buildCurrentTestPacket = (targetTestId: string): TestPacket => {
    const cleanedCohorts: TestCohort[] = cohorts
      .map((c) => ({
        id: c.id,
        ...(c.name && c.name.trim() ? { name: c.name.trim() } : {}),
        studentUids: normalizeUidList(c.studentUids),
      }))
      .filter((c) => c.studentUids.length > 0);

    const mappedQuestions: TestQuestion[] = questions.map((q, idx) => ({
      questionNumber: idx + 1,
      cipher: q.cipher,
      quoteId: q.quoteId,
      points: Math.max(0, Math.round(Number(q.points) || 0)),
      ...(q.isTiebreaker ? { isTiebreaker: true } : {}),
      ...(q.description.trim() ? { description: q.description.trim() } : {}),
    }));

    return {
      testId: targetTestId,
      title: title.trim(),
      description: description.trim(),
      timeLimitSeconds: Math.max(5, Math.min(180, Math.round(Number(timeLimitMinutes) || 35))) * 60,
      active: isActive,
      questions: mappedQuestions,
      cohorts: cleanedCohorts,
    };
  };

  const handleSave = async () => {
    setErrorMsg(null);
    if (!title.trim()) {
      setActiveTab('questions');
      setErrorMsg('Please enter a test title before saving.');
      return;
    }
    if (questions.length === 0) {
      setActiveTab('questions');
      setErrorMsg('Add at least one question before saving.');
      return;
    }

    const existingIds = new Set(existingTests.map((t) => t.testId));
    const targetTestId = editingTestId ?? generateUniqueTestId(title, existingIds);
    const packet = buildCurrentTestPacket(targetTestId);

    setIsSaving(true);
    const result = await saveTestPacket(packet, { isNew: !isEditMode });
    if (!result.ok) {
      setIsSaving(false);
      setErrorMsg(result.error ?? 'Could not save test.');
      return;
    }

    // Clean up orphaned or empty lobby attempts when editing an existing test
    if (editingTestId) {
      const savedCohortAttemptIds = new Set(
        (packet.cohorts ?? []).map((c) =>
          getCohortAttemptId(editingTestId, c.studentUids)
        )
      );
      const orphanedLobbies = Object.values(attemptsMap).filter(
        (att) =>
          att.status === 'lobby' &&
          (!savedCohortAttemptIds.has(att.attemptId) ||
            (att.readyUids?.length ?? 0) === 0)
      );
      if (orphanedLobbies.length > 0) {
        await Promise.all(
          orphanedLobbies.map((att) => deleteTestAttempt(att.attemptId))
        );
      }
    }

    setIsSaving(false);
    onSaved(result.testId ?? targetTestId);
  };

  const handleDuplicateClick = () => {
    if (!onDuplicate) return;
    const baseTitle = title.trim() || initialPacket?.title || 'Practice Test';
    const copyTitle = `Copy of ${baseTitle}`.slice(0, 80);
    const draft = buildCurrentTestPacket('new');
    onDuplicate({
      ...draft,
      title: copyTitle,
      active: false,
      cohorts: [],
    });
  };

  const handleConfirmDelete = async () => {
    if (!editingTestId) return;
    setIsDeleting(true);
    setErrorMsg(null);
    const result = await deleteTestPacketAndAttempts(editingTestId);
    setIsDeleting(false);
    if (!result.ok) {
      setShowDeleteModal(false);
      setErrorMsg(result.error ?? 'Failed to delete test.');
      return;
    }
    setShowDeleteModal(false);
    onDeleted();
  };

  const pickerTargetQuestion = pickerQuestionUid
    ? questions.find((q) => q.uid === pickerQuestionUid) ?? null
    : null;
  const pickerTargetIndex = pickerTargetQuestion
    ? questions.findIndex((q) => q.uid === pickerTargetQuestion.uid)
    : -1;

  const totalAttemptsCount = Object.keys(attemptsMap).length;

  return (
    <div className="test-editor-view">
      {/* 1. Sticky Top Header */}
      <header className="editor-top-header">
        <button
          type="button"
          className="btn-simple btn-tests-back"
          onClick={handleBackClick}
          disabled={isSaving || isDeleting}
        >
          ← Practice Tests
        </button>

        <div className="editor-header-title-group">
          <div className="editor-header-title-row">
            <h2 className="editor-header-title">
              {title.trim() || (isEditMode ? 'Edit Practice Test' : 'New Practice Test')}
            </h2>
            <button
              type="button"
              className={`editor-status-pill ${isActive ? 'active' : 'draft'}`}
              onClick={() => setIsActive((prev) => !prev)}
              title="Click to toggle Active / Draft visibility"
            >
              {isActive ? '🟢 Active' : '🔒 Draft'}
            </button>
          </div>
          <span className="editor-header-subtitle">
            {isEditMode ? `ID: ${editingTestId}` : 'Unsaved New Test'} ·{' '}
            {questions.length} Qs · {totalPoints} pts · {timeLimitMinutes} min
          </span>
        </div>

        <div className="editor-header-actions">
          {isEditMode && onDuplicate && (
            <button
              type="button"
              className="btn-simple editor-btn-secondary"
              onClick={handleDuplicateClick}
              disabled={isSaving || isDeleting}
              title="Create a new draft test with these questions"
            >
              📋 Duplicate
            </button>
          )}

          {isEditMode && (
            <button
              type="button"
              className="btn-simple editor-btn-delete"
              onClick={() => setShowDeleteModal(true)}
              disabled={isSaving || isDeleting}
              title="Delete this practice test and all attempts"
            >
              🗑️ Delete
            </button>
          )}

          <button
            type="button"
            className="btn-main-action editor-btn-save"
            onClick={() => void handleSave()}
            disabled={isSaving || isDeleting}
          >
            {isSaving ? 'Saving...' : 'Save Test ✓'}
          </button>
        </div>
      </header>

      {/* 2. Tabs Bar */}
      <nav className="editor-tabs-bar" aria-label="Test Editor Sections">
        <button
          type="button"
          className={`editor-tab-btn ${activeTab === 'questions' ? 'active' : ''}`}
          onClick={() => handleSwitchTab('questions')}
        >
          📝 Details & Questions ({questions.length})
        </button>
        <button
          type="button"
          className={`editor-tab-btn ${activeTab === 'teams' ? 'active' : ''}`}
          onClick={() => handleSwitchTab('teams')}
        >
          👥 Visibility, Teams & Attempts
          {cohorts.length > 0 ? ` (${cohorts.length})` : ''}
          {totalAttemptsCount > 0 ? ` · ${totalAttemptsCount} runs` : ''}
        </button>
      </nav>

      {errorMsg && <div className="editor-error-banner">⚠️ {errorMsg}</div>}

      {/* 3. Main Scrollable Body */}
      <main className="test-editor-scroll-body">
        {activeTab === 'questions' ? (
          <div className="editor-tab-content">
            {isEditMode && totalAttemptsCount > 0 && questionsStructureChanged && (
              <div className="editor-attempts-warning">
                <div>
                  <strong>⚠️ {totalAttemptsCount} existing attempt(s) recorded:</strong>{' '}
                  Changing quotes, ciphers, or question order affects how existing
                  student workspaces and results line up. Consider resetting attempts
                  or duplicating into a new test.
                </div>
                <div className="editor-warning-actions">
                  <button
                    type="button"
                    className="btn-cohort-mini"
                    onClick={() => handleSwitchTab('teams')}
                  >
                    Manage / Reset Attempts →
                  </button>
                  {onDuplicate && (
                    <button
                      type="button"
                      className="btn-cohort-mini"
                      onClick={handleDuplicateClick}
                    >
                      📋 Duplicate Instead
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Test Metadata Card */}
            <section className="editor-section-card">
              <div className="editor-meta-grid">
                <div className="editor-field editor-field-grow">
                  <label className="editor-label" htmlFor="test-title-input">
                    Test Title *
                  </label>
                  <input
                    id="test-title-input"
                    type="text"
                    className="editor-input"
                    placeholder="e.g., Invitational Practice Packet A"
                    maxLength={80}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div className="editor-field editor-field-time">
                  <label className="editor-label" htmlFor="test-time-input">
                    Time Limit (Mins)
                  </label>
                  <input
                    id="test-time-input"
                    type="number"
                    min={5}
                    max={120}
                    step={5}
                    className="editor-input"
                    value={timeLimitMinutes}
                    onChange={(e) =>
                      setTimeLimitMinutes(
                        Math.max(1, Math.min(180, Number(e.target.value) || 0))
                      )
                    }
                  />
                </div>
              </div>

              <div className="editor-field">
                <label className="editor-label" htmlFor="test-desc-input">
                  Briefing Description / Instructions
                </label>
                <textarea
                  id="test-desc-input"
                  className="editor-textarea"
                  rows={2}
                  maxLength={400}
                  placeholder="Instructions displayed on the pre-test briefing screen..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </section>

            {/* Questions Toolbar */}
            <div className="editor-questions-toolbar">
              <div className="editor-questions-summary">
                <h3>Questions ({questions.length})</h3>
                <span className="editor-points-pill">
                  Total Score: {totalPoints} pts
                </span>
              </div>

              <button
                type="button"
                className="btn-simple editor-btn-add-q"
                onClick={handleAddQuestion}
              >
                + Add Question
              </button>
            </div>

            {/* Question Cards List */}
            <div className="editor-questions-list">
              {questions.map((q, idx) => {
                const quote = getQuoteById(q.quoteId);
                const flagEntry = flagsMap.get(q.quoteId);
                const isDupeInDraft = duplicateQuoteIdsInDraft.has(q.quoteId);
                const otherTests = usedInOtherTestsByQuoteId.get(q.quoteId);
                const finishedStudents = finishedByQuotesMap.get(q.quoteId);
                const isPreviewOpen = expandedPreviewUids.has(q.uid);
                const cat: QuoteCategory = quote?.category ?? 'general';

                return (
                  <article key={q.uid} className="editor-question-card">
                    {/* Card Header: Q# + Cipher Picker + Points + Tiebreaker + Reorder/Delete */}
                    <div className="editor-q-header">
                      <div className="editor-q-header-left">
                        <span className="editor-q-num">Q{idx + 1}</span>

                        <div
                          className="editor-cipher-segmented"
                          role="group"
                          aria-label={`Question ${idx + 1} cipher`}
                        >
                          {CIPHER_OPTIONS.map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              className={`editor-cipher-seg-btn ${
                                q.cipher === opt.id ? 'active' : ''
                              }`}
                              onClick={() => {
                                const prevDefault = buildAutoPrompt(
                                  q.cipher,
                                  q.isTiebreaker,
                                  quote?.author
                                );
                                const shouldRefreshPrompt =
                                  !q.description.trim() ||
                                  q.description.trim() === prevDefault;
                                handleUpdateQuestion(q.uid, {
                                  cipher: opt.id,
                                  ...(shouldRefreshPrompt
                                    ? {
                                        description: buildAutoPrompt(
                                          opt.id,
                                          q.isTiebreaker,
                                          quote?.author
                                        ),
                                      }
                                    : {}),
                                });
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="editor-q-header-right">
                        <label className="editor-pts-label">
                          <span>Pts</span>
                          <input
                            type="number"
                            min={0}
                            max={5000}
                            step={25}
                            className="editor-pts-input"
                            value={q.points}
                            onChange={(e) =>
                              handleUpdateQuestion(q.uid, {
                                points: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            aria-label={`Question ${idx + 1} points`}
                          />
                        </label>

                        <button
                          type="button"
                          className={`editor-tb-toggle ${
                            q.isTiebreaker ? 'active' : ''
                          }`}
                          onClick={() => {
                            const nextTb = !q.isTiebreaker;
                            const prevDefault = buildAutoPrompt(
                              q.cipher,
                              q.isTiebreaker,
                              quote?.author
                            );
                            const shouldRefreshPrompt =
                              !q.description.trim() ||
                              q.description.trim() === prevDefault;
                            handleUpdateQuestion(q.uid, {
                              isTiebreaker: nextTb,
                              ...(shouldRefreshPrompt
                                ? {
                                    description: buildAutoPrompt(
                                      q.cipher,
                                      nextTb,
                                      quote?.author
                                    ),
                                  }
                                : {}),
                            });
                          }}
                          title="Mark question as Tiebreaker"
                        >
                          ★ TB
                        </button>

                        <div className="editor-q-move-group">
                          <button
                            type="button"
                            className="editor-icon-btn"
                            disabled={idx === 0}
                            onClick={() => handleMoveQuestion(idx, -1)}
                            title="Move question up"
                            aria-label={`Move question ${idx + 1} up`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="editor-icon-btn"
                            disabled={idx === questions.length - 1}
                            onClick={() => handleMoveQuestion(idx, 1)}
                            title="Move question down"
                            aria-label={`Move question ${idx + 1} down`}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="editor-icon-btn danger"
                            disabled={questions.length <= 1}
                            onClick={() => handleRemoveQuestion(q.uid)}
                            title={
                              questions.length <= 1
                                ? 'A test must have at least one question'
                                : 'Remove question'
                            }
                            aria-label={`Remove question ${idx + 1}`}
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Selected Quote Box */}
                    <div className="editor-quote-box">
                      <div className="editor-quote-meta-row">
                        <div className="qb-meta-badges">
                          <span className="qb-id-badge">#{q.quoteId}</span>
                          {quote && (
                            <>
                              <span className={`qb-cat-badge qb-cat-${cat}`}>
                                {CATEGORY_SHORT_LABELS[cat]}
                              </span>
                              <span
                                className={`qb-stat-pill ${
                                  quote.length > MAX_LOOKUP_LENGTH
                                    ? 'qb-stat-long'
                                    : ''
                                }`}
                              >
                                {quote.length} chars
                              </span>
                              <span className="qb-stat-pill">
                                MinW: {quote.minWordLength}
                              </span>
                              <span className="qb-stat-pill">
                                χ² {quote.chi.toFixed(1)}
                              </span>
                            </>
                          )}
                          {flagEntry && (
                            <span
                              className="qb-warn-pill"
                              title={flagEntry.note ?? 'Flagged in Quote Browser'}
                            >
                              🚩 Flagged
                            </span>
                          )}
                          {isDupeInDraft && (
                            <span className="qb-warn-pill">
                              ⚠️ Duplicate Quote in Test
                            </span>
                          )}
                          {otherTests && otherTests.length > 0 && (
                            <span
                              className="qb-used-pill"
                              title={`Also used in: ${otherTests.join(', ')}`}
                            >
                              📝 Used in Tests
                            </span>
                          )}
                          {finishedStudents && finishedStudents.length > 0 && (
                            <span
                              className="qb-finished-pill"
                              title={`Completed by: ${finishedStudents.join(', ')}`}
                            >
                              ✓ {finishedStudents.length} Finished
                            </span>
                          )}
                        </div>

                        <div className="editor-quote-actions">
                          <button
                            type="button"
                            className="btn-simple editor-btn-quote-pick"
                            onClick={() => openQuotePickerForQuestion(q.uid)}
                          >
                            🔍 Browse Quotes…
                          </button>
                          <button
                            type="button"
                            className="btn-simple editor-btn-quote-rand"
                            onClick={() => handlePickRandomForQuestion(q)}
                            title="Pick a random clean, unflagged quote"
                          >
                            🎲 Random Quote
                          </button>
                        </div>
                      </div>

                      {quote ? (
                        <>
                          <div className="editor-quote-plaintext">{quote.quote}</div>
                          <div className="editor-quote-author">— {quote.author}</div>
                        </>
                      ) : (
                        <div className="editor-quote-missing">
                          ⚠️ Quote #{q.quoteId} was not found in quotes.json. Please
                          choose another quote.
                        </div>
                      )}
                    </div>

                    {/* Question Prompt & Puzzle Preview Toggle */}
                    <div className="editor-q-prompt-row">
                      <input
                        type="text"
                        className="editor-input editor-prompt-input"
                        placeholder="Optional question prompt (e.g., Decode this Pigpen Cipher quote...)"
                        maxLength={200}
                        value={q.description}
                        onChange={(e) =>
                          handleUpdateQuestion(q.uid, { description: e.target.value })
                        }
                        aria-label={`Question ${idx + 1} prompt`}
                      />
                      <button
                        type="button"
                        className="btn-simple editor-btn-autoprompt"
                        onClick={() =>
                          handleUpdateQuestion(q.uid, {
                            description: buildAutoPrompt(
                              q.cipher,
                              q.isTiebreaker,
                              quote?.author
                            ),
                          })
                        }
                        title="Fill default prompt for selected cipher and author"
                      >
                        ✨ Auto-Prompt
                      </button>
                      {quote && (
                        <button
                          type="button"
                          className={`btn-simple editor-btn-preview ${
                            isPreviewOpen ? 'active' : ''
                          }`}
                          onClick={() => toggleQuestionPreview(q.uid)}
                        >
                          {isPreviewOpen ? '🙈 Hide Preview' : '👁️ Preview Puzzle'}
                        </button>
                      )}
                    </div>

                    {isPreviewOpen && quote && (
                      <div className="editor-puzzle-preview">
                        <QuoteTileGrid
                          cipher={q.cipher}
                          quote={quote}
                          userInputs={EMPTY_INPUTS}
                          onChangeUserInputs={NOOP_INPUTS}
                          disabled={true}
                        />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            <div className="editor-bottom-add-row">
              <button
                type="button"
                className="btn-simple editor-btn-add-q-wide"
                onClick={handleAddQuestion}
              >
                + Add Another Question
              </button>
            </div>
          </div>
        ) : (
          /* Tab 2: Visibility, Teams & Attempts */
          <div className="editor-tab-content">
            <label className="cohort-visibility-row editor-visibility-card">
              <div className="cohort-visibility-info">
                <span className="cohort-visibility-label">
                  {isActive
                    ? '🟢 Active — Visible to Students'
                    : '🔒 Draft — Hidden from Students'}
                </span>
                <span className="cohort-visibility-hint">
                  Teachers can always view, preview, and test inactive drafts before
                  publishing them to students.
                </span>
              </div>
              <input
                type="checkbox"
                className="cohort-active-checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
            </label>

            <section className="editor-section-card editor-cohorts-card">
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
                  No teams configured. Unassigned users take this test individually,
                  or click <strong>+ Add Team</strong> / <strong>⚡ Auto-Pair</strong>{' '}
                  to form collaborative groups.
                </div>
              ) : (
                <div className="cohort-groups-list">
                  {cohorts.map((cohort, idx) => {
                    const isSelected = cohort.id === selectedCohortId;
                    const attempt =
                      editingTestId && cohort.studentUids.length > 0
                        ? attemptsMap[
                            getCohortAttemptId(editingTestId, cohort.studentUids)
                          ]
                        : undefined;
                    return (
                      <div
                        key={cohort.id}
                        className={`cohort-group-card ${
                          isSelected ? 'cohort-group-selected' : ''
                        }`}
                        onClick={() => setSelectedCohortId(cohort.id)}
                      >
                        <div className="cohort-group-header">
                          <input
                            type="text"
                            className="cohort-name-input"
                            value={cohort.name ?? ''}
                            placeholder={`Team ${idx + 1}`}
                            maxLength={40}
                            onChange={(e) =>
                              handleRenameCohort(cohort.id, e.target.value)
                            }
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
                              Click students in the roster below to add to this team...
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

                        {attempt && (
                          <div className="cohort-attempt-bar">
                            <span
                              className={`cohort-attempt-badge ${
                                getAttemptBadgeMeta(
                                  attempt,
                                  cohort.studentUids.length
                                ).statusClass
                              }`}
                            >
                              {
                                getAttemptBadgeMeta(
                                  attempt,
                                  cohort.studentUids.length
                                ).label
                              }
                            </span>
                            {renderResetControl(attempt.attemptId)}
                          </div>
                        )}
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
                    All signed-in students are assigned to a team (new students
                    appear here once they sign in).
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

              {/* Unmatched Solo or Previous Team Attempts */}
              {isEditMode && unmatchedAttempts.length > 0 && (
                <div className="cohort-orphan-section">
                  <div className="cohort-unassigned-header">
                    <span className="cohort-section-heading">
                      Other / Previous Attempts ({unmatchedAttempts.length})
                    </span>
                    {unmatchedAttempts.length > 1 &&
                      (confirmResetAllOrphans ? (
                        <div className="cohort-reset-confirm">
                          <span>Reset all {unmatchedAttempts.length}?</span>
                          <button
                            type="button"
                            className="btn-cohort-danger"
                            onClick={() => void handleResetAllUnmatched()}
                          >
                            Yes, Reset All
                          </button>
                          <button
                            type="button"
                            className="btn-cohort-mini"
                            onClick={() => setConfirmResetAllOrphans(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn-cohort-mini"
                          onClick={() => setConfirmResetAllOrphans(true)}
                        >
                          Reset All ({unmatchedAttempts.length})
                        </button>
                      ))}
                  </div>

                  <div className="cohort-orphan-list">
                    {unmatchedAttempts.map((att) => {
                      const { label, statusClass } = getAttemptBadgeMeta(
                        att,
                        att.studentUids.length
                      );
                      const isSolo = att.studentUids.length <= 1;
                      return (
                        <div key={att.attemptId} className="cohort-orphan-row">
                          <div className="cohort-orphan-info">
                            <span className="cohort-orphan-names">
                              {formatAttemptMembers(att.studentUids)}
                            </span>
                            <span className="cohort-orphan-tag">
                              {isSolo ? 'Solo' : 'Previous Team'}
                            </span>
                            {att.status === 'lobby' && (
                              <span className="cohort-orphan-hint">
                                Auto-clears on Save
                              </span>
                            )}
                          </div>
                          <div className="cohort-orphan-actions">
                            <span
                              className={`cohort-attempt-badge ${statusClass}`}
                            >
                              {label}
                            </span>
                            {renderResetControl(att.attemptId)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* 4. Quote Picker Modal Overlay */}
      {pickerTargetQuestion && (
        <Modal
          isOpen={true}
          onClose={closeQuotePicker}
          ariaLabelledBy="quote-picker-modal-title"
          backdropClassName="briefing-modal-backdrop"
          dialogClassName="quote-picker-modal-card"
        >
          <div className="quote-picker-modal-header">
            <div>
              <h3 id="quote-picker-modal-title" className="cohort-modal-title">
                🔍 Choose Quote for Question {pickerTargetIndex + 1} (
                {CIPHER_OPTIONS.find((c) => c.id === pickerTargetQuestion.cipher)
                  ?.label ?? pickerTargetQuestion.cipher}
                )
              </h3>
              <p className="cohort-modal-subtitle">
                Select a quote for this puzzle, or flag problematic quotes as you
                browse.
              </p>
            </div>
            <button
              type="button"
              className="btn-simple btn-cohort-close"
              onClick={closeQuotePicker}
            >
              ✕
            </button>
          </div>

          <QuoteBrowserPanel
            mode="picker"
            selectedQuoteId={pickerTargetQuestion.quoteId}
            usedInCurrentTestIds={usedInCurrentTestIds}
            usedInTestsByQuoteId={usedInOtherTestsByQuoteId}
            finishedByQuotesMap={finishedByQuotesMap}
            usersReadBlocked={usersReadBlocked}
            onSelectQuote={handleSelectQuoteFromPicker}
          />
        </Modal>
      )}

      {/* 5. Discard Unsaved Changes Confirmation Modal */}
      {showDiscardModal && (
        <Modal
          isOpen={true}
          onClose={() => setShowDiscardModal(false)}
          ariaLabelledBy="discard-changes-title"
          dialogClassName="confirm-modal"
        >
          <h3 id="discard-changes-title" className="confirm-modal-title">
            Discard Unsaved Changes?
          </h3>
          <p className="confirm-modal-text">
            You have unsaved edits to this practice test. Leaving now will discard
            your changes.
          </p>
          <div className="confirm-modal-buttons">
            <button
              type="button"
              className="btn-simple"
              onClick={() => setShowDiscardModal(false)}
            >
              Keep Editing
            </button>
            <button
              type="button"
              className="btn-simple editor-btn-delete"
              onClick={() => {
                setShowDiscardModal(false);
                onBack();
              }}
            >
              Discard Changes
            </button>
          </div>
        </Modal>
      )}

      {/* 6. Delete Test Confirmation Modal */}
      {showDeleteModal && (
        <Modal
          isOpen={true}
          onClose={() => !isDeleting && setShowDeleteModal(false)}
          ariaLabelledBy="delete-test-title"
          dialogClassName="confirm-modal"
        >
          <h3 id="delete-test-title" className="confirm-modal-title">
            🗑️ Delete Practice Test?
          </h3>
          <p className="confirm-modal-text">
            Permanently delete <strong>{title.trim() || editingTestId}</strong>?
          </p>
          {totalAttemptsCount > 0 && (
            <div className="confirm-modal-warning">
              This will also permanently delete{' '}
              <strong>{totalAttemptsCount}</strong> recorded student/team
              attempt(s) on this test.
            </div>
          )}
          <p className="confirm-modal-text-sub">This action cannot be undone.</p>
          <div className="confirm-modal-buttons">
            <button
              type="button"
              className="btn-simple"
              disabled={isDeleting}
              onClick={() => setShowDeleteModal(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-simple editor-btn-delete-solid"
              disabled={isDeleting}
              onClick={() => void handleConfirmDelete()}
            >
              {isDeleting ? 'Deleting...' : 'Yes, Delete Test'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};
