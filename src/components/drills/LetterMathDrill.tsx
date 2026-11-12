import React, { useState, useEffect, useCallback, useRef } from 'react';
import { letterMathModeToDrillId } from '../../services/storage';
import type { LetterMathMode, WorkoutStepContext } from '../../types';
import {
  generateLetterMathProblem,
  type LetterMathProblem,
} from '../../utils/ciphers';
import { useVelocityTracker } from '../../hooks/useVelocityTracker';
import { useFloatingGhosts } from '../../hooks/useFloatingGhosts';
import { useWarmupTimer } from '../../hooks/useWarmupTimer';
import { useWrongAnswerLockout } from '../../hooks/useWrongAnswerLockout';
import { DrillHeader } from './shared/DrillHeader';
import { WarmupHeaderRight } from './shared/WarmupHeaderRight';
import { FlashcardWorkspace } from './shared/FlashcardWorkspace';
import { LeaderboardModal } from '../leaderboard/LeaderboardModal';
import { useAuth } from '../../context/useAuth';
import { useIsLargeDrillStage } from '../../hooks/useIsLargeDrillStage';

interface LetterMathDrillProps {
  initialMode?: LetterMathMode;
  onModeChange?: (mode: LetterMathMode) => void;
  onBack: () => void;
  workoutContext?: WorkoutStepContext;
}

export const HINT_DELAY_MS = 4000;

const NUMBER_MODES: readonly { readonly id: LetterMathMode; readonly label: string }[] = [
  { id: 'easy', label: 'Easy (±3)' },
  { id: 'hard', label: 'Hard (Any)' },
];

const LETTER_MODES: readonly { readonly id: LetterMathMode; readonly label: string }[] = [
  { id: 'letterEasy', label: 'Easy' },
  { id: 'letterHard', label: 'Hard' },
];

const NON_ANSWER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'Tab',
  'Escape',
]);

interface LetterMathSessionProps {
  mode: LetterMathMode;
  onModeChange: (newMode: LetterMathMode) => void;
  elapsedWarmup: number;
  onSkipWarmup: () => void;
  totalQuestions: number;
  correctQuestions: number;
  onRecordAnswer: (isCorrect: boolean) => void;
  onBack: () => void;
  workoutContext?: WorkoutStepContext;
}

const LetterMathSession: React.FC<LetterMathSessionProps> = ({
  mode,
  onModeChange,
  elapsedWarmup,
  onSkipWarmup,
  totalQuestions,
  correctQuestions,
  onRecordAnswer,
  onBack,
  workoutContext,
}) => {
  const { isAllowed } = useAuth();
  const drillId = letterMathModeToDrillId(mode);
  const isLetterOperand = mode === 'letterEasy' || mode === 'letterHard';
  const isHardMode = mode === 'hard' || mode === 'letterHard';

  const [cardState, setCardState] = useState<{
    seq: number;
    problem: LetterMathProblem;
  }>(() => ({
    seq: 1,
    problem: generateLetterMathProblem(mode),
  }));
  const [revealedHintSeq, setRevealedHintSeq] = useState<number | null>(null);
  const problem = cardState.problem;
  const cardSeq = cardState.seq;

  const {
    scores,
    current60s,
    sessionBest60s,
    streak,
    newRecordAlert,
    heat,
    barPercent,
    recordHit,
    recordMiss,
    flushSession,
  } = useVelocityTracker(drillId);

  const { ghosts, spawnGhost, removeGhost } = useFloatingGhosts();
  const {
    wrongAnswer,
    correctAnswer,
    isWrong,
    isLockedRef,
    lockoutDurationMs,
    lockoutId,
    shakeCycle,
    triggerWrongLockout,
    registerBlockedInput,
  } = useWrongAnswerLockout();

  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState<boolean>(false);
  const [inputVal, setInputVal] = useState<string>('');
  const answerInputRef = useRef<HTMLInputElement | null>(null);

  const focusAnswerInput = useCallback(() => {
    setTimeout(() => {
      if (document.querySelector('[role="dialog"]')) return;
      answerInputRef.current?.focus();
    }, 40);
  }, []);

  useEffect(() => {
    focusAnswerInput();
  }, [focusAnswerInput]);

  // Reveal numeric offset hint next to the letter(s) if staring at the card for >= 4 seconds
  useEffect(() => {
    if (isWrong || isLeaderboardOpen) return;
    const timer = setTimeout(() => {
      setRevealedHintSeq(cardSeq);
    }, HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [cardSeq, isLeaderboardOpen, isWrong]);

  const showOffsetHint =
    revealedHintSeq === cardSeq && !isWrong && !isLeaderboardOpen;

  const advanceProblem = useCallback(() => {
    setCardState((prev) => ({
      seq: prev.seq + 1,
      problem: generateLetterMathProblem(mode, undefined, prev.problem.key),
    }));
  }, [mode]);

  const submitAnswerValue = useCallback(
    (rawVal: string) => {
      if (isLeaderboardOpen || document.querySelector('[role="dialog"]')) {
        return;
      }
      if (isLockedRef.current) {
        registerBlockedInput();
        return;
      }

      const trimmed = rawVal.trim().toUpperCase();
      if (!/^[A-Z]$/.test(trimmed)) return;

      const isCorrect = trimmed === problem.answerLetter;
      onRecordAnswer(isCorrect);

      const displayOp = problem.op === '-' ? '−' : '+';

      if (isCorrect) {
        recordHit();
        spawnGhost(
          `${problem.baseLetter} ${displayOp} ${problem.bottomOperandLabel} = ${problem.answerLetter} ✓`
        );
        setInputVal('');
        advanceProblem();
        focusAnswerInput();
      } else {
        setInputVal('');
        recordMiss();

        triggerWrongLockout(trimmed, problem.answerLetter, () => {
          setInputVal('');
          advanceProblem();
          focusAnswerInput();
        });
      }
    },
    [
      advanceProblem,
      focusAnswerInput,
      isLeaderboardOpen,
      isLockedRef,
      onRecordAnswer,
      problem.answerLetter,
      problem.baseLetter,
      problem.bottomOperandLabel,
      problem.op,
      recordHit,
      recordMiss,
      registerBlockedInput,
      spawnGhost,
      triggerWrongLockout,
    ]
  );

  const latestRef = useRef({
    submitAnswerValue,
    registerBlockedInput,
  });
  useEffect(() => {
    latestRef.current = {
      submitAnswerValue,
      registerBlockedInput,
    };
  }, [registerBlockedInput, submitAnswerValue]);

  // Global typing listener for instant single-letter A-Z submission
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.target instanceof HTMLInputElement && e.target !== answerInputRef.current) {
        return;
      }
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) {
        return;
      }

      if (e.repeat && (/^[a-zA-Z0-9]$/.test(e.key) || e.key === 'Enter' || e.key === 'Backspace')) {
        e.preventDefault();
        return;
      }

      const {
        submitAnswerValue: handleSubmitVal,
        registerBlockedInput: handleBlocked,
      } = latestRef.current;

      if (isLockedRef.current) {
        if (NON_ANSWER_KEYS.has(e.key)) {
          return;
        }
        e.preventDefault();
        handleBlocked();
        return;
      }

      if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        const ch = e.key.toUpperCase();
        setInputVal(ch);
        handleSubmitVal(ch);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setInputVal('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLockedRef]);

  const handleAdvanceWarmup = useCallback(() => {
    flushSession(true);
    workoutContext?.onAdvance({
      warmup60s: sessionBest60s,
      letterMathMode: mode,
    });
  }, [flushSession, mode, sessionBest60s, workoutContext]);

  const isLargeStage = useIsLargeDrillStage();
  const baseTitleLabel = isLetterOperand ? 'ABC ± ABC' : 'ABC ± #';
  const modeLabel = isHardMode ? 'Hard' : 'Easy';
  const headerTitle = workoutContext
    ? `Warm-up: ${baseTitleLabel} (${modeLabel})`
    : `${baseTitleLabel} (${modeLabel})`;

  const headerRight = (
    <WarmupHeaderRight
      workoutContext={workoutContext}
      elapsedWarmup={elapsedWarmup}
      onSkipWarmup={onSkipWarmup}
      onAdvanceWarmup={handleAdvanceWarmup}
      menuProps={{
        modeOptions: isLetterOperand ? LETTER_MODES : NUMBER_MODES,
        activeMode: mode,
        onSelectMode: (newMode) => onModeChange(newMode as LetterMathMode),
        onOpenLeaderboard:
          !isLargeStage && isAllowed ? () => setIsLeaderboardOpen(true) : undefined,
        onCloseFocusRestore: focusAnswerInput,
      }}
    />
  );

  return (
    <div className="drill-container">
      <DrillHeader title={headerTitle} onBack={onBack} right={headerRight} />

      <div className="drill-stage-viewport">
        <div className="drill-stage-group">
          <FlashcardWorkspace
            ghosts={ghosts}
            onRemoveGhost={removeGhost}
            heatTier={heat.tier}
            barPercent={barPercent}
            newRecordAlert={newRecordAlert}
            stats={{
              current60s,
              best60s: scores.best60s,
              streak,
              bestStreak: scores.bestStreak,
              correctQuestions,
              totalQuestions,
            }}
            stageActions={
              isLargeStage && isAllowed
                ? {
                    onOpenLeaderboard: () => setIsLeaderboardOpen(true),
                  }
                : undefined
            }
            isWrong={isWrong}
            wrongAnswer={wrongAnswer}
            correctAnswer={correctAnswer}
            lockoutDurationMs={lockoutDurationMs}
            lockoutId={lockoutId}
            shakeCycle={shakeCycle}
            promptContent={
              <div
                className="letter-math-prompt"
                aria-label={`${problem.baseLetter} ${problem.op === '-' ? 'minus' : 'plus'} ${problem.bottomOperandLabel}`}
              >
                <div className="letter-math-row">
                  <span className="letter-math-op-spacer" aria-hidden="true" />
                  <span className="letter-math-operand">{problem.baseLetter}</span>
                  <span className="letter-math-hint-slot">
                    {showOffsetHint && !isWrong && (
                      <span className="letter-math-offset-hint">
                        ({problem.baseOffset})
                      </span>
                    )}
                  </span>
                </div>
                <div className="letter-math-row">
                  <span
                    className={`letter-math-op ${
                      problem.op === '-'
                        ? 'letter-math-op-minus'
                        : 'letter-math-op-plus'
                    }`}
                    aria-hidden="true"
                  >
                    <svg
                      className="letter-math-op-svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      focusable="false"
                    >
                      <line
                        x1="3.5"
                        y1="12"
                        x2="20.5"
                        y2="12"
                        stroke="currentColor"
                        strokeWidth="4.6"
                        strokeLinecap="round"
                      />
                      {problem.op === '+' && (
                        <line
                          x1="12"
                          y1="3.5"
                          x2="12"
                          y2="20.5"
                          stroke="currentColor"
                          strokeWidth="4.6"
                          strokeLinecap="round"
                        />
                      )}
                    </svg>
                  </span>
                  <span className="letter-math-operand">
                    {problem.bottomOperandLabel}
                  </span>
                  <span className="letter-math-hint-slot">
                    {showOffsetHint &&
                      !isWrong &&
                      problem.bottomOperandOffsetHint !== undefined && (
                        <span className="letter-math-offset-hint">
                          ({problem.bottomOperandOffsetHint})
                        </span>
                      )}
                  </span>
                </div>
                <div className="letter-math-rule" aria-hidden="true" />
              </div>
            }
            inputRef={answerInputRef}
            inputVal={inputVal}
            inputMode="text"
            autoCapitalize="characters"
            maxLength={1}
            onInputChange={(e) => {
              if (isLeaderboardOpen || document.querySelector('[role="dialog"]')) {
                return;
              }
              if (isLockedRef.current) {
                registerBlockedInput();
                return;
              }
              const ch = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(-1);
              setInputVal(ch);
              if (ch) {
                submitAnswerValue(ch);
              }
            }}
            onInputKeyDown={(e) => {
              if (isLeaderboardOpen || document.querySelector('[role="dialog"]')) {
                e.preventDefault();
                return;
              }
              if (e.repeat && (e.key === 'Enter' || e.key === 'Backspace')) {
                e.preventDefault();
                return;
              }
              if (isLockedRef.current && !NON_ANSWER_KEYS.has(e.key)) {
                e.preventDefault();
                registerBlockedInput();
              }
            }}
          />
        </div>
      </div>

      {isAllowed && (
        <LeaderboardModal
          isOpen={isLeaderboardOpen}
          onClose={() => {
            setIsLeaderboardOpen(false);
            focusAnswerInput();
          }}
          initialDrill={drillId}
        />
      )}
    </div>
  );
};

export const LetterMathDrill: React.FC<LetterMathDrillProps> = ({
  initialMode,
  onModeChange,
  onBack,
  workoutContext,
}) => {
  const [mode, setMode] = useState<LetterMathMode>(
    workoutContext?.letterMathMode ?? initialMode ?? 'easy'
  );
  const { elapsedWarmup, skipWarmup } = useWarmupTimer(Boolean(workoutContext));
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [correctQuestions, setCorrectQuestions] = useState(0);

  const handleModeChange = useCallback(
    (newMode: LetterMathMode) => {
      setMode(newMode);
      if (!workoutContext) {
        onModeChange?.(newMode);
      }
    },
    [onModeChange, workoutContext]
  );

  const handleRecordAnswer = useCallback((isCorrect: boolean) => {
    setTotalQuestions((prev) => prev + 1);
    if (isCorrect) {
      setCorrectQuestions((prev) => prev + 1);
    }
  }, []);

  return (
    <LetterMathSession
      key={mode}
      mode={mode}
      onModeChange={handleModeChange}
      elapsedWarmup={elapsedWarmup}
      onSkipWarmup={skipWarmup}
      totalQuestions={totalQuestions}
      correctQuestions={correctQuestions}
      onRecordAnswer={handleRecordAnswer}
      onBack={onBack}
      workoutContext={workoutContext}
    />
  );
};
