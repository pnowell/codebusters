import { useState, useCallback, useMemo } from 'react';
import { getDrill } from '../data/drills';
import {
  pickWeightedWarmupDrill,
  pickWeightedWorkoutCiphers,
} from '../utils/workoutWeights';
import type { DrillSection } from '../utils/routing';
import type {
  CipherType,
  LetterMathMode,
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
  offsetsMode?: OffsetsMode;
  letterMathMode?: LetterMathMode;
}

interface UseWorkoutCircuitOptions {
  unlockedCiphers: CipherType[];
  onNavigateToDrill: (
    drill: CipherType,
    section: DrillSection,
    quoteId?: number,
    replaceHistory?: boolean,
    offsetsMode?: OffsetsMode,
    letterMathMode?: LetterMathMode
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
    (round: number) => {
      const warmup = pickWeightedWarmupDrill(unlockedCiphers);
      const nextCiphers = pickWeightedWorkoutCiphers(unlockedCiphers);
      const steps: CipherType[] = [warmup.cipher, ...nextCiphers];
      setWorkoutSummary(null);
      setWorkoutSession({
        round,
        steps,
        currentStepIndex: 0,
        results: [],
        startTime: Date.now(),
        offsetsMode: warmup.offsetsMode,
        letterMathMode: warmup.letterMathMode,
      });
      onNavigateToDrill(
        warmup.cipher,
        'memorize',
        undefined,
        false,
        warmup.offsetsMode,
        warmup.letterMathMode
      );
    },
    [unlockedCiphers, onNavigateToDrill]
  );

  const advanceWorkout = useCallback(
    (stepResult?: Partial<WorkoutStepResult>) => {
      if (!workoutSession) return;

      const currentStepIndex = workoutSession.currentStepIndex;
      const currentCipher = workoutSession.steps[currentStepIndex];
      const currentTitle =
        currentCipher === 'offsets'
          ? 'Letter Offsets'
          : currentCipher === 'letterMath'
          ? workoutSession.letterMathMode === 'letterEasy' ||
            workoutSession.letterMathMode === 'letterHard'
            ? 'ABC ± ABC'
            : 'ABC ± #'
          : getDrill(currentCipher).shortTitle;

      const recordedResult: WorkoutStepResult = {
        cipherId: currentCipher,
        title: currentTitle,
        isWarmup: currentStepIndex === 0,
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
      letterMathMode: workoutSession.letterMathMode,
      nextCipherTitle:
        workoutSession.currentStepIndex + 1 < workoutSession.steps.length
          ? getDrill(workoutSession.steps[workoutSession.currentStepIndex + 1]).shortTitle
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
