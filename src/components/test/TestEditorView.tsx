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
  isAttemptStartedOrCompleted,
  saveTestPacket,
  subscribeAttemptsForTest,
} from '../../services/testService';
import {
  getQuestionPointGuidance,
  isPointsMatchingGuidance,
  suggestPointsForPacket,
} from '../../utils/pointGuidance';
import { getCohortAttemptId, normalizeUidList } from '../../utils/testSync';
import { Modal } from '../common/Modal';
import { QuoteTileGrid } from '../drills/shared/QuoteTileGrid';
import { QuoteBrowserPanel } from '../quotes/QuoteBrowserPanel';

interface EditableQuestion {
  uid: string;
  cipher: LookupCipherType;
  quoteId: number;
  points: number;
  isPointsManual: boolean;
  isTiebreaker: boolean;
  description: string;
}

type PendingExitAction =
  | { kind: 'back' }
  | { kind: 'duplicate' }
  | { kind: 'inspect'; attempt: TestAttempt };

export interface TestEditorViewProps {
  mode: 'create' | 'edit';
  initialPacket?: TestPacket;
  existingTests: TestPacket[];
  initialTab?: TestEditorTab;
  onTabChange?: (tab: TestEditorTab) => void;
  onInspectAttempt?: (attempt: TestAttempt) => void;
  onBack: () => void;
  onSaved: (savedTestId: string) => void;
  onDuplicate?: (draftTemplate: TestPacket) => void;
  onDeleted: () => void;
}

const CIPHER_OPTIONS: { id: LookupCipherType; label: string; promptName: string }[] = [
  { id: 'atbash', label: 'Atbash', promptName: 'Atbash Cipher' },
  { id: 'pigpen', label: 'Pigpen', promptName: 'Pigpen Cipher' },
  { id: 'galactic', label: 'Galactic', promptName: 'Standard Galactic Alphabet' },
  { id: 'tap', label: 'Tap Code', promptName: 'Tap Code Cipher' },
  { id: 'knights', label: 'Knights', promptName: 'Knights Templar Cipher' },
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
  const pickedItems = ciphers.map((cipher) => {
    const picked = pickRandomCleanLookupQuote(used);
    used.add(picked.id);
    return { cipher, quote: picked };
  });
  const suggestedScores = suggestPointsForPacket(pickedItems);

  return pickedItems.map(({ cipher, quote }, idx) => ({
    uid: createClientUid('q', idx + 1),
    cipher,
    quoteId: quote.id,
    points: suggestedScores[idx],
    isPointsManual: false,
    isTiebreaker: false,
    description: buildAutoPrompt(cipher, false, quote.author),
  }));
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
  initialTab,
  onTabChange,
  onInspectAttempt,
  onBack,
  onSaved,
  onDuplicate,
  onDeleted,
}) => {
  const isEditMode = mode === 'edit' && Boolean(initialPacket?.testId);
  const editingTestId = isEditMode ? initialPacket!.testId : null;

  const [activeTab, setActiveTab] = useState<TestEditorTab>(
    () => initialTab ?? (mode === 'create' ? 'questions' : 'teams')
  );
  const qSeqRef = useRef<number>((initialPacket?.questions.length ?? 3) + 1);
  const cohortSeqRef = useRef<number>((initialPacket?.cohorts?.length ?? 0) + 1);

  // Form state — Details & Questions
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
      return initialPacket.questions.map((q, idx) => {
        const quote = getQuoteById(q.quoteId);
        const guidance = getQuestionPointGuidance(q.cipher, quote, {
          questionIndex: idx,
        });
        return {
          uid: createClientUid('q', idx + 1),
          cipher: q.cipher,
          quoteId: q.quoteId,
          points: q.points,
          isPointsManual: !isPointsMatchingGuidance(q.points, guidance),
          isTiebreaker: Boolean(q.isTiebreaker),
          description: q.description ?? '',
        };
      });
    }
    return buildStarterQuestions(existingTests);
  });

  // Form state — Visibility, Teams & Attempts
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
  const [areProfilesLoaded, setAreProfilesLoaded] = useState<boolean>(false);
  const [attemptsMap, setAttemptsMap] = useState<Record<string, TestAttempt>>({});
  const [areAttemptsLoaded, setAreAttemptsLoaded] = useState<boolean>(
    () => !editingTestId
  );
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
    const unsubProfiles = subscribeTeamProfiles((list) => {
      setProfiles(list);
      setAreProfilesLoaded(true);
    });
    const unsubFlags = subscribeQuoteFlags((map) => setFlagsMap(new Map(map)));
    const unsubAttempts = editingTestId
      ? subscribeAttemptsForTest(
          editingTestId,
          (map) => {
            setAttemptsMap(map);
            setAreAttemptsLoaded(true);
          },
          undefined,
          {
            questions: initialPacket?.questions,
            getQuote: getQuoteById,
          }
        )
      : () => {};

    return () => {
      unsubProfiles();
      unsubFlags();
      unsubAttempts();
    };
  }, [editingTestId, initialPacket?.questions]);

  // UI state: puzzle previews, quote picker overlay, confirmation modals, errors
  const [expandedPreviewUids, setExpandedPreviewUids] = useState<Set<string>>(
    () => new Set()
  );
  const [pickerQuestionUid, setPickerQuestionUid] = useState<string | null>(null);
  const [pendingExitAction, setPendingExitAction] =
    useState<PendingExitAction | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);
  const [confirmResetAllOrphans, setConfirmResetAllOrphans] = useState<boolean>(false);
  const [confirmResetAllAttempts, setConfirmResetAllAttempts] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const profileByUid = useMemo(() => {
    const map = new Map<string, PublicProfile>();
    profiles.forEach((p) => map.set(p.uid, p));
    return map;
  }, [profiles]);

  const lockedAttempts = useMemo(
    () => Object.values(attemptsMap).filter(isAttemptStartedOrCompleted),
    [attemptsMap]
  );

  // Lock test content whenever any attempt has started or completed (fail-closed until loaded)
  const isContentLocked =
    isEditMode && (!areAttemptsLoaded || lockedAttempts.length > 0);

  // Lock Active -> Draft toggle if currently Active and any non-teacher has a started/completed attempt
  const hasStudentLockedAttempt = useMemo(
    () =>
      lockedAttempts.length > 0 &&
      (!areProfilesLoaded ||
        lockedAttempts.some((att) =>
          att.studentUids.some((uid) => profileByUid.get(uid)?.role !== 'teacher')
        )),
    [areProfilesLoaded, lockedAttempts, profileByUid]
  );

  const isVisibilityLocked =
    isEditMode &&
    Boolean(initialPacket?.active) &&
    (!areAttemptsLoaded || hasStudentLockedAttempt);

  const effectiveIsActive = isVisibilityLocked ? true : isActive;

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
        title: isContentLocked && initialPacket ? initialPacket.title : title,
        description:
          isContentLocked && initialPacket ? initialPacket.description : description,
        timeLimitMinutes:
          isContentLocked && initialPacket
            ? Math.max(1, Math.round(initialPacket.timeLimitSeconds / 60))
            : timeLimitMinutes,
        isActive: effectiveIsActive,
        questions,
        cohorts,
      }),
    [
      cohorts,
      description,
      effectiveIsActive,
      initialPacket,
      isContentLocked,
      questions,
      timeLimitMinutes,
      title,
    ]
  );

  const isDirty =
    mode === 'create'
      ? Boolean(title.trim()) || currentSnapshot !== initialSnapshot
      : currentSnapshot !== initialSnapshot;

  // Browser tab close / refresh protection when there are unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

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
    if (isContentLocked) return;
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

  const duplicatePointValuesInDraft = useMemo(() => {
    const counts = new Map<number, number>();
    questions.forEach((q) => {
      if (q.points > 0) {
        counts.set(q.points, (counts.get(q.points) ?? 0) + 1);
      }
    });
    const dupes = new Set<number>();
    counts.forEach((count, pts) => {
      if (count > 1) dupes.add(pts);
    });
    return dupes;
  }, [questions]);

  const packetSuggestedPoints = useMemo(
    () =>
      suggestPointsForPacket(
        questions.map((q) => ({
          cipher: q.cipher,
          quote: getQuoteById(q.quoteId),
        }))
      ),
    [questions]
  );

  const areAllPointsSuggested = useMemo(
    () =>
      questions.length > 0 &&
      questions.every((q, idx) => q.points === packetSuggestedPoints[idx]),
    [questions, packetSuggestedPoints]
  );

  // Question CRUD helpers (guarded by isContentLocked)
  const handleSuggestAllPoints = () => {
    if (isContentLocked) return;
    setQuestions((prev) => {
      const suggested = suggestPointsForPacket(
        prev.map((q) => ({
          cipher: q.cipher,
          quote: getQuoteById(q.quoteId),
        }))
      );
      return prev.map((q, idx) => ({
        ...q,
        points: suggested[idx],
        isPointsManual: false,
      }));
    });
  };

  const handleAddQuestion = () => {
    if (isContentLocked) return;
    const cycleCiphers = CIPHER_OPTIONS.map((c) => c.id);
    const nextCipher = cycleCiphers[questions.length % cycleCiphers.length];
    const picked = pickRandomCleanLookupQuote(freshQuoteExcludeIds);
    const uid = createClientUid('q', qSeqRef.current);
    qSeqRef.current += 1;

    setQuestions((prev) => {
      const otherPoints = prev.map((x) => x.points);
      const guidance = getQuestionPointGuidance(nextCipher, picked, {
        otherPoints,
        questionIndex: prev.length,
      });
      return [
        ...prev,
        {
          uid,
          cipher: nextCipher,
          quoteId: picked.id,
          points: guidance.suggested,
          isPointsManual: false,
          isTiebreaker: false,
          description: buildAutoPrompt(nextCipher, false, picked.author),
        },
      ];
    });
  };

  const handleUpdateQuestion = (
    uid: string,
    patch: Partial<Omit<EditableQuestion, 'uid'>>
  ) => {
    if (isContentLocked) return;
    setQuestions((prev) =>
      prev.map((q) => (q.uid === uid ? { ...q, ...patch } : q))
    );
  };

  const handleMoveQuestion = (index: number, direction: -1 | 1) => {
    if (isContentLocked) return;
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
    if (isContentLocked || questions.length <= 1) return;
    setQuestions((prev) => prev.filter((q) => q.uid !== uid));
    setExpandedPreviewUids((prev) => {
      if (!prev.has(uid)) return prev;
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
  };

  const handlePickRandomForQuestion = (question: EditableQuestion) => {
    if (isContentLocked) return;
    const picked = pickRandomCleanLookupQuote(freshQuoteExcludeIds);
    const prevQuote = getQuoteById(question.quoteId);
    const prevDefault = buildAutoPrompt(
      question.cipher,
      question.isTiebreaker,
      prevQuote?.author
    );
    const shouldRefreshPrompt =
      !question.description.trim() || question.description.trim() === prevDefault;

    const qIdx = Math.max(
      0,
      questions.findIndex((q) => q.uid === question.uid)
    );
    const otherPoints = questions
      .filter((q) => q.uid !== question.uid)
      .map((q) => q.points);
    const nextGuidance = getQuestionPointGuidance(question.cipher, picked, {
      otherPoints,
      questionIndex: qIdx,
    });

    handleUpdateQuestion(question.uid, {
      quoteId: picked.id,
      ...(!question.isPointsManual ? { points: nextGuidance.suggested } : {}),
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
    if (isContentLocked || !pickerQuestionUid) return;
    const targetIdx = questions.findIndex((q) => q.uid === pickerQuestionUid);
    const targetQ = targetIdx >= 0 ? questions[targetIdx] : undefined;
    if (targetQ) {
      const prevQuote = getQuoteById(targetQ.quoteId);
      const prevDefault = buildAutoPrompt(
        targetQ.cipher,
        targetQ.isTiebreaker,
        prevQuote?.author
      );
      const shouldRefreshPrompt =
        !targetQ.description.trim() || targetQ.description.trim() === prevDefault;

      const otherPoints = questions
        .filter((q) => q.uid !== targetQ.uid)
        .map((q) => q.points);
      const nextGuidance = getQuestionPointGuidance(targetQ.cipher, picked, {
        otherPoints,
        questionIndex: targetIdx,
      });

      handleUpdateQuestion(targetQ.uid, {
        quoteId: picked.id,
        ...(!targetQ.isPointsManual ? { points: nextGuidance.suggested } : {}),
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

  // Visibility, Teams & Attempts helpers
  const nextCohortId = () => {
    const id = createClientUid('cohort', cohortSeqRef.current);
    cohortSeqRef.current += 1;
    return id;
  };

  const lockedCohortIds = useMemo(() => {
    const ids = new Set<string>();
    if (!editingTestId) return ids;
    cohorts.forEach((c) => {
      if (
        c.studentUids.length > 0 &&
        isAttemptStartedOrCompleted(
          attemptsMap[getCohortAttemptId(editingTestId, c.studentUids)]
        )
      ) {
        ids.add(c.id);
      }
    });
    return ids;
  }, [attemptsMap, cohorts, editingTestId]);

  const effectiveSelectedCohortId = useMemo(() => {
    if (
      selectedCohortId &&
      !lockedCohortIds.has(selectedCohortId) &&
      cohorts.some((c) => c.id === selectedCohortId)
    ) {
      return selectedCohortId;
    }
    return cohorts.find((c) => !lockedCohortIds.has(c.id))?.id ?? null;
  }, [cohorts, lockedCohortIds, selectedCohortId]);

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
    if (lockedCohortIds.has(cohortId)) return;
    setCohorts((prev) => {
      const filtered = prev.filter((c) => c.id !== cohortId);
      if (selectedCohortId === cohortId) {
        setSelectedCohortId(
          filtered.find((c) => !lockedCohortIds.has(c.id))?.id ?? null
        );
      }
      return filtered;
    });
  };

  const handleRenameCohort = (cohortId: string, name: string) => {
    if (lockedCohortIds.has(cohortId)) return;
    setCohorts((prev) =>
      prev.map((c) => (c.id === cohortId ? { ...c, name } : c))
    );
  };

  const handleAssignUser = (uid: string) => {
    if (!effectiveSelectedCohortId) {
      const newId = nextCohortId();
      const nextNum = cohorts.length + 1;
      setCohorts((prev) => [
        ...prev,
        { id: newId, name: `Team ${nextNum}`, studentUids: [uid] },
      ]);
      setSelectedCohortId(newId);
      return;
    }
    setCohorts((prev) =>
      prev.map((c) =>
        c.id === effectiveSelectedCohortId &&
        !lockedCohortIds.has(c.id) &&
        !c.studentUids.includes(uid)
          ? { ...c, studentUids: [...c.studentUids, uid] }
          : c
      )
    );
  };

  const handleUnassignUser = (cohortId: string, uid: string) => {
    if (lockedCohortIds.has(cohortId)) return;
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
    let firstCreatedId: string | null = null;
    for (let i = 0; i < unassignedProfiles.length; i += 2) {
      const pair = unassignedProfiles.slice(i, i + 2).map((p) => p.uid);
      const id = nextCohortId();
      if (!firstCreatedId) firstCreatedId = id;
      newCohorts.push({
        id,
        name: `Team ${baseIdx}`,
        studentUids: pair,
      });
      baseIdx += 1;
    }
    setCohorts(newCohorts);
    if (!effectiveSelectedCohortId && firstCreatedId) {
      setSelectedCohortId(firstCreatedId);
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

  const handleResetAllAttempts = async () => {
    setErrorMsg(null);
    const allAttempts = Object.values(attemptsMap);
    const results = await Promise.all(
      allAttempts.map((att) => deleteTestAttempt(att.attemptId))
    );
    if (results.some((ok) => !ok)) {
      setErrorMsg('Failed to reset one or more attempts.');
    }
    setConfirmResetAllAttempts(false);
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
        <div
          className="cohort-reset-confirm"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <span>Reset run?</span>
          <button
            type="button"
            className="btn-cohort-danger"
            onClick={(e) => {
              e.stopPropagation();
              void handleResetAttempt(attemptId);
            }}
          >
            Yes, Reset
          </button>
          <button
            type="button"
            className="btn-cohort-mini"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmResetId(null);
            }}
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
        onClick={(e) => {
          e.stopPropagation();
          setConfirmResetId(attemptId);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        title="Delete this attempt so they can start fresh"
      >
        Reset Attempt
      </button>
    );
  };

  const buildCurrentTestPacket = (targetTestId: string): TestPacket => {
    const cleanedCohorts: TestCohort[] = cohorts
      .map((c) => ({
        id: c.id,
        ...(c.name && c.name.trim() ? { name: c.name.trim() } : {}),
        studentUids: normalizeUidList(c.studentUids),
      }))
      .filter((c) => c.studentUids.length > 0);

    if (isContentLocked && initialPacket) {
      return {
        testId: targetTestId,
        title: initialPacket.title,
        description: initialPacket.description,
        timeLimitSeconds: initialPacket.timeLimitSeconds,
        active: effectiveIsActive,
        questions: initialPacket.questions,
        cohorts: cleanedCohorts,
      };
    }

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
      timeLimitSeconds:
        Math.max(5, Math.min(180, Math.round(Number(timeLimitMinutes) || 35))) * 60,
      active: effectiveIsActive,
      questions: mappedQuestions,
      cohorts: cleanedCohorts,
    };
  };

  const performDuplicate = () => {
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

  const executeExitAction = (action: PendingExitAction) => {
    if (action.kind === 'back') {
      onBack();
    } else if (action.kind === 'duplicate') {
      performDuplicate();
    } else if (action.kind === 'inspect') {
      onInspectAttempt?.(action.attempt);
    }
  };

  const requestExitAction = (action: PendingExitAction) => {
    if (isDirty) {
      setPendingExitAction(action);
      return;
    }
    executeExitAction(action);
  };

  const handleBackClick = () => {
    requestExitAction({ kind: 'back' });
  };

  const handleDuplicateClick = () => {
    if (!onDuplicate) return;
    requestExitAction({ kind: 'duplicate' });
  };

  const handleInspectAttemptClick = (attempt: TestAttempt) => {
    if (!onInspectAttempt || !isAttemptStartedOrCompleted(attempt)) return;
    requestExitAction({ kind: 'inspect', attempt });
  };

  const handleSave = async () => {
    setErrorMsg(null);
    const checkTitle =
      isContentLocked && initialPacket ? initialPacket.title : title;
    if (!checkTitle.trim()) {
      handleSwitchTab('questions');
      setErrorMsg('Please enter a test title before saving.');
      return;
    }
    if (questions.length === 0) {
      handleSwitchTab('questions');
      setErrorMsg('Add at least one question before saving.');
      return;
    }

    const existingIds = new Set(existingTests.map((t) => t.testId));
    const targetTestId = editingTestId ?? generateUniqueTestId(checkTitle, existingIds);
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
              {(isContentLocked && initialPacket ? initialPacket.title : title).trim() ||
                (isEditMode ? 'Edit Practice Test' : 'New Practice Test')}
            </h2>
            <button
              type="button"
              className={`editor-status-pill ${effectiveIsActive ? 'active' : 'draft'} ${
                isVisibilityLocked ? 'is-locked' : ''
              }`}
              disabled={isVisibilityLocked}
              onClick={() => {
                if (!isVisibilityLocked) {
                  setIsActive((prev) => !prev);
                }
              }}
              title={
                isVisibilityLocked
                  ? 'Locked as Active while student attempts exist. Reset student attempts to return to Draft.'
                  : 'Click to toggle Active / Draft visibility'
              }
            >
              {effectiveIsActive
                ? isVisibilityLocked
                  ? '🟢 Active 🔒'
                  : '🟢 Active'
                : '🔒 Draft'}
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

      {/* 2. Tabs Bar (Visibility, Teams & Attempts first; Details & Questions second) */}
      <nav className="editor-tabs-bar" aria-label="Test Editor Sections">
        <button
          type="button"
          className={`editor-tab-btn ${activeTab === 'teams' ? 'active' : ''}`}
          onClick={() => handleSwitchTab('teams')}
        >
          👥 Visibility, Teams & Attempts
          {cohorts.length > 0 ? ` (${cohorts.length})` : ''}
          {totalAttemptsCount > 0 ? ` · ${totalAttemptsCount} runs` : ''}
        </button>
        <button
          type="button"
          className={`editor-tab-btn ${activeTab === 'questions' ? 'active' : ''}`}
          onClick={() => handleSwitchTab('questions')}
        >
          {isContentLocked && lockedAttempts.length > 0 ? '🔒' : '📝'} Details & Questions (
          {questions.length})
        </button>
      </nav>

      {errorMsg && <div className="editor-error-banner">⚠️ {errorMsg}</div>}

      {/* 3. Main Scrollable Body */}
      <main className="test-editor-scroll-body">
        {activeTab === 'questions' ? (
          /* Tab 2: Details & Questions */
          <div className="editor-tab-content">
            {isContentLocked && lockedAttempts.length > 0 && (
              <div className="editor-attempts-warning editor-locked-banner">
                <div>
                  <strong>
                    🔒 Read-Only — {lockedAttempts.length} attempt
                    {lockedAttempts.length === 1 ? ' has' : 's have'} started or
                    completed:
                  </strong>{' '}
                  Test details and questions are locked while attempts exist. To edit
                  this test again, reset all attempts in{' '}
                  <strong>Visibility, Teams & Attempts</strong>, or duplicate this
                  test into a new draft.
                </div>
                <div className="editor-warning-actions">
                  <button
                    type="button"
                    className="btn-cohort-mini"
                    onClick={() => handleSwitchTab('teams')}
                  >
                    ← Visibility, Teams & Attempts
                  </button>
                  {onDuplicate && (
                    <button
                      type="button"
                      className="btn-cohort-mini"
                      onClick={handleDuplicateClick}
                    >
                      📋 Duplicate Test
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Test Metadata Card */}
            <section
              className={`editor-section-card ${
                isContentLocked ? 'editor-card-readonly' : ''
              }`}
            >
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
                    disabled={isContentLocked}
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
                    disabled={isContentLocked}
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
                  disabled={isContentLocked}
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

              {!isContentLocked && (
                <div className="editor-questions-toolbar-actions">
                  <button
                    type="button"
                    className="btn-simple editor-btn-suggest-pts"
                    disabled={areAllPointsSuggested}
                    onClick={handleSuggestAllPoints}
                    title={
                      areAllPointsSuggested
                        ? 'All questions already use their suggested tie-balanced point values'
                        : 'Auto-assign recommended, tie-reducing point values across all questions'
                    }
                  >
                    ✨ Suggest All Points
                  </button>
                  <button
                    type="button"
                    className="btn-simple editor-btn-add-q"
                    onClick={handleAddQuestion}
                  >
                    + Add Question
                  </button>
                </div>
              )}
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
                const cipherLabel =
                  CIPHER_OPTIONS.find((c) => c.id === q.cipher)?.label ?? 'Cipher';
                const otherPoints = questions
                  .filter((_, i) => i !== idx)
                  .map((x) => x.points);
                const guidance = getQuestionPointGuidance(q.cipher, quote, {
                  otherPoints,
                  questionIndex: idx,
                });
                const hasDuplicatePoints = duplicatePointValuesInDraft.has(q.points);
                const isGuidanceMatch = isPointsMatchingGuidance(q.points, guidance);
                const showSuggestChip =
                  !isContentLocked &&
                  guidance.suggested !== q.points &&
                  (!isGuidanceMatch || hasDuplicatePoints);

                return (
                  <article
                    key={q.uid}
                    className={`editor-question-card ${
                      isContentLocked ? 'editor-card-readonly' : ''
                    }`}
                  >
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
                              disabled={isContentLocked}
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
                                const nextGuidance = getQuestionPointGuidance(
                                  opt.id,
                                  quote,
                                  {
                                    otherPoints,
                                    questionIndex: idx,
                                  }
                                );
                                handleUpdateQuestion(q.uid, {
                                  cipher: opt.id,
                                  ...(!q.isPointsManual
                                    ? { points: nextGuidance.suggested }
                                    : {}),
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
                        <label
                          className="editor-pts-label"
                          title={guidance.tooltipSummary}
                        >
                          <span>Pts</span>
                          <input
                            type="number"
                            min={0}
                            max={5000}
                            step={1}
                            disabled={isContentLocked}
                            className="editor-pts-input"
                            value={q.points}
                            onChange={(e) =>
                              handleUpdateQuestion(q.uid, {
                                points: Math.max(
                                  0,
                                  Math.min(5000, Math.round(Number(e.target.value) || 0))
                                ),
                                isPointsManual: true,
                              })
                            }
                            aria-label={`Question ${idx + 1} points`}
                          />
                        </label>

                        {showSuggestChip && (
                          <button
                            type="button"
                            className="editor-pts-suggest-chip"
                            onClick={() =>
                              handleUpdateQuestion(q.uid, {
                                points: guidance.suggested,
                                isPointsManual: false,
                              })
                            }
                            title={
                              hasDuplicatePoints && isGuidanceMatch
                                ? `Duplicate score (${q.points} pts) increases tie risk — click to set ${guidance.suggested} pts (${guidance.tooltipSummary})`
                                : `Apply suggested score: ${guidance.suggested} pts (${guidance.tooltipSummary})`
                            }
                            aria-label={`Apply suggested ${guidance.suggested} points for question ${idx + 1}`}
                          >
                            ✨ ~{guidance.suggested}
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={isContentLocked}
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

                        {!isContentLocked && (
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
                        )}
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
                                  guidance.lengthWarning ? 'qb-stat-long' : ''
                                }`}
                                title={
                                  guidance.lengthWarning ??
                                  `Ciphered A–Z letters (recommended ${guidance.recommendedMinLetters}–${guidance.recommendedMaxLetters} letters for ${cipherLabel})`
                                }
                              >
                                {guidance.letterCount} letters
                              </span>
                              <span
                                className="qb-stat-pill"
                                title="Total string length including spaces and punctuation"
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

                        {!isContentLocked && (
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
                        )}
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
                        disabled={isContentLocked}
                        value={q.description}
                        onChange={(e) =>
                          handleUpdateQuestion(q.uid, { description: e.target.value })
                        }
                        aria-label={`Question ${idx + 1} prompt`}
                      />
                      {!isContentLocked && (
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
                      )}
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

            {!isContentLocked && (
              <div className="editor-bottom-add-row">
                <button
                  type="button"
                  className="btn-simple editor-btn-add-q-wide"
                  onClick={handleAddQuestion}
                >
                  + Add Another Question
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Tab 1: Visibility, Teams & Attempts */
          <div className="editor-tab-content">
            <label
              className={`cohort-visibility-row editor-visibility-card ${
                isVisibilityLocked ? 'cohort-visibility-locked' : ''
              }`}
            >
              <div className="cohort-visibility-info">
                <span className="cohort-visibility-label">
                  {effectiveIsActive
                    ? isVisibilityLocked
                      ? '🟢 Active — Visible to Students (Locked)'
                      : '🟢 Active — Visible to Students'
                    : '🔒 Draft — Hidden from Students'}
                </span>
                <span className="cohort-visibility-hint">
                  {isVisibilityLocked
                    ? 'Cannot switch back to Draft while student attempts are in progress or completed. Reset student attempts first.'
                    : 'Teachers can always view, preview, and test inactive drafts before publishing them to students.'}
                </span>
              </div>
              <input
                type="checkbox"
                className="cohort-active-checkbox"
                disabled={isVisibilityLocked}
                checked={effectiveIsActive}
                onChange={(e) => {
                  if (!isVisibilityLocked) {
                    setIsActive(e.target.checked);
                  }
                }}
              />
            </label>

            <section className="editor-section-card editor-cohorts-card">
              <div className="cohort-toolbar">
                <span className="cohort-section-heading">
                  Student Teams ({cohorts.length})
                </span>
                <div className="cohort-toolbar-actions">
                  {isEditMode &&
                    totalAttemptsCount > 1 &&
                    (confirmResetAllAttempts ? (
                      <div className="cohort-reset-confirm">
                        <span>Reset all {totalAttemptsCount} runs?</span>
                        <button
                          type="button"
                          className="btn-cohort-danger"
                          onClick={() => void handleResetAllAttempts()}
                        >
                          Yes, Reset All
                        </button>
                        <button
                          type="button"
                          className="btn-cohort-mini"
                          onClick={() => setConfirmResetAllAttempts(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-cohort-mini"
                        onClick={() => setConfirmResetAllAttempts(true)}
                        title="Delete all recorded attempts on this test to unlock editing"
                      >
                        Reset All Attempts ({totalAttemptsCount})
                      </button>
                    ))}
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
                    const attempt =
                      editingTestId && cohort.studentUids.length > 0
                        ? attemptsMap[
                            getCohortAttemptId(editingTestId, cohort.studentUids)
                          ]
                        : undefined;
                    const isTeamLocked = isAttemptStartedOrCompleted(attempt);
                    const canInspect = Boolean(
                      attempt && isTeamLocked && onInspectAttempt
                    );
                    const isSelected =
                      !isTeamLocked && cohort.id === effectiveSelectedCohortId;
                    const teamDisplayName = cohort.name?.trim() || `Team ${idx + 1}`;

                    return (
                      <div
                        key={cohort.id}
                        className={`cohort-group-card ${
                          isSelected ? 'cohort-group-selected' : ''
                        } ${isTeamLocked ? 'cohort-group-locked' : ''} ${
                          canInspect ? 'cohort-group-clickable' : ''
                        }`}
                        role={canInspect ? 'button' : undefined}
                        tabIndex={canInspect ? 0 : undefined}
                        onClick={() => {
                          if (canInspect && attempt) {
                            handleInspectAttemptClick(attempt);
                          } else if (!isTeamLocked) {
                            setSelectedCohortId(cohort.id);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (
                            canInspect &&
                            attempt &&
                            e.target === e.currentTarget &&
                            (e.key === 'Enter' || e.key === ' ')
                          ) {
                            e.preventDefault();
                            handleInspectAttemptClick(attempt);
                          }
                        }}
                        title={
                          canInspect && attempt
                            ? attempt.status === 'in_progress'
                              ? `Spectate ${teamDisplayName} live`
                              : `View ${teamDisplayName} results`
                            : undefined
                        }
                      >
                        <div className="cohort-group-header">
                          {isTeamLocked ? (
                            <>
                              <span className="cohort-name-locked">
                                {teamDisplayName}
                              </span>
                              <span
                                className="cohort-lock-tag"
                                title="Roster is locked after starting the test. Reset the attempt to modify members."
                              >
                                🔒 Locked
                              </span>
                            </>
                          ) : (
                            <>
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
                            </>
                          )}
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
                                  {!isTeamLocked && (
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
                                  )}
                                </span>
                              );
                            })
                          )}
                        </div>

                        {attempt && (
                          <div className="cohort-attempt-bar">
                            <div className="cohort-attempt-meta">
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
                              {canInspect && (
                                <span className="cohort-inspect-cta">
                                  {attempt.status === 'in_progress'
                                    ? '👁️ Spectate Live ➔'
                                    : '📊 View Results ➔'}
                                </span>
                              )}
                            </div>
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
                        title={
                          effectiveSelectedCohortId
                            ? 'Add to selected team'
                            : 'Create a new team with this user'
                        }
                      >
                        + {prof.displayName}
                        {prof.role === 'teacher' ? ' (Teacher)' : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Solo or Unmatched Attempts */}
              {isEditMode && unmatchedAttempts.length > 0 && (
                <div className="cohort-orphan-section">
                  <div className="cohort-unassigned-header">
                    <span className="cohort-section-heading">
                      {cohorts.length === 0
                        ? `Individual Attempts (${unmatchedAttempts.length})`
                        : `Solo / Other Attempts (${unmatchedAttempts.length})`}
                    </span>
                    {unmatchedAttempts.length > 1 &&
                      matchedAttemptIds.size > 0 &&
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
                          Reset Unmatched ({unmatchedAttempts.length})
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
                      const canInspect = Boolean(
                        isAttemptStartedOrCompleted(att) && onInspectAttempt
                      );
                      const memberLabel = formatAttemptMembers(att.studentUids);

                      return (
                        <div
                          key={att.attemptId}
                          className={`cohort-orphan-row ${
                            canInspect ? 'cohort-orphan-clickable' : ''
                          }`}
                          role={canInspect ? 'button' : undefined}
                          tabIndex={canInspect ? 0 : undefined}
                          onClick={() => {
                            if (canInspect) {
                              handleInspectAttemptClick(att);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (
                              canInspect &&
                              e.target === e.currentTarget &&
                              (e.key === 'Enter' || e.key === ' ')
                            ) {
                              e.preventDefault();
                              handleInspectAttemptClick(att);
                            }
                          }}
                          title={
                            canInspect
                              ? att.status === 'in_progress'
                                ? `Spectate ${memberLabel} live`
                                : `View ${memberLabel} results`
                              : undefined
                          }
                        >
                          <div className="cohort-orphan-info">
                            <span className="cohort-orphan-names">
                              {memberLabel}
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
                            {canInspect && (
                              <span className="cohort-inspect-cta">
                                {att.status === 'in_progress'
                                  ? '👁️ Spectate Live ➔'
                                  : '📊 View Results ➔'}
                              </span>
                            )}
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
      {pickerTargetQuestion && !isContentLocked && (
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
      {pendingExitAction && (
        <Modal
          isOpen={true}
          onClose={() => setPendingExitAction(null)}
          ariaLabelledBy="discard-changes-title"
          dialogClassName="confirm-modal"
        >
          <h3 id="discard-changes-title" className="confirm-modal-title">
            Discard Unsaved Changes?
          </h3>
          <p className="confirm-modal-text">
            {pendingExitAction.kind === 'inspect'
              ? 'You have unsaved edits to this practice test. Opening this attempt now will discard your unsaved changes.'
              : pendingExitAction.kind === 'duplicate'
                ? 'You have unsaved edits on this practice test. Duplicating into a new draft will leave unsaved changes behind on the original test.'
                : 'You have unsaved edits to this practice test. Leaving now will discard your changes.'}
          </p>
          <div className="confirm-modal-buttons">
            <button
              type="button"
              className="btn-simple"
              onClick={() => setPendingExitAction(null)}
            >
              Keep Editing
            </button>
            <button
              type="button"
              className="btn-simple editor-btn-delete"
              onClick={() => {
                const action = pendingExitAction;
                setPendingExitAction(null);
                executeExitAction(action);
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
