import { useState, useCallback, useMemo } from 'react';
import { getDrill } from '../data/drills';
import {
  getNextWorkoutCiphers,
  getWorkoutOffsetsMode,
  saveLastWarmupOffsetsMode,
} from '../services/storage';
import type { DrillSection } from '../utils/routing';
import type {
  CipherType,
  OffsetsMode,
  WorkoutStepContext,
  WorkoutStepResult,
  WorkoutSummaryData,
} from '../types';

interface WorkoutSession {
  round: number;
  steps: CipherType[];
  currentStepIndex: number;
  results: WorkoutStepResult[];
  startTime: number;
  offsetsMode: OffsetsMode;
}

interface UseWorkoutCircuitOptions {
  unlockedCiphers: CipherType[];
  onNavigateToDrill: (
    drill: CipherType,
    section: DrillSection,
    quoteId?: number,
    replaceHistory?: boolean
  ) => void;
  onExitToMenu: () => void;
}

export function useWorkoutCircuit({
  unlockedCiphers,
  onNavigateToDrill,
  onExitToMenu,
}: UseWorkoutCircuitOptions) {
  const [workoutSession, setWorkoutSession] = useState<WorkoutSession | null>(null);
  const [workoutSummary, setWorkoutSummary] = useState<WorkoutSummaryData | null>(null);

  const startWorkout = useCallback(
    (round: number, excludeCiphers: CipherType[] = []) => {
      const nextCiphers = getNextWorkoutCiphers(unlockedCiphers, excludeCiphers);
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
      onNavigateToDrill('offsets', 'memorize');
    },
    [unlockedCiphers, onNavigateToDrill]
  );

  const advanceWorkout = useCallback(
    (stepResult?: Partial<WorkoutStepResult>) => {
      if (!workoutSession) return;

      const currentStepIndex = workoutSession.currentStepIndex;
      const currentCipher = workoutSession.steps[currentStepIndex];
      const currentTitle =
        currentCipher === 'offsets' ? 'Letter Offsets' : getDrill(currentCipher).name;

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
        onNavigateToDrill(nextCipher, 'cipher', undefined, true);
      } else {
        const totalTimeSeconds = Math.round((Date.now() - workoutSession.startTime) / 1000);
        setWorkoutSummary({
          round: workoutSession.round,
          totalTimeSeconds,
          results: updatedResults,
        });
        setWorkoutSession(null);
        onExitToMenu();
      }
    },
    [workoutSession, onNavigateToDrill, onExitToMenu]
  );

  const cancelWorkout = useCallback(() => {
    setWorkoutSession(null);
  }, []);

  const dismissSummary = useCallback(() => {
    setWorkoutSummary(null);
  }, []);

  const workoutContext: WorkoutStepContext | undefined = useMemo(() => {
    if (!workoutSession) return undefined;
    return {
      round: workoutSession.round,
      stepIndex: workoutSession.currentStepIndex,
      totalSteps: workoutSession.steps.length,
      offsetsMode: workoutSession.offsetsMode,
      nextCipherTitle:
        workoutSession.currentStepIndex + 1 < workoutSession.steps.length
          ? getDrill(workoutSession.steps[workoutSession.currentStepIndex + 1]).name
          : undefined,
      isLastStep: workoutSession.currentStepIndex === workoutSession.steps.length - 1,
      onAdvance: advanceWorkout,
    };
  }, [workoutSession, advanceWorkout]);

  return {
    workoutContext,
    workoutSummary,
    startWorkout,
    cancelWorkout,
    dismissSummary,
  };
}
