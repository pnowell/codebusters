import React, { useState, useEffect, useCallback, useRef } from 'react';
import { offsetsModeToDrillId } from '../../services/storage';
import type { OffsetsMode, WorkoutStepContext } from '../../types';
import { useSpacedDeck } from '../../hooks/useSpacedDeck';
import { useVelocityTracker } from '../../hooks/useVelocityTracker';
import { useFloatingGhosts } from '../../hooks/useFloatingGhosts';
import { useWarmupTimer } from '../../hooks/useWarmupTimer';
import { DrillHeader } from './shared/DrillHeader';
import { WarmupHeaderRight } from './shared/WarmupHeaderRight';
import { AlphabetMasteryModal } from './shared/AlphabetMasteryModal';
import { FlashcardWorkspace } from './shared/FlashcardWorkspace';
import { LeaderboardModal } from '../leaderboard/LeaderboardModal';
import { useAuth } from '../../context/useAuth';

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

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState<boolean>(false);
  const [inputVal, setInputVal] = useState<string>('');
  const [wrongFeedback, setWrongFeedback] = useState<string | null>(null);

  const answerInputRef = useRef<HTMLInputElement | null>(null);
  const wrongTimerRef = useRef<number | null>(null);

  const focusAnswerInput = useCallback(() => {
    setTimeout(() => {
      answerInputRef.current?.focus();
    }, 40);
  }, []);

  useEffect(() => {
    focusAnswerInput();
    return () => {
      if (wrongTimerRef.current !== null) {
        window.clearTimeout(wrongTimerRef.current);
      }
    };
  }, [focusAnswerInput]);

  const handleResetProgress = () => {
    resetProgress();
    setIsModalOpen(false);
    setInputVal('');
    setWrongFeedback(null);
    focusAnswerInput();
  };

  const skipWrongFeedback = useCallback((): boolean => {
    if (wrongTimerRef.current === null) return false;
    window.clearTimeout(wrongTimerRef.current);
    wrongTimerRef.current = null;
    setWrongFeedback(null);
    setInputVal('');
    advanceCard();
    focusAnswerInput();
    return true;
  }, [advanceCard, focusAnswerInput]);

  const submitAnswerValue = useCallback(
    (rawVal: string) => {
      if (wrongTimerRef.current !== null) return;

      const trimmed = rawVal.trim().toUpperCase();
      if (!trimmed) return;
      if (promptType === 'number' && !/^[A-Z]$/.test(trimmed)) return;

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
        setWrongFeedback(null);
        focusAnswerInput();
      } else {
        setWrongFeedback(promptType === 'letter' ? `${currentOffset}` : currentLetter);
        recordMiss();
        recordAttempt(false, false);

        wrongTimerRef.current = window.setTimeout(() => {
          wrongTimerRef.current = null;
          setWrongFeedback(null);
          setInputVal('');
          advanceCard();
          focusAnswerInput();
        }, 1200);
      }
    },
    [
      advanceCard,
      currentLetter,
      currentOffset,
      focusAnswerInput,
      onRecordAnswer,
      promptType,
      recordAttempt,
      recordHit,
      recordMiss,
      spawnGhost,
    ]
  );

  const confirmAnswer = useCallback(() => {
    submitAnswerValue(inputVal);
  }, [inputVal, submitAnswerValue]);

  const latestRef = useRef({
    confirmAnswer,
    submitAnswerValue,
    skipWrongFeedback,
    promptType,
    wrongFeedback,
  });
  useEffect(() => {
    latestRef.current = {
      confirmAnswer,
      submitAnswerValue,
      skipWrongFeedback,
      promptType,
      wrongFeedback,
    };
  }, [confirmAnswer, promptType, skipWrongFeedback, submitAnswerValue, wrongFeedback]);

  // Global typing listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.target instanceof HTMLInputElement && e.target !== answerInputRef.current) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;

      const {
        confirmAnswer: handleConfirm,
        submitAnswerValue: handleSubmitVal,
        skipWrongFeedback: handleSkipWrong,
        promptType: currentPromptType,
        wrongFeedback: isWrong,
      } = latestRef.current;

      if (currentPromptType === 'number') {
        if (isWrong !== null) {
          if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) {
            return;
          }
          e.preventDefault();
          handleSkipWrong();
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
        return;
      }

      // Letter -> # mode: let focused native input handle digit entry & Enter
      if (document.activeElement === answerInputRef.current) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        if (!handleSkipWrong()) {
          handleConfirm();
        }
      } else if (isWrong === null && e.key === 'Backspace') {
        e.preventDefault();
        setInputVal((prev) => prev.slice(0, -1));
        answerInputRef.current?.focus();
      } else if (isWrong === null && e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        setInputVal((prev) => (prev.length < 2 ? prev + e.key : e.key));
        answerInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleAdvanceWarmup = useCallback(() => {
    flushSession(true);
    workoutContext?.onAdvance({
      warmup60s: sessionBest60s,
      offsetsMode: mode,
    });
  }, [flushSession, mode, sessionBest60s, workoutContext]);

  const modeLabel = mode === 'letterToNum' ? 'Letter → #' : '# → Letter';
  const headerTitle = workoutContext ? `Warm-up: ${modeLabel}` : `Offsets: ${modeLabel}`;

  const headerRight = (
    <WarmupHeaderRight
      workoutContext={workoutContext}
      elapsedWarmup={elapsedWarmup}
      onSkipWarmup={onSkipWarmup}
      onAdvanceWarmup={handleAdvanceWarmup}
      menuProps={{
        streak,
        bestStreak: scores.bestStreak,
        current60s,
        best60s: scores.best60s,
        totalQuestions,
        correctQuestions,
        masteredCount,
        onOpenMastery: () => setIsModalOpen(true),
        onOpenLeaderboard: isAllowed ? () => setIsLeaderboardOpen(true) : undefined,
        modeOptions: MODES,
        activeMode: mode,
        onSelectMode: (newMode) => onModeChange(newMode as OffsetsMode),
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
            best60s={scores.best60s}
            isWrong={wrongFeedback !== null}
            wrongHintContent={
              wrongFeedback ? (
                <>
                  Answer: <strong>{wrongFeedback}</strong>
                </>
              ) : undefined
            }
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
              const val = e.target.value.toUpperCase();
              if (promptType === 'letter') {
                if (wrongTimerRef.current !== null) return;
                setInputVal(val.replace(/[^0-9]/g, '').slice(0, 2));
              } else {
                const ch = val.replace(/[^A-Z]/g, '').slice(-1);
                if (wrongTimerRef.current !== null) {
                  skipWrongFeedback();
                  return;
                }
                setInputVal(ch);
                if (ch) {
                  submitAnswerValue(ch);
                }
              }
            }}
            onInputKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!skipWrongFeedback()) {
                  confirmAnswer();
                }
              }
            }}
            inlineSubmit={
              promptType === 'letter'
                ? {
                    onSubmit: () => {
                      if (!skipWrongFeedback()) {
                        confirmAnswer();
                      }
                    },
                    disabled: !inputVal && wrongFeedback === null,
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
