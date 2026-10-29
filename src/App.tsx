import React, { useState, useEffect } from 'react';
import type { CipherType, UserSettings, TestPacket, TestAttempt } from './types';
import { LetterOffsetDrill, type WorkoutStepContext } from './components/drills/LetterOffsetDrill';
import { LookupCipherDrill } from './components/drills/LookupCipherDrill';
import { OptionsModal } from './components/options/OptionsModal';
import { LeaderboardModal } from './components/leaderboard/LeaderboardModal';
import { TestRunner } from './components/test/TestRunner';
import { TestBriefingModal } from './components/test/TestBriefingModal';
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
  getNextWorkoutCiphers,
  getWorkoutOffsetsMode,
  saveLastWarmupOffsetsMode,
  type OffsetsMode,
} from './services/storage';
import {
  subscribeActiveTest,
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
  const [activeTest, setActiveTest] = useState<TestPacket | null>(null);
  const [activeTestSession, setActiveTestSession] = useState<TestPacket | null>(null);
  const [isTestBriefingOpen, setIsTestBriefingOpen] = useState<boolean>(false);
  const [existingAttempt, setExistingAttempt] = useState<TestAttempt | null>(null);

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

  // Subscribe to active practice test in Firestore when user is allowed
  useEffect(() => {
    if (!isAllowed) return;

    return subscribeActiveTest((test) => {
      setActiveTest(test);
      if (test) {
        setExistingAttempt(getLocalTestAttempt(test.testId));
      } else {
        setExistingAttempt(null);
      }
    });
  }, [isAllowed]);

  // Deep-link direct test launch if ?test=testId is provided
  useEffect(() => {
    const route = parseUrlRoute();
    if (!route.testId || !isAllowed) return;

    if (activeTest && activeTest.testId === route.testId) {
      queueMicrotask(() => setActiveTestSession(activeTest));
    } else {
      fetchTestById(route.testId).then((fetched) => {
        if (fetched) {
          setActiveTest(fetched);
          setActiveTestSession(fetched);
          setExistingAttempt(getLocalTestAttempt(fetched.testId));
        }
      });
    }
  }, [isAllowed, activeTest]);

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
      if (!route.drill) {
        setWorkoutSession(null);
      }
      if (!route.testId) {
        setActiveTestSession(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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
    if (window.history.state && (window.history.state.drill || window.history.state.testId)) {
      window.history.back();
    } else {
      setActiveDrill(null);
      setActiveQuoteId(undefined);
      const newUrl = buildRouteUrl({ drill: null });
      window.history.pushState({ drill: null }, '', newUrl);
    }
  };

  const handleBeginTest = () => {
    if (!activeTest) return;
    setIsTestBriefingOpen(false);
    clearLocalTestAttempt(activeTest.testId);
    setExistingAttempt(null);
    setActiveTestSession(activeTest);
    setActiveDrill(null);
    setWorkoutSession(null);
    const newUrl = buildRouteUrl({ drill: null, testId: activeTest.testId });
    window.history.pushState({ testId: activeTest.testId }, '', newUrl);
  };

  const handleResumeTest = () => {
    if (!activeTest) return;
    setIsTestBriefingOpen(false);
    setActiveTestSession(activeTest);
    setActiveDrill(null);
    setWorkoutSession(null);
    const newUrl = buildRouteUrl({ drill: null, testId: activeTest.testId });
    window.history.pushState({ testId: activeTest.testId }, '', newUrl);
  };

  const handleExitTest = () => {
    setActiveTestSession(null);
    if (activeTest) {
      setExistingAttempt(getLocalTestAttempt(activeTest.testId));
    }
    if (window.history.state && window.history.state.testId) {
      window.history.back();
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
      {!activeDrill && !activeTestSession && (
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
          studentUid={user?.uid || 'student'}
          studentName={user?.displayName || settings.studentName || 'Decoder'}
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

      {/* Simplified Main Menu Dashboard */}
      {!activeDrill && !activeTestSession && (
        <main className="menu-container">
          {/* Assigned Practice Test Card (Visible to Authenticated Allowed Students) */}
          {isAllowed && activeTest && (
            <div className="practice-test-card">
              <div className="test-card-top-row">
                <span className="test-card-badge">ASSIGNED PRACTICE TEST</span>
                {existingAttempt && existingAttempt.status === 'in_progress' && (
                  <span className="test-card-resume-pill">In Progress</span>
                )}
              </div>
              <h3 className="test-card-title">{activeTest.title}</h3>
              <div className="test-card-meta">
                <span className="test-card-meta-item">⏱️ {Math.round(activeTest.timeLimitSeconds / 60)} Mins</span>
                <span className="test-card-meta-item">🧩 {activeTest.questions.length} Questions</span>
                <span className="test-card-meta-item">⭐ {activeTest.questions.reduce((sum, q) => sum + q.points, 0)} Pts</span>
              </div>
              <button
                className="btn-main-action btn-test-action"
                onClick={() => {
                  if (activeTest) {
                    setExistingAttempt(getLocalTestAttempt(activeTest.testId));
                  }
                  setIsTestBriefingOpen(true);
                }}
              >
                {existingAttempt && existingAttempt.status === 'in_progress'
                  ? 'Resume Practice Test ➔'
                  : 'Take Practice Test ➔'}
              </button>
            </div>
          )}

          {/* General Practice Button at Top */}
          <div className="general-practice-section">
            <button className="btn-main-action" onClick={() => startWorkout(1)}>
              ⚡ General Practice
            </button>
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
      {isTestBriefingOpen && activeTest && (
        <TestBriefingModal
          testPacket={activeTest}
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
