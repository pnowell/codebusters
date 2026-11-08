import React, { useState, useEffect, useCallback, useRef } from 'react';
import { atbashChar } from '../../utils/ciphers';
import type { WorkoutStepContext } from '../../types';
import { useSpacedDeck } from '../../hooks/useSpacedDeck';
import { useVelocityTracker } from '../../hooks/useVelocityTracker';
import { useFloatingGhosts } from '../../hooks/useFloatingGhosts';
import { useWarmupTimer } from '../../hooks/useWarmupTimer';
import { useWrongAnswerLockout } from '../../hooks/useWrongAnswerLockout';
import { DrillHeader } from './shared/DrillHeader';
import { WarmupHeaderRight } from './shared/WarmupHeaderRight';
import { CollapsibleReference } from './shared/CollapsibleReference';
import { ReferenceSheet } from './shared/ReferenceSheet';
import { AlphabetMasteryModal } from './shared/AlphabetMasteryModal';
import { FlashcardWorkspace } from './shared/FlashcardWorkspace';
import { CipherGlyph } from './shared/CipherGlyph';
import { LeaderboardModal } from '../leaderboard/LeaderboardModal';
import { useAuth } from '../../context/useAuth';
import { useIsLargeDrillStage } from '../../hooks/useIsLargeDrillStage';

export type SymbolCipherType = 'atbash' | 'pigpen' | 'galactic';

interface SymbolDrillProps {
  cipher: SymbolCipherType;
  onBack: () => void;
  workoutContext?: WorkoutStepContext;
}

const CIPHER_INFO = {
  atbash: {
    title: 'Atbash Cipher',
    shortTitle: 'Atbash',
    sheetLabel: 'Atbash Table',
  },
  pigpen: {
    title: 'Pigpen / Masonic Cipher',
    shortTitle: 'Pigpen',
    sheetLabel: 'Pigpen Reference Table',
  },
  galactic: {
    title: 'Standard Galactic Alphabet',
    shortTitle: 'Galactic',
    sheetLabel: 'Galactic Alphabet Table',
  },
} as const;

const NON_ANSWER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'Tab',
  'Escape',
]);

export const SymbolDrill: React.FC<SymbolDrillProps> = ({ cipher, onBack, workoutContext }) => {
  const { isAllowed } = useAuth();
  const info = CIPHER_INFO[cipher];
  const { elapsedWarmup, skipWarmup } = useWarmupTimer(Boolean(workoutContext));

  const {
    progress,
    masteredCount,
    currentLetter,
    recordAttempt,
    advanceCard,
    resetProgress,
  } = useSpacedDeck(cipher);

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
  } = useVelocityTracker(cipher);

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

  const [isMasteryOpen, setIsMasteryOpen] = useState<boolean>(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState<boolean>(false);
  const [inputVal, setInputVal] = useState<string>('');
  const [totalQuestions, setTotalQuestions] = useState<number>(0);
  const [correctQuestions, setCorrectQuestions] = useState<number>(0);
  const isAnyDialogOpen = isMasteryOpen || isLeaderboardOpen;

  const answerInputRef = useRef<HTMLInputElement | null>(null);

  const focusAnswerInput = useCallback(() => {
    setTimeout(() => {
      if (document.querySelector('[role="dialog"]')) return;
      answerInputRef.current?.focus();
    }, 40);
  }, []);

  useEffect(() => {
    if (document.querySelector('[role="dialog"]')) return;
    answerInputRef.current?.focus();
  }, [currentLetter]);

  const handleResetProgress = () => {
    clearWrongLockout();
    resetProgress();
    setIsMasteryOpen(false);
    setInputVal('');
    focusAnswerInput();
  };

  const confirmAnswerWithChar = useCallback(
    (answeredChar: string) => {
      if (isAnyDialogOpen || document.querySelector('[role="dialog"]')) {
        return;
      }
      if (isLockedRef.current) {
        registerBlockedInput();
        return;
      }

      const cleanAnswer = answeredChar.trim().toUpperCase();
      if (!cleanAnswer || !/^[A-Z]$/.test(cleanAnswer)) return;

      setTotalQuestions((prev) => prev + 1);

      const isCorrect = cleanAnswer === currentLetter;

      if (isCorrect) {
        setCorrectQuestions((prev) => prev + 1);
        recordHit();
        recordAttempt(true, true);
        spawnGhost(
          cipher === 'atbash'
            ? `${atbashChar(currentLetter)} ➔ ${currentLetter} ✓`
            : `${currentLetter} ✓`
        );
        setInputVal('');
        focusAnswerInput();
      } else {
        setInputVal('');
        recordMiss();
        recordAttempt(false, false);

        triggerWrongLockout(cleanAnswer, currentLetter, () => {
          setInputVal('');
          advanceCard();
          focusAnswerInput();
        });
      }
    },
    [
      advanceCard,
      cipher,
      currentLetter,
      focusAnswerInput,
      isAnyDialogOpen,
      isLockedRef,
      recordAttempt,
      recordHit,
      recordMiss,
      registerBlockedInput,
      spawnGhost,
      triggerWrongLockout,
    ]
  );

  const confirmAnswer = useCallback(() => {
    confirmAnswerWithChar(inputVal);
  }, [confirmAnswerWithChar, inputVal]);

  const latestRef = useRef({ confirmAnswerWithChar, registerBlockedInput });
  useEffect(() => {
    latestRef.current = { confirmAnswerWithChar, registerBlockedInput };
  }, [confirmAnswerWithChar, registerBlockedInput]);

  // Global typing listener: single keypress immediately answers when unlocked
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
        confirmAnswerWithChar: handleChar,
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
        const upper = e.key.toUpperCase();
        setInputVal(upper);
        handleChar(upper);
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
    });
  }, [flushSession, sessionBest60s, workoutContext]);

  const isLargeStage = useIsLargeDrillStage();

  const headerRight = (
    <WarmupHeaderRight
      workoutContext={workoutContext}
      elapsedWarmup={elapsedWarmup}
      onSkipWarmup={skipWarmup}
      onAdvanceWarmup={handleAdvanceWarmup}
      menuProps={{
        masteryAction: !isLargeStage
          ? { masteredCount, onOpen: () => setIsMasteryOpen(true) }
          : undefined,
        onOpenLeaderboard:
          !isLargeStage && isAllowed ? () => setIsLeaderboardOpen(true) : undefined,
        onCloseFocusRestore: focusAnswerInput,
      }}
    />
  );

  const headerTitle = workoutContext ? `Warm-up: ${info.shortTitle}` : info.title;

  const promptContent = (
    <div className="symbol-glyph-box">
      {cipher === 'atbash' ? (
        <span
          className="atbash-cipher-char"
          aria-label={`Atbash ciphertext ${atbashChar(currentLetter)}`}
        >
          {atbashChar(currentLetter)}
        </span>
      ) : (
        <CipherGlyph
          cipher={cipher}
          char={currentLetter}
          size={68}
          color="var(--accent-blue)"
        />
      )}
    </div>
  );

  return (
    <div className="drill-container symbol-drill-container">
      <DrillHeader title={headerTitle} onBack={onBack} right={headerRight} />

      <div className="drill-stage-viewport">
        <div className="drill-stage-group">
          <CollapsibleReference
            className="sticky-ref-container reference-sheet symbol-drill-ref-box"
            showLabel={`Show ${info.sheetLabel}`}
          >
            <ReferenceSheet cipher={cipher} />
          </CollapsibleReference>

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
                    onOpenMastery: () => setIsMasteryOpen(true),
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
            promptContent={promptContent}
            inputRef={answerInputRef}
            inputVal={inputVal}
            inputMode="text"
            autoCapitalize="characters"
            maxLength={1}
            onInputChange={(e) => {
              if (isAnyDialogOpen || document.querySelector('[role="dialog"]')) {
                return;
              }
              if (isLockedRef.current) {
                registerBlockedInput();
                return;
              }
              const char = e.target.value.replace(/[^A-Za-z]/g, '').slice(-1).toUpperCase();
              setInputVal(char);
              if (char) {
                confirmAnswerWithChar(char);
              }
            }}
            onInputKeyDown={(e) => {
              if (isAnyDialogOpen || document.querySelector('[role="dialog"]')) {
                e.preventDefault();
                return;
              }
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
          />
        </div>
      </div>

      <AlphabetMasteryModal
        isOpen={isMasteryOpen}
        onClose={() => {
          setIsMasteryOpen(false);
          focusAnswerInput();
        }}
        progress={progress}
        onResetProgress={handleResetProgress}
        title={`${info.shortTitle} Alphabet Mastery`}
      />

      {isAllowed && (
        <LeaderboardModal
          isOpen={isLeaderboardOpen}
          onClose={() => {
            setIsLeaderboardOpen(false);
            focusAnswerInput();
          }}
          initialDrill={cipher}
        />
      )}
    </div>
  );
};
