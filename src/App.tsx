import React, { useState, useEffect } from 'react';
import type { CipherType, UserSettings } from './types';
import { LetterOffsetDrill, type WorkoutStepContext } from './components/drills/LetterOffsetDrill';
import { LookupCipherDrill } from './components/drills/LookupCipherDrill';
import { OptionsModal } from './components/options/OptionsModal';
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
import { parseUrlRoute, buildRouteUrl, parseUnlockedParam } from './utils/routing';
import { useVisualViewportHeight } from './hooks/useVisualViewportHeight';

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
  const [settings, setSettings] = useState<UserSettings>(initSettings);

  const [activeDrill, setActiveDrill] = useState<CipherType | null>(() => parseUrlRoute().drill);
  const [activeQuoteId, setActiveQuoteId] = useState<number | undefined>(() => parseUrlRoute().quoteId);
  const [isOptionsOpen, setIsOptionsOpen] = useState<boolean>(false);

  // Workout Circuit Session & Summary States
  const [workoutSession, setWorkoutSession] = useState<WorkoutSession | null>(null);
  const [workoutSummary, setWorkoutSummary] = useState<WorkoutSummaryData | null>(null);

  // Pin outer window and track visual viewport height above mobile virtual keyboard
  useVisualViewportHeight();

  // Listen to browser Back / Forward buttons
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (!e.state || e.state.modal !== 'options') {
        setIsOptionsOpen(false);
      }
      const route = parseUrlRoute();
      setActiveDrill(route.drill);
      setActiveQuoteId(route.quoteId);
      if (!route.drill) {
        setWorkoutSession(null);
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
    if (window.history.state && window.history.state.drill) {
      window.history.back();
    } else {
      setActiveDrill(null);
      setActiveQuoteId(undefined);
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
      {!activeDrill && (
        <header className="main-header">
          <div className="brand-text">
            <h1>DaVinci Decoders</h1>
            <div className="subtitle">Science Olympiad Division A Trainer</div>
          </div>

          <div className="header-user-actions">
            <span className="student-tag">👤 {settings.studentName}</span>
            <button
              className="btn-simple"
              onClick={openOptions}
              title="Classroom Settings"
            >
              ⚙️ Options
            </button>
          </div>
        </header>
      )}

      {/* Active Drill View */}
      {activeDrill === 'offsets' && (
        <LetterOffsetDrill onBack={navigateToMenu} workoutContext={workoutContext} />
      )}

      {activeDrill && isLookupCipher(activeDrill) && (
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
      {!activeDrill && (
        <main className="menu-container">
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
    </div>
  );
};

export default App;
