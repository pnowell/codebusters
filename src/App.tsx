import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import type {
  CipherType,
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
  getLocalTestAttempt,
  clearLocalTestAttempt,
  resolveFreshestAttempt,
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
  | { kind: 'drill'; drill: CipherType; section: DrillSection; quoteId?: number }
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
      quoteId: route.quoteId,
    };
  }
  if (route.testsList) {
    return { kind: 'testsList' };
  }
  return { kind: 'menu' };
}

export const App: React.FC = () => {
  const { user, isAllowed } = useAuth();
  const [settings, setSettings] = useState<UserSettings>(initSettings);
  const [screen, setScreen] = useState<ActiveScreen>(initScreen);

  const [isOptionsOpen, setIsOptionsOpen] = useState<boolean>(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState<boolean>(false);

  // Practice Test catalog & briefing modal state
  const [availableTests, setAvailableTests] = useState<TestPacket[]>([]);
  const [studentAttempts, setStudentAttempts] = useState<Record<string, TestAttempt>>({});
  const [isTestsLoading, setIsTestsLoading] = useState<boolean>(true);
  const [briefingState, setBriefingState] = useState<BriefingState | null>(null);

  // Pin outer window and track visual viewport height above mobile virtual keyboard
  useVisualViewportHeight();

  const navigateToDrill = useCallback(
    (
      drill: CipherType,
      section: DrillSection = 'memorize',
      quoteId?: number,
      replaceHistory = false
    ) => {
      setScreen({ kind: 'drill', drill, section, quoteId });
      const newUrl = buildRouteUrl({ drill, section, quoteId });
      if (replaceHistory) {
        window.history.replaceState({ drill, section, quoteId }, '', newUrl);
      } else {
        window.history.pushState({ drill, section, quoteId }, '', newUrl);
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

  // Subscribe to all available practice tests in Firestore when user is allowed
  useEffect(() => {
    if (!isAllowed) {
      queueMicrotask(() => {
        setAvailableTests([]);
        setIsTestsLoading(false);
      });
      return;
    }

    return subscribeAvailableTests((tests) => {
      setAvailableTests(tests);
      setIsTestsLoading(false);
    });
  }, [isAllowed]);

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

  // Subscribe to student's test attempts in Firestore
  useEffect(() => {
    if (!isAllowed || !user?.uid) {
      queueMicrotask(() => {
        setStudentAttempts({});
      });
      return;
    }

    return subscribeStudentAttempts(user.uid, (attempts) => {
      setStudentAttempts(attempts);
    });
  }, [isAllowed, user?.uid]);

  // Deep-link direct test launch if ?test=testId is provided
  useEffect(() => {
    const route = parseUrlRoute();
    if (!route.testId || !isAllowed) return;

    const matched = availableTests.find((t) => t.testId === route.testId);
    if (matched) {
      queueMicrotask(() => {
        setScreen({
          kind: 'testRunner',
          testPacket: matched,
          initialAttempt: resolveFreshestAttempt(
            studentAttempts[matched.testId],
            getLocalTestAttempt(matched.testId)
          ),
        });
      });
    } else {
      fetchTestById(route.testId).then((fetched) => {
        if (fetched) {
          setScreen({
            kind: 'testRunner',
            testPacket: fetched,
            initialAttempt: getLocalTestAttempt(fetched.testId),
          });
        }
      });
    }
  }, [isAllowed, availableTests, studentAttempts]);

  // Deep-link direct test results review if ?results=testId is provided
  useEffect(() => {
    const route = parseUrlRoute();
    if (!route.resultsTestId || !isAllowed) return;

    const test = availableTests.find((t) => t.testId === route.resultsTestId);
    const attempt = resolveFreshestAttempt(
      studentAttempts[route.resultsTestId],
      getLocalTestAttempt(route.resultsTestId)
    );
    if (test && attempt?.results) {
      queueMicrotask(() => {
        setScreen({
          kind: 'testResults',
          testPacket: test,
          results: attempt.results!,
          attempt,
        });
      });
    } else if (route.resultsTestId) {
      fetchTestById(route.resultsTestId).then((fetched) => {
        if (fetched) {
          const localAtt = getLocalTestAttempt(fetched.testId);
          if (localAtt?.results) {
            setScreen({
              kind: 'testResults',
              testPacket: fetched,
              results: localAtt.results,
              attempt: localAtt,
            });
          }
        }
      });
    }
  }, [isAllowed, availableTests, studentAttempts]);

  // Listen to browser Back / Forward buttons
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (!e.state || (e.state.modal !== 'options' && e.state.modal !== 'leaderboard')) {
        setIsOptionsOpen(false);
        setIsLeaderboardOpen(false);
      }

      const route = parseUrlRoute();
      if (!route.drill) {
        cancelWorkout();
      }

      if (!route.testId) {
        availableTests.forEach((t) => {
          const local = getLocalTestAttempt(t.testId);
          if (local) {
            setStudentAttempts((prev) => ({
              ...prev,
              [t.testId]: resolveFreshestAttempt(prev[t.testId], local) ?? local,
            }));
          }
        });
      }

      if (route.drill) {
        setScreen({
          kind: 'drill',
          drill: route.drill,
          section: route.section || 'memorize',
          quoteId: route.quoteId,
        });
      } else if (route.testId) {
        const matched = availableTests.find((t) => t.testId === route.testId);
        if (matched) {
          setScreen({
            kind: 'testRunner',
            testPacket: matched,
            initialAttempt: resolveFreshestAttempt(
              studentAttempts[matched.testId],
              getLocalTestAttempt(matched.testId)
            ),
          });
        }
      } else if (route.resultsTestId) {
        const test = availableTests.find((t) => t.testId === route.resultsTestId);
        const attempt = resolveFreshestAttempt(
          studentAttempts[route.resultsTestId],
          getLocalTestAttempt(route.resultsTestId)
        );
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
  }, [availableTests, cancelWorkout, studentAttempts]);

  // Seed history stack with menu when landing directly on a drill deep link
  useEffect(() => {
    const route = parseUrlRoute();
    if (route.drill && (!window.history.state || !('drill' in window.history.state))) {
      window.history.replaceState({ drill: null }, '', window.location.pathname);
      const drillUrl = `${window.location.pathname}${window.location.search}`;
      window.history.pushState(
        { drill: route.drill, section: route.section, quoteId: route.quoteId },
        '',
        drillUrl
      );
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
    const freshest = resolveFreshestAttempt(attempt, getLocalTestAttempt(test.testId));
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
      const newUrl = buildRouteUrl({ drill: null, testsList: true, resultsTestId: test.testId });
      window.history.pushState({ testsList: true, resultsTestId: test.testId }, '', newUrl);
    } else {
      setBriefingState({ testPacket: test, existingAttempt: freshest });
    }
  };

  const handleBackFromTestResults = () => {
    if (window.history.state && window.history.state.resultsTestId) {
      window.history.back();
    } else {
      setScreen({ kind: 'testsList' });
      const newUrl = buildRouteUrl({ drill: null, testsList: true });
      window.history.pushState({ testsList: true }, '', newUrl);
    }
  };

  const handleBeginTest = () => {
    if (!briefingState) return;
    const { testPacket } = briefingState;
    setBriefingState(null);
    clearLocalTestAttempt(testPacket.testId);
    cancelWorkout();
    setScreen({ kind: 'testRunner', testPacket, initialAttempt: null });
    const newUrl = buildRouteUrl({ drill: null, testId: testPacket.testId });
    window.history.pushState({ testId: testPacket.testId }, '', newUrl);
  };

  const handleResumeTest = () => {
    if (!briefingState) return;
    const { testPacket, existingAttempt } = briefingState;
    setBriefingState(null);
    cancelWorkout();
    setScreen({ kind: 'testRunner', testPacket, initialAttempt: existingAttempt });
    const newUrl = buildRouteUrl({ drill: null, testId: testPacket.testId });
    window.history.pushState({ testId: testPacket.testId }, '', newUrl);
  };

  const handleExitTest = () => {
    if (screen.kind === 'testRunner') {
      const testId = screen.testPacket.testId;
      const local = getLocalTestAttempt(testId);
      if (local) {
        setStudentAttempts((prev) => ({
          ...prev,
          [testId]: resolveFreshestAttempt(prev[testId], local) ?? local,
        }));
      }
    }
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
        quoteId: newQuoteId,
      });
      window.history.replaceState(
        { drill: prev.drill, section: prev.section, quoteId: newQuoteId },
        '',
        newUrl
      );
      return { ...prev, quoteId: newQuoteId };
    });
  }, []);

  const openOptions = () => {
    window.history.pushState({ modal: 'options' }, '', window.location.href);
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
    window.history.pushState({ modal: 'leaderboard' }, '', window.location.href);
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
          onSelectDrill={(drill, section) => navigateToDrill(drill, section)}
        />
      )}

      {screen.kind === 'testRunner' && (
        <Suspense fallback={suspenseFallback}>
          <TestRunner
            testPacket={screen.testPacket}
            studentUids={[user?.uid || 'student']}
            initialAttempt={screen.initialAttempt}
            onExitToMenu={handleExitTest}
          />
        </Suspense>
      )}

      {screen.kind === 'drill' && screen.drill === 'offsets' && (
        <LetterOffsetDrill onBack={navigateToMenu} workoutContext={workoutContext} />
      )}

      {screen.kind === 'drill' &&
        isLookupCipher(screen.drill) &&
        (screen.section === 'cipher' || workoutContext ? (
          <Suspense fallback={suspenseFallback}>
            <LookupCipherDrill
              key={`${screen.drill}:${screen.quoteId ?? 'random'}`}
              cipher={screen.drill}
              initialQuoteId={screen.quoteId}
              onQuoteChange={handleQuoteChange}
              onBack={navigateToMenu}
              workoutContext={workoutContext}
            />
          </Suspense>
        ) : (
          <SymbolDrill
            key={screen.drill}
            cipher={screen.drill}
            onBack={navigateToMenu}
          />
        ))}

      {screen.kind === 'testResults' && (
        <Suspense fallback={suspenseFallback}>
          <TestResultsView
            testPacket={screen.testPacket}
            results={screen.results}
            studentUids={screen.attempt?.studentUids}
            teamName={screen.attempt?.teamName}
            onBack={handleBackFromTestResults}
          />
        </Suspense>
      )}

      {screen.kind === 'testsList' && (
        <PracticeTestsList
          tests={availableTests}
          attempts={studentAttempts}
          isLoading={isTestsLoading}
          onSelectTest={handleSelectTest}
          onBack={handleBackFromTestsList}
        />
      )}

      {isOptionsOpen && (
        <OptionsModal
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
          const previouslyPracticed = workoutSummary.results
            .filter((r) => r.cipherId !== 'offsets')
            .map((r) => r.cipherId);
          startWorkout(workoutSummary.round + 1, previouslyPracticed);
        }}
        onExitToMenu={dismissSummary}
      />

      {briefingState && (
        <TestBriefingModal
          testPacket={briefingState.testPacket}
          existingAttempt={briefingState.existingAttempt}
          onBegin={handleBeginTest}
          onResume={handleResumeTest}
          onClose={() => setBriefingState(null)}
        />
      )}

      <NotAllowedModal />
    </div>
  );
};

export default App;
