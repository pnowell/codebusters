import React, { useState, useEffect, useCallback, useRef } from 'react';
import { offsetsModeToDrillId } from '../../services/storage';
import type { OffsetsMode, WorkoutStepContext } from '../../types';
import { useSpacedDeck } from '../../hooks/useSpacedDeck';
import { useVelocityTracker } from '../../hooks/useVelocityTracker';
import { useFloatingGhosts } from '../../hooks/useFloatingGhosts';
import { useWarmupTimer } from '../../hooks/useWarmupTimer';
import { useWrongAnswerLockout } from '../../hooks/useWrongAnswerLockout';
import { DrillHeader } from './shared/DrillHeader';
import { WarmupHeaderRight } from './shared/WarmupHeaderRight';
import { AlphabetMasteryModal } from './shared/AlphabetMasteryModal';
import { FlashcardWorkspace } from './shared/FlashcardWorkspace';
import { LeaderboardModal } from '../leaderboard/LeaderboardModal';
import { useAuth } from '../../context/useAuth';
import { useIsLargeDrillStage } from '../../hooks/useIsLargeDrillStage';

interface LetterOffsetDrillProps {
  initialMode?: OffsetsMode;
  onModeChange?: (mode: OffsetsMode) => void;
  onBack: () => void;
  workoutContext?: WorkoutStepContext;
}

const MODES: readonly { readonly id: OffsetsMode; readonly label: string }[] = [
  { id: 'letterToNum', label: 'Letter → #' },
  { id: 'numToLetter', label: '# → Letter' },
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

interface OffsetsSessionProps {
  mode: OffsetsMode;
  onModeChange: (newMode: OffsetsMode) => void;
  elapsedWarmup: number;
  onSkipWarmup: () => void;
  totalQuestions: number;
  correctQuestions: number;
  onRecordAnswer: (isCorrect: boolean) => void;
  onBack: () => void;
  workoutContext?: WorkoutStepContext;
}

const OffsetsSession: React.FC<OffsetsSessionProps> = ({
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
  const drillId = offsetsModeToDrillId(mode);
  const promptType = mode === 'letterToNum' ? 'letter' : 'number';

  const {
    progress,
    masteredCount,
    currentLetter,
    currentOffset,
    recordAttempt,
    advanceCard,
    resetProgress,
  } = useSpacedDeck(drillId);

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
    clearWrongLockout,
  } = useWrongAnswerLockout();

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState<boolean>(false);
  const [inputVal, setInputVal] = useState<string>('');

  const answerInputRef = useRef<HTMLInputElement | null>(null);

  const focusAnswerInput = useCallback(() => {
    setTimeout(() => {
      answerInputRef.current?.focus();
    }, 40);
  }, []);

  useEffect(() => {
    focusAnswerInput();
  }, [focusAnswerInput]);

  const handleResetProgress = () => {
    clearWrongLockout();
    resetProgress();
    setIsModalOpen(false);
    setInputVal('');
    focusAnswerInput();
  };

  const submitAnswerValue = useCallback(
    (rawVal: string) => {
      if (isLockedRef.current) {
        registerBlockedInput();
        return;
      }

      const trimmed = rawVal.trim().toUpperCase();
      if (!trimmed) return;
      if (promptType === 'number' && !/^[A-Z]$/.test(trimmed)) return;
      if (promptType === 'letter' && !/^[0-9]{1,2}$/.test(trimmed)) return;

      const isCorrect =
        promptType === 'letter'
          ? parseInt(trimmed, 10) === currentOffset
          : trimmed === currentLetter;

      onRecordAnswer(isCorrect);

      if (isCorrect) {
        recordHit();
        recordAttempt(true, true);
        spawnGhost(`${currentLetter} = ${currentOffset} ✓`);
        setInputVal('');
        focusAnswerInput();
      } else {
        setInputVal('');
        recordMiss();
        recordAttempt(false, false);

        triggerWrongLockout(
          trimmed,
          promptType === 'letter' ? `${currentOffset}` : currentLetter,
          () => {
            setInputVal('');
            advanceCard();
            focusAnswerInput();
          }
        );
      }
    },
    [
      advanceCard,
      currentLetter,
      currentOffset,
      focusAnswerInput,
      isLockedRef,
      onRecordAnswer,
      promptType,
      recordAttempt,
      recordHit,
      recordMiss,
      registerBlockedInput,
      spawnGhost,
      triggerWrongLockout,
    ]
  );

  const confirmAnswer = useCallback(() => {
    submitAnswerValue(inputVal);
  }, [inputVal, submitAnswerValue]);

  const latestRef = useRef({
    confirmAnswer,
    submitAnswerValue,
    registerBlockedInput,
    promptType,
  });
  useEffect(() => {
    latestRef.current = {
      confirmAnswer,
      submitAnswerValue,
      registerBlockedInput,
      promptType,
    };
  }, [confirmAnswer, promptType, registerBlockedInput, submitAnswerValue]);

  // Global typing listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.target instanceof HTMLInputElement && e.target !== answerInputRef.current) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;

      if (e.repeat && (/^[a-zA-Z0-9]$/.test(e.key) || e.key === 'Enter' || e.key === 'Backspace')) {
        e.preventDefault();
        return;
      }

      const {
        confirmAnswer: handleConfirm,
        submitAnswerValue: handleSubmitVal,
        registerBlockedInput: handleBlocked,
        promptType: currentPromptType,
      } = latestRef.current;

      if (isLockedRef.current) {
        if (NON_ANSWER_KEYS.has(e.key)) {
          return;
        }
        e.preventDefault();
        handleBlocked();
        return;
      }

      if (currentPromptType === 'number') {
        if (/^[a-zA-Z]$/.test(e.key)) {
          e.preventDefault();
          const ch = e.key.toUpperCase();
          setInputVal(ch);
          handleSubmitVal(ch);
        } else if (e.key === 'Backspace') {
          e.preventDefault();
          setInputVal('');
        }
        return;
      }

      // Letter -> # mode: let focused native input handle digit entry & Enter when unlocked
      if (document.activeElement === answerInputRef.current) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setInputVal((prev) => prev.slice(0, -1));
        answerInputRef.current?.focus();
      } else if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        setInputVal((prev) => (prev.length < 2 ? prev + e.key : e.key));
        answerInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLockedRef]);

  const handleAdvanceWarmup = useCallback(() => {
    flushSession(true);
    workoutContext?.onAdvance({
      warmup60s: sessionBest60s,
      offsetsMode: mode,
    });
  }, [flushSession, mode, sessionBest60s, workoutContext]);

  const isLargeStage = useIsLargeDrillStage();
  const modeLabel = mode === 'letterToNum' ? 'Letter → #' : '# → Letter';
  const headerTitle = workoutContext ? `Warm-up: ${modeLabel}` : `Offsets: ${modeLabel}`;

  const headerRight = (
    <WarmupHeaderRight
      workoutContext={workoutContext}
      elapsedWarmup={elapsedWarmup}
      onSkipWarmup={onSkipWarmup}
      onAdvanceWarmup={handleAdvanceWarmup}
      menuProps={{
        modeOptions: MODES,
        activeMode: mode,
        onSelectMode: (newMode) => onModeChange(newMode as OffsetsMode),
        masteryAction: !isLargeStage
          ? { masteredCount, onOpen: () => setIsModalOpen(true) }
          : undefined,
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
              isLargeStage
                ? {
                    masteredCount,
                    onOpenMastery: () => setIsModalOpen(true),
                    onOpenLeaderboard: isAllowed
                      ? () => setIsLeaderboardOpen(true)
                      : undefined,
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
              <span className="prompt-value">
                {promptType === 'letter' ? currentLetter : currentOffset}
              </span>
            }
            inputRef={answerInputRef}
            inputVal={inputVal}
            inputMode={promptType === 'letter' ? 'numeric' : 'text'}
            pattern={promptType === 'letter' ? '[0-9]*' : undefined}
            autoCapitalize={promptType === 'number' ? 'characters' : 'off'}
            maxLength={promptType === 'number' ? 1 : 2}
            onInputChange={(e) => {
              if (isLockedRef.current) {
                registerBlockedInput();
                return;
              }
              const val = e.target.value.toUpperCase();
              if (promptType === 'letter') {
                setInputVal(val.replace(/[^0-9]/g, '').slice(0, 2));
              } else {
                const ch = val.replace(/[^A-Z]/g, '').slice(-1);
                setInputVal(ch);
                if (ch) {
                  submitAnswerValue(ch);
                }
              }
            }}
            onInputKeyDown={(e) => {
              if (e.repeat && (e.key === 'Enter' || e.key === 'Backspace')) {
                e.preventDefault();
                return;
              }
              if (isLockedRef.current) {
                if (!NON_ANSWER_KEYS.has(e.key)) {
                  e.preventDefault();
                  registerBlockedInput();
                }
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                confirmAnswer();
              }
            }}
            inlineSubmit={
              promptType === 'letter'
                ? {
                    onSubmit: () => {
                      if (isLockedRef.current) {
                        registerBlockedInput();
                        return;
                      }
                      confirmAnswer();
                    },
                    disabled: isWrong || !inputVal,
                  }
                : undefined
            }
          />
        </div>
      </div>

      <AlphabetMasteryModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          focusAnswerInput();
        }}
        progress={progress}
        onResetProgress={handleResetProgress}
        currentOffset={currentOffset}
        mode={mode}
      />

      {isAllowed && (
        <LeaderboardModal
          isOpen={isLeaderboardOpen}
          onClose={() => {
            setIsLeaderboardOpen(false);
            focusAnswerInput();
          }}
          initialMode={mode}
        />
      )}
    </div>
  );
};

export const LetterOffsetDrill: React.FC<LetterOffsetDrillProps> = ({
  initialMode,
  onModeChange,
  onBack,
  workoutContext,
}) => {
  const [mode, setMode] = useState<OffsetsMode>(
    workoutContext?.offsetsMode ?? initialMode ?? 'letterToNum'
  );
  const { elapsedWarmup, skipWarmup } = useWarmupTimer(Boolean(workoutContext));
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [correctQuestions, setCorrectQuestions] = useState(0);

  const handleModeChange = useCallback(
    (newMode: OffsetsMode) => {
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
    <OffsetsSession
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
