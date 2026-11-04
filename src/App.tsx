import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import type {
  CipherType,
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
import { isLookupCipher } from './data/drills';
import {
  loadSettings,
  saveSettings,
  withoutSyncDispatch,
} from './services/storage';
import {
  subscribeAvailableTests,
  subscribeStudentAttempts,
  fetchTestById,
  resolveAttemptForTest,
} from './services/testService';
import { subscribeToSyncUpdates } from './services/sync';
import { subscribeTeamProfiles } from './services/profileService';
import {
  parseUrlRoute,
  buildRouteUrl,
  parseUnlockedParam,
  type DrillSection,
} from './utils/routing';
import { useVisualViewportHeight } from './hooks/useVisualViewportHeight';
import { useOuterMarginScroll } from './hooks/useOuterMarginScroll';
import { useWorkoutCircuit } from './hooks/useWorkoutCircuit';
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
  | { kind: 'testRunner'; testPacket: TestPacket; initialAttempt: TestAttempt | null }
  | {
      kind: 'testResults';
      testPacket: TestPacket;
      results: TestEvaluationResult;
      attempt?: TestAttempt;
    };

interface BriefingState {
  testPacket: TestPacket;
  existingAttempt: TestAttempt | null;
}

function initSettings(): UserSettings {
  const loaded = loadSettings();
  const ciphersFromUrl = parseUnlockedParam();
  if (ciphersFromUrl) {
    const updated = { ...loaded, unlockedCiphers: ciphersFromUrl };
    saveSettings(updated);
    return updated;
  }
  return loaded;
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
  if (route.testsList) {
    return { kind: 'testsList' };
  }
  return { kind: 'menu' };
}

export const App: React.FC = () => {
  const { user, allowedUser, isAllowed } = useAuth();
  const isTeacher = allowedUser?.role === 'teacher';
  const currentUid = user?.uid || 'student';

  const [settings, setSettings] = useState<UserSettings>(initSettings);
  const [screen, setScreen] = useState<ActiveScreen>(initScreen);

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

  const {
    workoutContext,
    workoutSummary,
    startWorkout,
    cancelWorkout,
    dismissSummary,
  } = useWorkoutCircuit({
    unlockedCiphers: settings.unlockedCiphers,
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

  // Subscribe to Team Public Profiles (in-memory name lookup and high score sync)
  useEffect(() => {
    if (!isAllowed) return;
    return subscribeTeamProfiles((profiles) => {
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

  // Deep-link direct test launch if ?test=testId is provided
  useEffect(() => {
    const route = parseUrlRoute();
    if (!route.testId || !isAllowed || isTestsLoading || !isAttemptsLoaded) return;
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

  // Seed history stack with menu when landing directly on a drill or tests list deep link
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

  const handleSaveSettings = (newSettings: UserSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const suspenseFallback = (
    <div className="drill-loading-state">Loading cipher workspace...</div>
  );

  return (
    <div className="app-container">
      {screen.kind === 'menu' && (
        <MainMenu
          studentName={settings.studentName}
          isAllowed={isAllowed}
          onStartWorkout={() => startWorkout(1)}
          onOpenTestsList={handleOpenTestsList}
          onOpenLeaderboard={openLeaderboard}
          onOpenOptions={openOptions}
          onSelectDrill={(drill, section, offsetsMode) =>
            navigateToDrill(drill, section, undefined, false, offsetsMode)
          }
        />
      )}

      {screen.kind === 'testRunner' && (
        <Suspense fallback={suspenseFallback}>
          <TestRunner
            testPacket={
              availableTests.find((t) => t.testId === screen.testPacket.testId) ??
              screen.testPacket
            }
            currentUid={currentUid}
            initialAttempt={screen.initialAttempt}
            onExitToMenu={handleExitTest}
          />
        </Suspense>
      )}

      {screen.kind === 'drill' && screen.drill === 'offsets' && (
        <LetterOffsetDrill
          key={workoutContext ? `workout-${workoutContext.round}-${workoutContext.stepIndex}` : 'standalone'}
          initialMode={screen.offsetsMode}
          onModeChange={handleOffsetsModeChange}
          onBack={navigateToMenu}
          workoutContext={workoutContext}
        />
      )}

      {screen.kind === 'drill' &&
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
            onBack={handleBackFromTestResults}
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
          onBack={handleBackFromTestsList}
        />
      )}

      {isOptionsOpen && (
        <OptionsModal
          key={`${user?.uid ?? 'guest'}:${settings.studentName}:${settings.unlockedCiphers.join(',')}`}
          isOpen={true}
          onClose={closeOptions}
          settings={settings}
          onSaveSettings={handleSaveSettings}
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
    </div>
  );
};

export default App;
