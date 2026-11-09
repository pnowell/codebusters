import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import type {
  CipherType,
  GeneralPracticeCiphers,
  OffsetsMode,
  UserSettings,
  TestPacket,
  TestAttempt,
  TestEvaluationResult,
} from './types';
import { LetterOffsetDrill } from './components/drills/LetterOffsetDrill';
import { SymbolDrill } from './components/drills/SymbolDrill';
import { MainMenu } from './components/menu/MainMenu';
import { OptionsModal } from './components/options/OptionsModal';
import { LeaderboardModal } from './components/leaderboard/LeaderboardModal';
import { TestBriefingModal } from './components/test/TestBriefingModal';
import { PracticeTestsList } from './components/test/PracticeTestsList';
import { WorkoutSummaryModal } from './components/workout/WorkoutSummaryModal';
import { NotAllowedModal } from './components/auth/NotAllowedModal';
import { VersionUpdateModal } from './components/common/VersionUpdateModal';
import {
  getDrill,
  isCipherAccessible,
  isLookupCipher,
} from './data/drills';
import { getQuoteById } from './data/quotes';
import {
  loadSettings,
  replaceAllDrillScores,
  saveCompletedQuoteIds,
  saveSettings,
  withoutSyncDispatch,
} from './services/storage';
import {
  subscribeAvailableTests,
  subscribeStudentAttempts,
  fetchTestAttemptById,
  fetchTestById,
  isAttemptStartedOrCompleted,
  resolveAttemptForTest,
} from './services/testService';
import { subscribeToSyncUpdates } from './services/sync';
import { subscribeTeamProfiles } from './services/profileService';
import { subscribeQuoteFlags } from './services/quoteFlagService';
import {
  createDefaultGeneralPracticeCiphers,
  generalPracticeCiphersToList,
  getGeneralPracticeCiphers,
  saveGeneralPracticeCiphers,
  sanitizeGeneralPracticeCiphers,
  subscribeGeneralPracticeCiphers,
} from './services/classroomConfigService';
import {
  parseUrlRoute,
  buildRouteUrl,
  getDefaultEditorTab,
  type DrillSection,
  type TestEditorTab,
} from './utils/routing';
import { evaluateTestPacket } from './utils/testSync';
import { useVisualViewportHeight } from './hooks/useVisualViewportHeight';
import { useOuterMarginScroll } from './hooks/useOuterMarginScroll';
import { useWorkoutCircuit } from './hooks/useWorkoutCircuit';
import { useRequiredVersion } from './hooks/useRequiredVersion';
import { useAuth } from './context/useAuth';

const LookupCipherDrill = lazy(() =>
  import('./components/drills/LookupCipherDrill').then((m) => ({
    default: m.LookupCipherDrill,
  }))
);

const TestRunner = lazy(() =>
  import('./components/test/TestRunner').then((m) => ({
    default: m.TestRunner,
  }))
);

const TestResultsView = lazy(() =>
  import('./components/test/TestResultsView').then((m) => ({
    default: m.TestResultsView,
  }))
);

const TestEditorView = lazy(() =>
  import('./components/test/TestEditorView').then((m) => ({
    default: m.TestEditorView,
  }))
);

const QuoteBrowserView = lazy(() =>
  import('./components/quotes/QuoteBrowserView').then((m) => ({
    default: m.QuoteBrowserView,
  }))
);

type ActiveScreen =
  | { kind: 'menu' }
  | {
      kind: 'drill';
      drill: CipherType;
      section: DrillSection;
      offsetsMode?: OffsetsMode;
      quoteId?: number;
    }
  | { kind: 'testsList' }
  | { kind: 'quotesBrowser' }
  | {
      kind: 'testEditor';
      editTarget: string;
      tab: TestEditorTab;
      draftTemplate?: TestPacket;
      editorNonce: number;
    }
  | {
      kind: 'spectateLoading';
      testId: string;
      attemptId: string;
    }
  | {
      kind: 'testRunner';
      testPacket: TestPacket;
      initialAttempt: TestAttempt | null;
      spectateAttemptId?: string;
    }
  | {
      kind: 'testResults';
      testPacket: TestPacket;
      results: TestEvaluationResult;
      attempt?: TestAttempt;
      returnToEditTestId?: string;
    };

interface BriefingState {
  testPacket: TestPacket;
  existingAttempt: TestAttempt | null;
}

function initScreen(): ActiveScreen {
  const route = parseUrlRoute();
  if (route.drill) {
    return {
      kind: 'drill',
      drill: route.drill,
      section: route.section || 'memorize',
      offsetsMode: route.offsetsMode,
      quoteId: route.quoteId,
    };
  }
  if (route.quotesBrowser) {
    return { kind: 'quotesBrowser' };
  }
  if (route.editTest) {
    return {
      kind: 'testEditor',
      editTarget: route.editTest,
      tab: route.editTab ?? getDefaultEditorTab(route.editTest),
      editorNonce: 0,
    };
  }
  if (route.testId && route.spectateAttemptId) {
    return {
      kind: 'spectateLoading',
      testId: route.testId,
      attemptId: route.spectateAttemptId,
    };
  }
  if (route.testsList) {
    return { kind: 'testsList' };
  }
  return { kind: 'menu' };
}

export const App: React.FC = () => {
  const { user, allowedUser, isAllowed, isLoading: isAuthLoading } = useAuth();
  const isTeacher = Boolean(isAllowed && allowedUser?.role === 'teacher');
  const currentUid = user?.uid || 'student';
  const signedInUid = isAllowed && user?.uid ? user.uid : null;

  const [settings, setSettings] = useState<UserSettings>(loadSettings);
  const [generalPracticeCiphers, setGeneralPracticeCiphers] =
    useState<GeneralPracticeCiphers>(getGeneralPracticeCiphers);
  const [loadedConfigForUid, setLoadedConfigForUid] = useState<string | null>(null);
  const [screen, setScreen] = useState<ActiveScreen>(initScreen);

  const isClassroomConfigReady =
    !isAuthLoading && (!signedInUid || loadedConfigForUid === signedInUid);

  const [isOptionsOpen, setIsOptionsOpen] = useState<boolean>(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState<boolean>(false);

  // Practice Test catalog & briefing modal state
  const [availableTests, setAvailableTests] = useState<TestPacket[]>([]);
  const [studentAttempts, setStudentAttempts] = useState<Record<string, TestAttempt>>({});
  const [isTestsLoading, setIsTestsLoading] = useState<boolean>(true);
  const [isAttemptsLoaded, setIsAttemptsLoaded] = useState<boolean>(false);
  const [briefingState, setBriefingState] = useState<BriefingState | null>(null);

  // Pin outer window and track visual viewport height above mobile virtual keyboard
  useVisualViewportHeight();
  useOuterMarginScroll();

  const requiredCriticalVersion = useRequiredVersion();

  const navigateToDrill = useCallback(
    (
      drill: CipherType,
      section: DrillSection = 'memorize',
      quoteId?: number,
      replaceHistory = false,
      offsetsMode?: OffsetsMode
    ) => {
      setScreen({ kind: 'drill', drill, section, offsetsMode, quoteId });
      const newUrl = buildRouteUrl({ drill, section, offsetsMode, quoteId });
      if (replaceHistory) {
        window.history.replaceState({ drill, section, offsetsMode, quoteId }, '', newUrl);
      } else {
        window.history.pushState({ drill, section, offsetsMode, quoteId }, '', newUrl);
      }
    },
    []
  );

  const navigateToMenuCore = useCallback(() => {
    if (
      window.history.state &&
      (window.history.state.drill ||
        window.history.state.testId ||
        window.history.state.testsList)
    ) {
      window.history.back();
    } else {
      setScreen({ kind: 'menu' });
      const newUrl = buildRouteUrl({ drill: null });
      window.history.pushState({ drill: null }, '', newUrl);
    }
  }, []);

  const activeGeneralPracticeCiphers = useMemo(
    () => generalPracticeCiphersToList(generalPracticeCiphers, isTeacher),
    [generalPracticeCiphers, isTeacher]
  );

  const studentEnabledCiphersKey = useMemo(
    () => generalPracticeCiphersToList(generalPracticeCiphers, false).join(','),
    [generalPracticeCiphers]
  );

  const {
    workoutContext,
    workoutSummary,
    startWorkout,
    cancelWorkout,
    dismissSummary,
  } = useWorkoutCircuit({
    unlockedCiphers: activeGeneralPracticeCiphers,
    onNavigateToDrill: navigateToDrill,
    onExitToMenu: navigateToMenuCore,
  });

  const navigateToMenu = useCallback(() => {
    cancelWorkout();
    navigateToMenuCore();
  }, [cancelWorkout, navigateToMenuCore]);

  // Keep local state in sync when cloud sync updates localStorage
  useEffect(() => {
    return subscribeToSyncUpdates(() => {
      setSettings(loadSettings());
    });
  }, []);

  // Subscribe to global teacher-configured student cipher visibility booleans
  useEffect(() => {
    if (!signedInUid) {
      queueMicrotask(() => {
        setGeneralPracticeCiphers(createDefaultGeneralPracticeCiphers());
        setLoadedConfigForUid(null);
      });
      return;
    }

    return subscribeGeneralPracticeCiphers((nextCiphers) => {
      setGeneralPracticeCiphers(nextCiphers);
      setLoadedConfigForUid(signedInUid);
    });
  }, [signedInUid]);

  // Subscribe to practice tests in Firestore (teachers also see inactive drafts)
  useEffect(() => {
    if (!isAllowed) {
      queueMicrotask(() => {
        setAvailableTests([]);
        setIsTestsLoading(false);
      });
      return;
    }

    queueMicrotask(() => {
      setIsTestsLoading(true);
    });

    return subscribeAvailableTests(
      (tests) => {
        setAvailableTests(tests);
        setIsTestsLoading(false);
      },
      { includeInactive: isTeacher }
    );
  }, [isAllowed, isTeacher]);

  // Subscribe to Team Public Profiles (in-memory name lookup and authoritative high score sync)
  useEffect(() => {
    if (!isAllowed) return;
    return subscribeTeamProfiles((profiles, meta) => {
      if (user?.uid) {
        const myProfile = profiles.find((p) => p.uid === user.uid);
        if (myProfile?.displayName) {
          const cur = loadSettings();
          if (cur.studentName !== myProfile.displayName) {
            const next = { ...cur, studentName: myProfile.displayName };
            withoutSyncDispatch(() => {
              saveSettings(next);
            });
            setSettings(next);
          }
        }
        if (!meta.hasPendingWrites && myProfile) {
          withoutSyncDispatch(() => {
            replaceAllDrillScores(myProfile.drillScores ?? {});
          });
        }
      }
    });
  }, [isAllowed, user?.uid]);

  // Subscribe to student's / cohort's test attempts in Firestore
  useEffect(() => {
    if (!isAllowed || !user?.uid) {
      queueMicrotask(() => {
        setStudentAttempts({});
        setIsAttemptsLoaded(Boolean(isAllowed));
      });
      return;
    }

    return subscribeStudentAttempts(user.uid, (attempts) => {
      setStudentAttempts(attempts);
      setIsAttemptsLoaded(true);
    });
  }, [isAllowed, user?.uid]);

  // Automatically record all quotes from any student test attempt into completedQuotes
  // so individual lookup drills skip test quotes and `/users/{uid}` stays synchronized.
  useEffect(() => {
    if (!isAllowed || isTeacher || isTestsLoading || !isAttemptsLoaded) return;
    const attemptList = Object.values(studentAttempts);
    if (attemptList.length === 0) return;

    const testById = new Map(availableTests.map((t) => [t.testId, t]));
    const seenQuoteIds = new Set<number>();

    for (const attempt of attemptList) {
      const packet = testById.get(attempt.testId);
      if (packet) {
        for (const q of packet.questions) {
          seenQuoteIds.add(q.quoteId);
        }
      }
      if (attempt.results?.questions) {
        for (const qr of attempt.results.questions) {
          seenQuoteIds.add(qr.quoteId);
        }
      }
    }

    if (seenQuoteIds.size > 0) {
      saveCompletedQuoteIds(Array.from(seenQuoteIds));
    }
  }, [isAllowed, isTeacher, isTestsLoading, isAttemptsLoaded, availableTests, studentAttempts]);

  // Subscribe to teacher-curated quote flags so student drills also skip flagged quotes
  useEffect(() => {
    if (!isAllowed) return;
    return subscribeQuoteFlags();
  }, [isAllowed]);

  const drillScreenInfo = screen.kind === 'drill' ? getDrill(screen.drill) : null;
  const isDrillStructurallyValid = Boolean(
    screen.kind === 'drill' &&
      drillScreenInfo &&
      drillScreenInfo.implemented &&
      (screen.section === 'memorize'
        ? drillScreenInfo.hasFlashcardDrill
        : drillScreenInfo.hasQuoteWorkspace)
  );

  // Redirect non-teachers away from teacher-only routes (?editTest=..., ?quotes=true, or ?spectate=...)
  useEffect(() => {
    if (isAuthLoading || isTeacher) return;
    const isTeacherScreen =
      screen.kind === 'testEditor' ||
      screen.kind === 'quotesBrowser' ||
      screen.kind === 'spectateLoading' ||
      (screen.kind === 'testRunner' && Boolean(screen.spectateAttemptId)) ||
      (screen.kind === 'testResults' && Boolean(screen.returnToEditTestId));

    if (isTeacherScreen) {
      queueMicrotask(() => {
        if (isAllowed) {
          const listUrl = buildRouteUrl({ drill: null, testsList: true });
          window.history.replaceState({ testsList: true }, '', listUrl);
          setScreen({ kind: 'testsList' });
        } else {
          const menuUrl = buildRouteUrl({ drill: null });
          window.history.replaceState({ drill: null }, '', menuUrl);
          setScreen({ kind: 'menu' });
        }
      });
    }
  }, [isAuthLoading, isAllowed, isTeacher, screen]);

  // Redirect away from unimplemented, unsupported, or student-disabled drill/cipher routes
  useEffect(() => {
    if (screen.kind !== 'drill') return;
    if (!isDrillStructurallyValid) {
      queueMicrotask(() => {
        cancelWorkout();
        const menuUrl = buildRouteUrl({ drill: null });
        window.history.replaceState({ drill: null }, '', menuUrl);
        setScreen({ kind: 'menu' });
      });
      return;
    }
    if (!isClassroomConfigReady) return;
    if (
      !isCipherAccessible(
        screen.drill,
        screen.section,
        generalPracticeCiphers,
        isTeacher
      )
    ) {
      queueMicrotask(() => {
        cancelWorkout();
        const menuUrl = buildRouteUrl({ drill: null });
        window.history.replaceState({ drill: null }, '', menuUrl);
        setScreen({ kind: 'menu' });
      });
    }
  }, [
    screen,
    isDrillStructurallyValid,
    isClassroomConfigReady,
    generalPracticeCiphers,
    isTeacher,
    cancelWorkout,
  ]);

  // Resolve teacher spectate / review route (?test=testId&spectate=attemptId)
  useEffect(() => {
    if (screen.kind !== 'spectateLoading') return;
    if (isAuthLoading || !isTeacher || isTestsLoading) return;

    let cancelled = false;
    const { testId, attemptId } = screen;

    const loadSpectateTarget = async () => {
      const test =
        availableTests.find((t) => t.testId === testId) ??
        (await fetchTestById(testId));

      if (cancelled) return;

      if (!test) {
        const listUrl = buildRouteUrl({ drill: null, testsList: true });
        window.history.replaceState({ testsList: true }, '', listUrl);
        setScreen({ kind: 'testsList' });
        return;
      }

      const attempt = await fetchTestAttemptById(attemptId, {
        questions: test.questions,
        getQuote: getQuoteById,
      });

      if (cancelled) return;

      if (
        !attempt ||
        attempt.testId !== test.testId ||
        !isAttemptStartedOrCompleted(attempt)
      ) {
        const editUrl = buildRouteUrl({
          drill: null,
          editTest: test.testId,
          editTab: 'teams',
        });
        window.history.replaceState(
          { editTest: test.testId, editTab: 'teams' },
          '',
          editUrl
        );
        setScreen({
          kind: 'testEditor',
          editTarget: test.testId,
          tab: 'teams',
          editorNonce: Date.now(),
        });
        return;
      }

      if (attempt.status === 'in_progress') {
        setScreen({
          kind: 'testRunner',
          testPacket: test,
          initialAttempt: attempt,
          spectateAttemptId: attempt.attemptId,
        });
      } else {
        const evaluated =
          attempt.results ??
          evaluateTestPacket(
            test,
            attempt.workspaces,
            attempt.startedAt,
            getQuoteById,
            attempt.submittedAt
          );
        setScreen({
          kind: 'testResults',
          testPacket: test,
          results: evaluated,
          attempt,
          returnToEditTestId: test.testId,
        });
      }
    };

    void loadSpectateTarget();

    return () => {
      cancelled = true;
    };
  }, [availableTests, isAuthLoading, isTeacher, isTestsLoading, screen]);

  // Deep-link direct test launch if ?test=testId is provided (participant flow)
  useEffect(() => {
    const route = parseUrlRoute();
    if (
      !route.testId ||
      route.spectateAttemptId ||
      !isAllowed ||
      isTestsLoading ||
      !isAttemptsLoaded
    ) {
      return;
    }
    if (
      screen.kind === 'testRunner' ||
      screen.kind === 'testResults' ||
      briefingState
    ) {
      return;
    }

    const openResolvedTest = (test: TestPacket) => {
      const attempt = resolveAttemptForTest(test, currentUid, studentAttempts);
      if (attempt?.status === 'in_progress') {
        setScreen({
          kind: 'testRunner',
          testPacket: test,
          initialAttempt: attempt,
        });
      } else if (
        (attempt?.status === 'submitted' || attempt?.status === 'expired') &&
        attempt.results
      ) {
        setScreen({
          kind: 'testResults',
          testPacket: test,
          results: attempt.results,
          attempt,
        });
      } else {
        // Route through the briefing / unanimous lobby modal if not yet started
        const listUrl = buildRouteUrl({ drill: null, testsList: true });
        window.history.replaceState({ testsList: true }, '', listUrl);
        window.history.pushState(
          { testsList: true, modal: 'briefing', briefingTestId: test.testId },
          '',
          listUrl
        );
        setScreen({ kind: 'testsList' });
        setBriefingState({ testPacket: test, existingAttempt: attempt });
      }
    };

    const matched = availableTests.find((t) => t.testId === route.testId);
    if (matched) {
      queueMicrotask(() => {
        openResolvedTest(matched);
      });
    } else {
      fetchTestById(route.testId).then((fetched) => {
        if (fetched) {
          openResolvedTest(fetched);
        }
      });
    }
  }, [
    isAllowed,
    isTestsLoading,
    isAttemptsLoaded,
    availableTests,
    studentAttempts,
    currentUid,
    screen.kind,
    briefingState,
  ]);

  // Deep-link direct test results review if ?results=testId is provided
  useEffect(() => {
    const route = parseUrlRoute();
    if (!route.resultsTestId || !isAllowed || isTestsLoading || !isAttemptsLoaded) {
      return;
    }
    if (screen.kind === 'testResults') return;

    const test = availableTests.find((t) => t.testId === route.resultsTestId);
    if (test) {
      const attempt = resolveAttemptForTest(test, currentUid, studentAttempts);
      if (attempt?.results) {
        queueMicrotask(() => {
          setScreen({
            kind: 'testResults',
            testPacket: test,
            results: attempt.results!,
            attempt,
          });
        });
      }
    } else {
      fetchTestById(route.resultsTestId).then((fetched) => {
        if (fetched) {
          const attempt = resolveAttemptForTest(fetched, currentUid, studentAttempts);
          if (attempt?.results) {
            setScreen({
              kind: 'testResults',
              testPacket: fetched,
              results: attempt.results,
              attempt,
            });
          }
        }
      });
    }
  }, [
    isAllowed,
    isTestsLoading,
    isAttemptsLoaded,
    availableTests,
    studentAttempts,
    currentUid,
    screen.kind,
  ]);

  // Listen to browser Back / Forward buttons
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      setIsOptionsOpen(e.state?.modal === 'options');
      setIsLeaderboardOpen(e.state?.modal === 'leaderboard');

      if (e.state?.modal === 'briefing' && typeof e.state.briefingTestId === 'string') {
        const matched = availableTests.find(
          (t) => t.testId === e.state.briefingTestId
        );
        if (matched) {
          const attempt = resolveAttemptForTest(matched, currentUid, studentAttempts);
          setBriefingState({ testPacket: matched, existingAttempt: attempt });
        } else {
          setBriefingState(null);
        }
      } else {
        setBriefingState(null);
      }

      const route = parseUrlRoute();
      if (!route.drill) {
        cancelWorkout();
      }

      if (route.drill) {
        setScreen({
          kind: 'drill',
          drill: route.drill,
          section: route.section || 'memorize',
          offsetsMode: route.offsetsMode,
          quoteId: route.quoteId,
        });
      } else if (route.quotesBrowser) {
        setScreen({ kind: 'quotesBrowser' });
      } else if (route.editTest) {
        const nextTab = route.editTab ?? getDefaultEditorTab(route.editTest);
        setScreen((prev) => {
          if (
            prev.kind === 'testEditor' &&
            prev.editTarget === route.editTest
          ) {
            return { ...prev, tab: nextTab };
          }
          return {
            kind: 'testEditor',
            editTarget: route.editTest!,
            tab: nextTab,
            editorNonce: Date.now(),
          };
        });
      } else if (route.testId && route.spectateAttemptId) {
        setScreen({
          kind: 'spectateLoading',
          testId: route.testId,
          attemptId: route.spectateAttemptId,
        });
      } else if (route.testId) {
        const matched = availableTests.find((t) => t.testId === route.testId);
        if (matched) {
          const attempt = resolveAttemptForTest(matched, currentUid, studentAttempts);
          if (attempt?.status === 'in_progress') {
            setScreen({
              kind: 'testRunner',
              testPacket: matched,
              initialAttempt: attempt,
            });
          } else {
            setScreen({ kind: 'testsList' });
          }
        }
      } else if (route.resultsTestId) {
        const test = availableTests.find((t) => t.testId === route.resultsTestId);
        const attempt = test
          ? resolveAttemptForTest(test, currentUid, studentAttempts)
          : null;
        if (test && attempt?.results) {
          setScreen({
            kind: 'testResults',
            testPacket: test,
            results: attempt.results,
            attempt,
          });
        } else {
          setScreen({ kind: 'testsList' });
        }
      } else if (route.testsList) {
        setScreen({ kind: 'testsList' });
      } else {
        setScreen({ kind: 'menu' });
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [availableTests, cancelWorkout, currentUid, studentAttempts]);

  // Seed history stack when landing directly on a deep link
  useEffect(() => {
    const route = parseUrlRoute();
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (route.drill && (!window.history.state || !('drill' in window.history.state))) {
      window.history.replaceState({ drill: null }, '', buildRouteUrl({ drill: null }));
      window.history.pushState(
        {
          drill: route.drill,
          section: route.section,
          offsetsMode: route.offsetsMode,
          quoteId: route.quoteId,
        },
        '',
        currentUrl
      );
    } else if (
      route.quotesBrowser &&
      (!window.history.state || !('quotesBrowser' in window.history.state))
    ) {
      window.history.replaceState(
        { testsList: true },
        '',
        buildRouteUrl({ drill: null, testsList: true })
      );
      window.history.pushState({ quotesBrowser: true }, '', currentUrl);
    } else if (
      route.testId &&
      route.spectateAttemptId &&
      (!window.history.state || !('spectateAttemptId' in window.history.state))
    ) {
      window.history.replaceState(
        { editTest: route.testId, editTab: 'teams' },
        '',
        buildRouteUrl({ drill: null, editTest: route.testId, editTab: 'teams' })
      );
      window.history.pushState(
        {
          testId: route.testId,
          spectateAttemptId: route.spectateAttemptId,
          returnToEditTestId: route.testId,
        },
        '',
        currentUrl
      );
    } else if (
      route.editTest &&
      (!window.history.state || !('editTest' in window.history.state))
    ) {
      window.history.replaceState(
        { testsList: true },
        '',
        buildRouteUrl({ drill: null, testsList: true })
      );
      window.history.pushState(
        {
          editTest: route.editTest,
          editTab: route.editTab ?? getDefaultEditorTab(route.editTest),
        },
        '',
        currentUrl
      );
    } else if (
      route.testsList &&
      !route.resultsTestId &&
      (!window.history.state || !('testsList' in window.history.state))
    ) {
      window.history.replaceState({ drill: null }, '', buildRouteUrl({ drill: null }));
      window.history.pushState({ testsList: true }, '', currentUrl);
    }
  }, []);

  const handleOpenTestsList = () => {
    setScreen({ kind: 'testsList' });
    const newUrl = buildRouteUrl({ drill: null, testsList: true });
    window.history.pushState({ testsList: true }, '', newUrl);
  };

  const handleBackFromTestsList = () => {
    if (window.history.state && window.history.state.testsList) {
      window.history.back();
    } else {
      setScreen({ kind: 'menu' });
      const newUrl = buildRouteUrl({ drill: null });
      window.history.pushState({ drill: null }, '', newUrl);
    }
  };

  const handleOpenQuotesBrowser = () => {
    if (!isTeacher) return;
    setScreen({ kind: 'quotesBrowser' });
    const newUrl = buildRouteUrl({ drill: null, quotesBrowser: true });
    window.history.pushState({ quotesBrowser: true }, '', newUrl);
  };

  const handleNewTest = () => {
    if (!isTeacher) return;
    setScreen({
      kind: 'testEditor',
      editTarget: 'new',
      tab: 'questions',
      editorNonce: Date.now(),
    });
    const newUrl = buildRouteUrl({
      drill: null,
      editTest: 'new',
      editTab: 'questions',
    });
    window.history.pushState({ editTest: 'new', editTab: 'questions' }, '', newUrl);
  };

  const handleEditTest = (testId: string, tab: TestEditorTab = 'teams') => {
    if (!isTeacher) return;
    setScreen({
      kind: 'testEditor',
      editTarget: testId,
      tab,
      editorNonce: Date.now(),
    });
    const newUrl = buildRouteUrl({ drill: null, editTest: testId, editTab: tab });
    window.history.pushState({ editTest: testId, editTab: tab }, '', newUrl);
  };

  const handleDuplicateFromEditor = (draftTemplate: TestPacket) => {
    if (!isTeacher) return;
    setScreen({
      kind: 'testEditor',
      editTarget: 'new',
      tab: 'questions',
      draftTemplate,
      editorNonce: Date.now(),
    });
    const newUrl = buildRouteUrl({
      drill: null,
      editTest: 'new',
      editTab: 'questions',
    });
    window.history.replaceState(
      { editTest: 'new', editTab: 'questions', fromDuplicate: true },
      '',
      newUrl
    );
  };

  const handleInspectAttempt = (testPacket: TestPacket, attempt: TestAttempt) => {
    if (!isTeacher || !isAttemptStartedOrCompleted(attempt)) return;
    cancelWorkout();

    const newUrl = buildRouteUrl({
      drill: null,
      testId: testPacket.testId,
      spectateAttemptId: attempt.attemptId,
    });
    window.history.pushState(
      {
        testId: testPacket.testId,
        spectateAttemptId: attempt.attemptId,
        returnToEditTestId: testPacket.testId,
      },
      '',
      newUrl
    );

    if (attempt.status === 'in_progress') {
      setScreen({
        kind: 'testRunner',
        testPacket,
        initialAttempt: attempt,
        spectateAttemptId: attempt.attemptId,
      });
    } else {
      const evaluated =
        attempt.results ??
        evaluateTestPacket(
          testPacket,
          attempt.workspaces,
          attempt.startedAt,
          getQuoteById,
          attempt.submittedAt
        );
      setScreen({
        kind: 'testResults',
        testPacket,
        results: evaluated,
        attempt,
        returnToEditTestId: testPacket.testId,
      });
    }
  };

  const handleExitFromSpectate = (testId: string) => {
    if (window.history.state && window.history.state.spectateAttemptId) {
      window.history.back();
    } else {
      setScreen({
        kind: 'testEditor',
        editTarget: testId,
        tab: 'teams',
        editorNonce: Date.now(),
      });
      const editUrl = buildRouteUrl({
        drill: null,
        editTest: testId,
        editTab: 'teams',
      });
      window.history.replaceState(
        { editTest: testId, editTab: 'teams' },
        '',
        editUrl
      );
    }
  };

  const handleEditorTabChange = useCallback((tab: TestEditorTab) => {
    setScreen((prev) => {
      if (prev.kind !== 'testEditor') return prev;
      const newUrl = buildRouteUrl({
        drill: null,
        editTest: prev.editTarget,
        editTab: tab,
      });
      window.history.replaceState(
        { ...(window.history.state || {}), editTest: prev.editTarget, editTab: tab },
        '',
        newUrl
      );
      return { ...prev, tab };
    });
  }, []);

  const handleBackFromTeacherScreen = () => {
    if (
      window.history.state &&
      (window.history.state.editTest || window.history.state.quotesBrowser)
    ) {
      window.history.back();
    } else {
      setScreen({ kind: 'testsList' });
      const newUrl = buildRouteUrl({ drill: null, testsList: true });
      window.history.replaceState({ testsList: true }, '', newUrl);
    }
  };

  const handleSelectTest = (test: TestPacket, attempt: TestAttempt | null) => {
    const freshest =
      attempt ?? resolveAttemptForTest(test, currentUid, studentAttempts);
    if (
      freshest &&
      (freshest.status === 'submitted' || freshest.status === 'expired') &&
      freshest.results
    ) {
      setScreen({
        kind: 'testResults',
        testPacket: test,
        results: freshest.results,
        attempt: freshest,
      });
      const newUrl = buildRouteUrl({
        drill: null,
        testsList: true,
        resultsTestId: test.testId,
      });
      window.history.pushState(
        { testsList: true, resultsTestId: test.testId },
        '',
        newUrl
      );
    } else {
      window.history.pushState(
        {
          ...(window.history.state || { testsList: true }),
          modal: 'briefing',
          briefingTestId: test.testId,
        },
        '',
        window.location.href
      );
      setBriefingState({ testPacket: test, existingAttempt: freshest });
    }
  };

  const closeBriefing = useCallback(() => {
    if (window.history.state?.modal === 'briefing') {
      window.history.back();
    } else {
      setBriefingState(null);
    }
  }, []);

  const handleBackFromTestResults = () => {
    if (window.history.state && window.history.state.resultsTestId) {
      window.history.back();
    } else {
      setScreen({ kind: 'testsList' });
      const newUrl = buildRouteUrl({ drill: null, testsList: true });
      window.history.pushState({ testsList: true }, '', newUrl);
    }
  };

  const handleLaunchAttempt = (attempt: TestAttempt) => {
    if (!briefingState) return;
    const { testPacket } = briefingState;
    setBriefingState(null);
    cancelWorkout();
    setScreen({ kind: 'testRunner', testPacket, initialAttempt: attempt });
    const newUrl = buildRouteUrl({ drill: null, testId: testPacket.testId });
    if (window.history.state?.modal === 'briefing') {
      window.history.replaceState({ testId: testPacket.testId }, '', newUrl);
    } else {
      window.history.pushState({ testId: testPacket.testId }, '', newUrl);
    }
  };

  const handleViewResultsFromBriefing = (attempt: TestAttempt) => {
    if (!briefingState || !attempt.results) return;
    const { testPacket } = briefingState;
    setBriefingState(null);
    setScreen({
      kind: 'testResults',
      testPacket,
      results: attempt.results,
      attempt,
    });
    const newUrl = buildRouteUrl({
      drill: null,
      testsList: true,
      resultsTestId: testPacket.testId,
    });
    if (window.history.state?.modal === 'briefing') {
      window.history.replaceState(
        { testsList: true, resultsTestId: testPacket.testId },
        '',
        newUrl
      );
    } else {
      window.history.pushState(
        { testsList: true, resultsTestId: testPacket.testId },
        '',
        newUrl
      );
    }
  };

  const handleExitTest = () => {
    if (window.history.state && window.history.state.testId) {
      window.history.back();
    } else {
      setScreen({ kind: 'testsList' });
      const newUrl = buildRouteUrl({ drill: null, testsList: true });
      window.history.pushState({ testsList: true }, '', newUrl);
    }
  };

  const handleQuoteChange = useCallback((newQuoteId: number) => {
    setScreen((prev) => {
      if (prev.kind !== 'drill') return prev;
      const newUrl = buildRouteUrl({
        drill: prev.drill,
        section: prev.section,
        offsetsMode: prev.offsetsMode,
        quoteId: newQuoteId,
      });
      window.history.replaceState(
        {
          drill: prev.drill,
          section: prev.section,
          offsetsMode: prev.offsetsMode,
          quoteId: newQuoteId,
        },
        '',
        newUrl
      );
      return { ...prev, quoteId: newQuoteId };
    });
  }, []);

  const handleOffsetsModeChange = useCallback((newMode: OffsetsMode) => {
    setScreen((prev) => {
      if (prev.kind !== 'drill' || prev.drill !== 'offsets') return prev;
      const newUrl = buildRouteUrl({
        drill: prev.drill,
        section: prev.section,
        offsetsMode: newMode,
      });
      window.history.replaceState(
        { drill: prev.drill, section: prev.section, offsetsMode: newMode },
        '',
        newUrl
      );
      return { ...prev, offsetsMode: newMode };
    });
  }, []);

  const openOptions = () => {
    window.history.pushState(
      { ...(window.history.state || {}), modal: 'options' },
      '',
      window.location.href
    );
    setIsOptionsOpen(true);
  };

  const closeOptions = () => {
    if (window.history.state?.modal === 'options') {
      window.history.back();
    } else {
      setIsOptionsOpen(false);
    }
  };

  const openLeaderboard = () => {
    window.history.pushState(
      { ...(window.history.state || {}), modal: 'leaderboard' },
      '',
      window.location.href
    );
    setIsLeaderboardOpen(true);
  };

  const closeLeaderboard = () => {
    if (window.history.state?.modal === 'leaderboard') {
      window.history.back();
    } else {
      setIsLeaderboardOpen(false);
    }
  };

  const handleSaveGeneralPracticeCiphers = (nextCiphers: GeneralPracticeCiphers) => {
    if (!isTeacher) return;
    const sanitized = sanitizeGeneralPracticeCiphers(nextCiphers);
    setGeneralPracticeCiphers(sanitized);
    void saveGeneralPracticeCiphers(sanitized);
  };

  const suspenseFallback = (
    <div className="drill-loading-state">Loading cipher workspace...</div>
  );

  const canRenderDrillScreen =
    screen.kind === 'drill' &&
    isDrillStructurallyValid &&
    (screen.drill === 'offsets' ||
      isTeacher ||
      (isClassroomConfigReady &&
        isCipherAccessible(
          screen.drill,
          screen.section,
          generalPracticeCiphers,
          false
        )));

  return (
    <div className="app-container">
      {screen.kind === 'menu' && (
        <MainMenu
          studentName={settings.studentName}
          isAllowed={isAllowed}
          isTeacher={isTeacher}
          generalPracticeCiphers={generalPracticeCiphers}
          onStartWorkout={() => startWorkout(1)}
          onOpenTestsList={handleOpenTestsList}
          onOpenLeaderboard={openLeaderboard}
          onOpenOptions={openOptions}
          onSelectDrill={(drill, section, offsetsMode) =>
            navigateToDrill(drill, section, undefined, false, offsetsMode)
          }
        />
      )}

      {screen.kind === 'spectateLoading' && suspenseFallback}

      {screen.kind === 'testRunner' && (
        <Suspense fallback={suspenseFallback}>
          <TestRunner
            key={screen.spectateAttemptId ?? screen.testPacket.testId}
            testPacket={
              availableTests.find((t) => t.testId === screen.testPacket.testId) ??
              screen.testPacket
            }
            currentUid={currentUid}
            isTeacher={isTeacher}
            isSpectator={Boolean(screen.spectateAttemptId)}
            initialAttempt={screen.initialAttempt}
            onExitToMenu={
              screen.spectateAttemptId
                ? () => handleExitFromSpectate(screen.testPacket.testId)
                : handleExitTest
            }
          />
        </Suspense>
      )}

      {screen.kind === 'drill' && !canRenderDrillScreen && suspenseFallback}

      {screen.kind === 'drill' && canRenderDrillScreen && screen.drill === 'offsets' && (
        <LetterOffsetDrill
          key={workoutContext ? `workout-${workoutContext.round}-${workoutContext.stepIndex}` : 'standalone'}
          initialMode={screen.offsetsMode}
          onModeChange={handleOffsetsModeChange}
          onBack={navigateToMenu}
          workoutContext={workoutContext}
        />
      )}

      {screen.kind === 'drill' &&
        canRenderDrillScreen &&
        isLookupCipher(screen.drill) &&
        (screen.section === 'cipher' ? (
          <Suspense fallback={suspenseFallback}>
            <LookupCipherDrill
              key={`${screen.drill}:${screen.quoteId ?? 'random'}:${workoutContext ? `${workoutContext.round}-${workoutContext.stepIndex}` : 'standalone'}`}
              cipher={screen.drill}
              initialQuoteId={screen.quoteId}
              onQuoteChange={handleQuoteChange}
              onBack={navigateToMenu}
              workoutContext={workoutContext}
            />
          </Suspense>
        ) : (
          <SymbolDrill
            key={`${screen.drill}:${workoutContext ? `${workoutContext.round}-${workoutContext.stepIndex}` : 'standalone'}`}
            cipher={screen.drill}
            onBack={navigateToMenu}
            workoutContext={workoutContext}
          />
        ))}

      {screen.kind === 'testResults' && (
        <Suspense fallback={suspenseFallback}>
          <TestResultsView
            testPacket={
              availableTests.find((t) => t.testId === screen.testPacket.testId) ??
              screen.testPacket
            }
            results={screen.results}
            studentUids={screen.attempt?.studentUids}
            backLabel={screen.returnToEditTestId ? '← Back to Test' : undefined}
            backTitle={
              screen.returnToEditTestId
                ? 'Return to Visibility, Teams & Attempts'
                : undefined
            }
            onBack={
              screen.returnToEditTestId
                ? () => handleExitFromSpectate(screen.returnToEditTestId!)
                : handleBackFromTestResults
            }
          />
        </Suspense>
      )}

      {screen.kind === 'testsList' && (
        <PracticeTestsList
          tests={availableTests}
          attempts={studentAttempts}
          currentUid={currentUid}
          isTeacher={isTeacher}
          isLoading={isTestsLoading}
          onSelectTest={handleSelectTest}
          onNewTest={handleNewTest}
          onEditTest={(testId) => handleEditTest(testId, 'teams')}
          onOpenQuotesBrowser={handleOpenQuotesBrowser}
          onBack={handleBackFromTestsList}
        />
      )}

      {screen.kind === 'quotesBrowser' && isTeacher && (
        <Suspense fallback={suspenseFallback}>
          <QuoteBrowserView
            tests={availableTests}
            onBack={handleBackFromTeacherScreen}
          />
        </Suspense>
      )}

      {screen.kind === 'testEditor' && isTeacher && (
        <Suspense fallback={suspenseFallback}>
          {screen.editTarget === 'new' ? (
            <TestEditorView
              key={`new:${screen.editorNonce}`}
              mode="create"
              initialPacket={screen.draftTemplate}
              existingTests={availableTests}
              initialTab={screen.tab}
              onTabChange={handleEditorTabChange}
              onBack={handleBackFromTeacherScreen}
              onSaved={() => handleBackFromTeacherScreen()}
              onDeleted={handleBackFromTeacherScreen}
            />
          ) : isTestsLoading ? (
            suspenseFallback
          ) : (() => {
              const targetTest = availableTests.find(
                (t) => t.testId === screen.editTarget
              );
              if (!targetTest) {
                return (
                  <div className="practice-tests-view">
                    <header className="editor-top-header">
                      <button
                        type="button"
                        className="btn-simple btn-tests-back"
                        onClick={handleBackFromTeacherScreen}
                      >
                        ← Practice Tests
                      </button>
                      <h2 className="editor-header-title">Test Not Found</h2>
                    </header>
                    <div className="tests-list-empty">
                      <div className="empty-icon">🔍</div>
                      <p>
                        Practice test <strong>{screen.editTarget}</strong> was not
                        found.
                      </p>
                    </div>
                  </div>
                );
              }
              return (
                <TestEditorView
                  key={`edit:${targetTest.testId}:${screen.editorNonce}`}
                  mode="edit"
                  initialPacket={targetTest}
                  existingTests={availableTests}
                  initialTab={screen.tab}
                  onTabChange={handleEditorTabChange}
                  onInspectAttempt={(attempt) =>
                    handleInspectAttempt(targetTest, attempt)
                  }
                  onBack={handleBackFromTeacherScreen}
                  onSaved={() => handleBackFromTeacherScreen()}
                  onDuplicate={handleDuplicateFromEditor}
                  onDeleted={handleBackFromTeacherScreen}
                />
              );
            })()}
        </Suspense>
      )}

      {isOptionsOpen && (
        <OptionsModal
          key={`${user?.uid ?? 'guest'}:${isTeacher ? 'teacher' : 'student'}:${settings.studentName}:${studentEnabledCiphersKey}`}
          isOpen={true}
          onClose={closeOptions}
          settings={settings}
          generalPracticeCiphers={generalPracticeCiphers}
          onSaveGeneralPracticeCiphers={
            isTeacher ? handleSaveGeneralPracticeCiphers : undefined
          }
        />
      )}

      {isAllowed && (
        <LeaderboardModal
          isOpen={isLeaderboardOpen}
          onClose={closeLeaderboard}
        />
      )}

      <WorkoutSummaryModal
        summary={workoutSummary}
        onStartNextRound={() => {
          if (!workoutSummary) return;
          startWorkout(workoutSummary.round + 1);
        }}
        onExitToMenu={dismissSummary}
      />

      {briefingState && (
        <TestBriefingModal
          testPacket={
            availableTests.find((t) => t.testId === briefingState.testPacket.testId) ??
            briefingState.testPacket
          }
          currentUid={currentUid}
          existingAttempt={briefingState.existingAttempt}
          onLaunchAttempt={handleLaunchAttempt}
          onViewResults={handleViewResultsFromBriefing}
          onClose={closeBriefing}
        />
      )}

      <NotAllowedModal />

      <VersionUpdateModal requiredCriticalVersion={requiredCriticalVersion} />
    </div>
  );
};

export default App;
