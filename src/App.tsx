import React, { useState, useEffect } from 'react';
import type { CipherType, UserSettings, TestPacket, TestAttempt, TestEvaluationResult } from './types';
import { LetterOffsetDrill, type WorkoutStepContext } from './components/drills/LetterOffsetDrill';
import { LookupCipherDrill } from './components/drills/LookupCipherDrill';
import { OptionsModal } from './components/options/OptionsModal';
import { LeaderboardModal } from './components/leaderboard/LeaderboardModal';
import { TestRunner } from './components/test/TestRunner';
import { TestBriefingModal } from './components/test/TestBriefingModal';
import { PracticeTestsList } from './components/test/PracticeTestsList';
import { TestResultsView } from './components/test/TestResultsView';
import {
  WorkoutSummaryModal,
  type WorkoutSummaryData,
  type WorkoutStepResult,
} from './components/workout/WorkoutSummaryModal';
import {
  IMPLEMENTED_DRILLS,
  COMING_SOON_DRILLS,
  isLookupCipher,
  getDrill,
} from './data/drills';
import {
  loadSettings,
  saveSettings,
  withoutSyncDispatch,
  getNextWorkoutCiphers,
  getWorkoutOffsetsMode,
  saveLastWarmupOffsetsMode,
  type OffsetsMode,
} from './services/storage';
import {
  subscribeAvailableTests,
  subscribeStudentAttempts,
  fetchTestById,
  getLocalTestAttempt,
  clearLocalTestAttempt,
} from './services/testService';
import { subscribeToSyncUpdates } from './services/sync';
import { UserAuthBadge } from './components/auth/UserAuthBadge';
import { NotAllowedModal } from './components/auth/NotAllowedModal';
import { parseUrlRoute, buildRouteUrl, parseUnlockedParam } from './utils/routing';
import { useVisualViewportHeight } from './hooks/useVisualViewportHeight';
import { useAuth } from './context/useAuth';
import { subscribeTeamProfiles } from './services/profileService';

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

interface WorkoutSession {
  round: number;
  steps: CipherType[];
  currentStepIndex: number;
  results: WorkoutStepResult[];
  startTime: number;
  offsetsMode: OffsetsMode;
}

export const App: React.FC = () => {
  const { user, isAllowed } = useAuth();
  const [settings, setSettings] = useState<UserSettings>(initSettings);

  const [activeDrill, setActiveDrill] = useState<CipherType | null>(() => parseUrlRoute().drill);
  const [activeQuoteId, setActiveQuoteId] = useState<number | undefined>(() => parseUrlRoute().quoteId);
  const [isOptionsOpen, setIsOptionsOpen] = useState<boolean>(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState<boolean>(false);

  // Practice Test states
  const [availableTests, setAvailableTests] = useState<TestPacket[]>([]);
  const [studentAttempts, setStudentAttempts] = useState<Record<string, TestAttempt>>({});
  const [isTestsLoading, setIsTestsLoading] = useState<boolean>(true);
  const [isTestsListOpen, setIsTestsListOpen] = useState<boolean>(() => parseUrlRoute().testsList ?? false);
  const [selectedTest, setSelectedTest] = useState<TestPacket | null>(null);
  const [activeTestSession, setActiveTestSession] = useState<TestPacket | null>(null);
  const [isTestBriefingOpen, setIsTestBriefingOpen] = useState<boolean>(false);
  const [existingAttempt, setExistingAttempt] = useState<TestAttempt | null>(null);
  const [selectedCompletedTest, setSelectedCompletedTest] = useState<{
    testPacket: TestPacket;
    results: TestEvaluationResult;
    attempt?: TestAttempt;
  } | null>(null);

  // Workout Circuit Session & Summary States
  const [workoutSession, setWorkoutSession] = useState<WorkoutSession | null>(null);
  const [workoutSummary, setWorkoutSummary] = useState<WorkoutSummaryData | null>(null);

  // Pin outer window and track visual viewport height above mobile virtual keyboard
  useVisualViewportHeight();

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
            withoutSyncDispatch(() => {
              saveSettings({ ...cur, studentName: myProfile.displayName });
            });
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
        setSelectedTest(matched);
        setActiveTestSession(matched);
        setExistingAttempt(getLocalTestAttempt(matched.testId));
      });
    } else {
      fetchTestById(route.testId).then((fetched) => {
        if (fetched) {
          setSelectedTest(fetched);
          setActiveTestSession(fetched);
          setExistingAttempt(getLocalTestAttempt(fetched.testId));
        }
      });
    }
  }, [isAllowed, availableTests]);

  // Deep-link direct test results review if ?results=testId is provided
  useEffect(() => {
    const route = parseUrlRoute();
    if (!route.resultsTestId || !isAllowed) return;

    const test = availableTests.find((t) => t.testId === route.resultsTestId);
    const attempt = studentAttempts[route.resultsTestId] || getLocalTestAttempt(route.resultsTestId);
    if (test && attempt?.results) {
      queueMicrotask(() => {
        setSelectedCompletedTest({ testPacket: test, results: attempt.results!, attempt });
      });
    } else if (route.resultsTestId) {
      fetchTestById(route.resultsTestId).then((fetched) => {
        if (fetched) {
          const localAtt = getLocalTestAttempt(fetched.testId);
          if (localAtt?.results) {
            setSelectedCompletedTest({ testPacket: fetched, results: localAtt.results, attempt: localAtt });
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
      setActiveDrill(route.drill);
      setActiveQuoteId(route.quoteId);
      setIsTestsListOpen(Boolean(route.testsList));
      if (!route.resultsTestId) {
        setSelectedCompletedTest(null);
      } else {
        const test = availableTests.find((t) => t.testId === route.resultsTestId);
        const attempt = studentAttempts[route.resultsTestId] || getLocalTestAttempt(route.resultsTestId);
        if (test && attempt?.results) {
          setSelectedCompletedTest({ testPacket: test, results: attempt.results, attempt });
        }
      }
      if (!route.drill) {
        setWorkoutSession(null);
      }
      if (!route.testId) {
        setActiveTestSession(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [availableTests, studentAttempts]);

  // Handle deep-link history: if user lands directly on a drill from a link,
  // seed the history stack with the menu first so browser back goes to menu instead of closing app
  useEffect(() => {
    const route = parseUrlRoute();
    if (route.drill && (!window.history.state || !('drill' in window.history.state))) {
      window.history.replaceState({ drill: null }, '', window.location.pathname);
      const drillUrl = `${window.location.pathname}${window.location.search}`;
      window.history.pushState({ drill: route.drill, quoteId: route.quoteId }, '', drillUrl);
    }
  }, []);

  const navigateToDrill = (drill: CipherType, quoteId?: number, replaceHistory = false) => {
    setActiveTestSession(null);
    setIsTestsListOpen(false);
    setSelectedCompletedTest(null);
    setActiveDrill(drill);
    setActiveQuoteId(quoteId);
    const newUrl = buildRouteUrl({ drill, quoteId });
    if (replaceHistory) {
      window.history.replaceState({ drill, quoteId }, '', newUrl);
    } else {
      window.history.pushState({ drill, quoteId }, '', newUrl);
    }
  };

  const navigateToMenu = () => {
    setWorkoutSession(null);
    setActiveTestSession(null);
    setIsTestsListOpen(false);
    setSelectedCompletedTest(null);
    if (window.history.state && (window.history.state.drill || window.history.state.testId || window.history.state.testsList)) {
      window.history.back();
    } else {
      setActiveDrill(null);
      setActiveQuoteId(undefined);
      const newUrl = buildRouteUrl({ drill: null });
      window.history.pushState({ drill: null }, '', newUrl);
    }
  };

  const handleOpenTestsList = () => {
    setIsTestsListOpen(true);
    setSelectedCompletedTest(null);
    const newUrl = buildRouteUrl({ drill: null, testsList: true });
    window.history.pushState({ testsList: true }, '', newUrl);
  };

  const handleBackFromTestsList = () => {
    setSelectedCompletedTest(null);
    if (window.history.state && window.history.state.testsList) {
      window.history.back();
    } else {
      setIsTestsListOpen(false);
      const newUrl = buildRouteUrl({ drill: null });
      window.history.pushState({ drill: null }, '', newUrl);
    }
  };

  const handleSelectTest = (test: TestPacket, attempt: TestAttempt | null) => {
    if (attempt && (attempt.status === 'submitted' || attempt.status === 'expired') && attempt.results) {
      setSelectedCompletedTest({ testPacket: test, results: attempt.results, attempt });
      const newUrl = buildRouteUrl({ drill: null, testsList: true, resultsTestId: test.testId });
      window.history.pushState({ testsList: true, resultsTestId: test.testId }, '', newUrl);
    } else {
      setSelectedTest(test);
      setExistingAttempt(attempt);
      setIsTestBriefingOpen(true);
    }
  };

  const handleBackFromTestResults = () => {
    setSelectedCompletedTest(null);
    if (window.history.state && window.history.state.resultsTestId) {
      window.history.back();
    } else {
      const newUrl = buildRouteUrl({ drill: null, testsList: true });
      window.history.pushState({ testsList: true }, '', newUrl);
    }
  };

  const handleBeginTest = () => {
    if (!selectedTest) return;
    setIsTestBriefingOpen(false);
    clearLocalTestAttempt(selectedTest.testId);
    setExistingAttempt(null);
    setActiveTestSession(selectedTest);
    setActiveDrill(null);
    setWorkoutSession(null);
    const newUrl = buildRouteUrl({ drill: null, testId: selectedTest.testId });
    window.history.pushState({ testId: selectedTest.testId }, '', newUrl);
  };

  const handleResumeTest = () => {
    if (!selectedTest) return;
    setIsTestBriefingOpen(false);
    setActiveTestSession(selectedTest);
    setActiveDrill(null);
    setWorkoutSession(null);
    const newUrl = buildRouteUrl({ drill: null, testId: selectedTest.testId });
    window.history.pushState({ testId: selectedTest.testId }, '', newUrl);
  };

  const handleExitTest = () => {
    setActiveTestSession(null);
    if (selectedTest) {
      setExistingAttempt(getLocalTestAttempt(selectedTest.testId));
    }
    if (window.history.state && window.history.state.testId) {
      window.history.back();
    } else if (isTestsListOpen) {
      const newUrl = buildRouteUrl({ drill: null, testsList: true });
      window.history.pushState({ testsList: true }, '', newUrl);
    } else {
      const newUrl = buildRouteUrl({ drill: null });
      window.history.pushState({ drill: null }, '', newUrl);
    }
  };

  const handleQuoteChange = (newQuoteId: number) => {
    setActiveQuoteId(newQuoteId);
    if (activeDrill) {
      const newUrl = buildRouteUrl({ drill: activeDrill, quoteId: newQuoteId });
      window.history.replaceState({ drill: activeDrill, quoteId: newQuoteId }, '', newUrl);
    }
  };

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

  // Launch General Practice Workout Circuit
  const startWorkout = (round: number, excludeCiphers: CipherType[] = []) => {
    const nextCiphers = getNextWorkoutCiphers(settings.unlockedCiphers, excludeCiphers);
    const steps: CipherType[] = ['offsets', ...nextCiphers];
    const offsetsMode = getWorkoutOffsetsMode(round);
    setWorkoutSummary(null);
    setWorkoutSession({
      round,
      steps,
      currentStepIndex: 0,
      results: [],
      startTime: Date.now(),
      offsetsMode,
    });
    navigateToDrill('offsets');
  };

  const handleAdvanceWorkout = (stepResult?: Partial<WorkoutStepResult>) => {
    if (!workoutSession) return;

    const currentStepIndex = workoutSession.currentStepIndex;
    const currentCipher = workoutSession.steps[currentStepIndex];
    const currentTitle = currentCipher === 'offsets' ? 'Letter Offsets' : getDrill(currentCipher).name;

    if (currentStepIndex === 0 && stepResult?.offsetsMode) {
      saveLastWarmupOffsetsMode(stepResult.offsetsMode);
    }

    const recordedResult: WorkoutStepResult = {
      cipherId: currentCipher,
      title: currentTitle,
      ...stepResult,
    };

    const updatedResults = [...workoutSession.results, recordedResult];
    const nextStepIndex = currentStepIndex + 1;

    if (nextStepIndex < workoutSession.steps.length) {
      const nextCipher = workoutSession.steps[nextStepIndex];
      setWorkoutSession({
        ...workoutSession,
        currentStepIndex: nextStepIndex,
        results: updatedResults,
      });
      navigateToDrill(nextCipher, undefined, true);
    } else {
      // Complete round
      const totalTimeSeconds = Math.round((Date.now() - workoutSession.startTime) / 1000);
      setWorkoutSummary({
        round: workoutSession.round,
        totalTimeSeconds,
        results: updatedResults,
      });
      setWorkoutSession(null);
      navigateToMenu();
    }
  };

  const workoutContext: WorkoutStepContext | undefined = workoutSession
    ? {
        round: workoutSession.round,
        stepIndex: workoutSession.currentStepIndex,
        totalSteps: workoutSession.steps.length,
        offsetsMode: workoutSession.offsetsMode,
        nextCipherTitle:
          workoutSession.currentStepIndex + 1 < workoutSession.steps.length
            ? getDrill(workoutSession.steps[workoutSession.currentStepIndex + 1]).name
            : undefined,
        isLastStep: workoutSession.currentStepIndex === workoutSession.steps.length - 1,
        onAdvance: handleAdvanceWorkout,
      }
    : undefined;

  const handleIndividualDrillClick = (drillId: CipherType) => {
    setWorkoutSession(null);
    navigateToDrill(drillId);
  };

  return (
    <div className="app-container">
      {/* Main Header only visible on the main menu */}
      {!activeDrill && !activeTestSession && !selectedCompletedTest && !isTestsListOpen && (
        <header className="main-header">
          <div className="brand-text">
            <h1>DaVinci Decoders</h1>
            <div className="subtitle">Science Olympiad Division A Trainer</div>
          </div>

          <div className="header-user-actions">
            <UserAuthBadge onOpenOptions={openOptions} />
            {isAllowed && (
              <button
                type="button"
                className="btn-simple btn-icon-square"
                onClick={openLeaderboard}
                title="Team Leaderboard"
                aria-label="Team Leaderboard"
              >
                <span className="btn-icon">🏆</span>
              </button>
            )}
            <button
              type="button"
              className="btn-simple btn-icon-square"
              onClick={openOptions}
              title="Classroom Settings"
              aria-label="Classroom Settings"
            >
              <span className="btn-icon">⚙️</span>
            </button>
          </div>
        </header>
      )}

      {/* Active Practice Test Runner */}
      {activeTestSession && (
        <TestRunner
          testPacket={activeTestSession}
          studentUids={[user?.uid || 'student']}
          initialAttempt={existingAttempt}
          onExitToMenu={handleExitTest}
        />
      )}

      {/* Active Drill View */}
      {activeDrill === 'offsets' && !activeTestSession && (
        <LetterOffsetDrill onBack={navigateToMenu} workoutContext={workoutContext} />
      )}

      {activeDrill && isLookupCipher(activeDrill) && !activeTestSession && (
        <LookupCipherDrill
          key={`${activeDrill}:${activeQuoteId ?? 'random'}`}
          cipher={activeDrill}
          initialQuoteId={activeQuoteId}
          onQuoteChange={handleQuoteChange}
          onBack={navigateToMenu}
          workoutContext={workoutContext}
        />
      )}

      {/* Practice Test Results Page View */}
      {!activeDrill && !activeTestSession && selectedCompletedTest && (
        <TestResultsView
          testPacket={selectedCompletedTest.testPacket}
          results={selectedCompletedTest.results}
          studentUids={selectedCompletedTest.attempt?.studentUids}
          teamName={selectedCompletedTest.attempt?.teamName}
          onBack={handleBackFromTestResults}
        />
      )}

      {/* Practice Tests List View */}
      {!activeDrill && !activeTestSession && !selectedCompletedTest && isTestsListOpen && (
        <PracticeTestsList
          tests={availableTests}
          attempts={studentAttempts}
          isLoading={isTestsLoading}
          onSelectTest={handleSelectTest}
          onBack={handleBackFromTestsList}
        />
      )}

      {/* Simplified Main Menu Dashboard */}
      {!activeDrill && !activeTestSession && !selectedCompletedTest && !isTestsListOpen && (
        <main className="menu-container">
          {/* Featured Practice Actions */}
          <div className="menu-featured-actions">
            <button className="menu-action-btn" onClick={() => startWorkout(1)}>
              ⚡ General Practice
            </button>
            {isAllowed && (
              <button
                className="menu-action-btn"
                onClick={handleOpenTestsList}
              >
                📝 Practice Tests
              </button>
            )}
          </div>

          {/* Divider: Individual Practice */}
          <div className="menu-divider">
            <span>Individual Practice</span>
          </div>

          <div className="menu-buttons-list">
            {IMPLEMENTED_DRILLS.map(d => (
              <button
                key={d.id}
                className="menu-drill-btn"
                onClick={() => handleIndividualDrillClick(d.id)}
              >
                {d.name}
              </button>
            ))}
          </div>

          {/* Divider: Coming Soon */}
          <div className="menu-divider coming-soon-divider">
            <span>Coming Soon</span>
          </div>

          <div className="menu-buttons-list disabled-list">
            {COMING_SOON_DRILLS.map(d => (
              <button key={d.id} className="menu-drill-btn btn-disabled" disabled>
                {d.name}
              </button>
            ))}
          </div>
        </main>
      )}

      {/* Settings Modal */}
      {isOptionsOpen && (
        <OptionsModal
          isOpen={true}
          onClose={closeOptions}
          settings={settings}
          onSaveSettings={handleSaveSettings}
        />
      )}

      {/* Team Leaderboard Modal */}
      {isAllowed && (
        <LeaderboardModal
          isOpen={isLeaderboardOpen}
          onClose={closeLeaderboard}
        />
      )}

      {/* Workout Summary Modal */}
      {workoutSummary && (
        <WorkoutSummaryModal
          summary={workoutSummary}
          onStartNextRound={() => {
            const previouslyPracticed = workoutSummary.results
              .filter(r => r.cipherId !== 'offsets')
              .map(r => r.cipherId);
            startWorkout(workoutSummary.round + 1, previouslyPracticed);
          }}
          onExitToMenu={() => setWorkoutSummary(null)}
        />
      )}

      {/* Practice Test Briefing Modal */}
      {isTestBriefingOpen && selectedTest && (
        <TestBriefingModal
          testPacket={selectedTest}
          existingAttempt={existingAttempt}
          onBegin={handleBeginTest}
          onResume={handleResumeTest}
          onClose={() => setIsTestBriefingOpen(false)}
        />
      )}

      {/* Roster Access Modal */}
      <NotAllowedModal />
    </div>
  );
};

export default App;
