import React, { useState, useEffect, useCallback, useRef } from 'react';
import { atbashChar } from '../../utils/ciphers';
import type { WorkoutStepContext } from '../../types';
import { useSpacedDeck } from '../../hooks/useSpacedDeck';
import { useVelocityTracker } from '../../hooks/useVelocityTracker';
import { useFloatingGhosts } from '../../hooks/useFloatingGhosts';
import { useWarmupTimer } from '../../hooks/useWarmupTimer';
import { DrillHeader } from './shared/DrillHeader';
import { DrillActionRow } from './shared/DrillActionRow';
import { WarmupHeaderRight } from './shared/WarmupHeaderRight';
import { CollapsibleReference } from './shared/CollapsibleReference';
import { ReferenceSheet } from './shared/ReferenceSheet';
import { AlphabetMasteryModal } from './shared/AlphabetMasteryModal';
import { SpeedometerBar } from './shared/SpeedometerBar';
import { FloatingGhosts } from './shared/FloatingGhosts';
import { CipherGlyph } from './shared/CipherGlyph';
import { LeaderboardModal } from '../leaderboard/LeaderboardModal';
import { useAuth } from '../../context/useAuth';

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
    prompt: 'What is the plaintext letter for Atbash:',
    sheetLabel: 'Atbash Table',
  },
  pigpen: {
    title: 'Pigpen / Masonic Cipher',
    shortTitle: 'Pigpen',
    prompt: 'What is the plaintext letter for Pigpen:',
    sheetLabel: 'Pigpen Reference Table',
  },
  galactic: {
    title: 'Standard Galactic Alphabet',
    shortTitle: 'Galactic',
    prompt: 'What is the plaintext letter for Galactic:',
    sheetLabel: 'Galactic Alphabet Table',
  },
} as const;

export const SymbolDrill: React.FC<SymbolDrillProps> = ({ cipher, onBack, workoutContext }) => {
  const { isAllowed } = useAuth();
  const info = CIPHER_INFO[cipher];
  const { elapsedWarmup, skipWarmup } = useWarmupTimer(Boolean(workoutContext));

  const {
    progress,
    masteredCount,
    currentLetter,
    currentOffset,
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

  const [isMasteryOpen, setIsMasteryOpen] = useState<boolean>(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState<boolean>(false);
  const [inputVal, setInputVal] = useState<string>('');
  const [wrongFeedback, setWrongFeedback] = useState<string | null>(null);
  const [totalQuestions, setTotalQuestions] = useState<number>(0);
  const [correctQuestions, setCorrectQuestions] = useState<number>(0);

  const answerInputRef = useRef<HTMLInputElement | null>(null);
  const wrongTimerRef = useRef<number | null>(null);

  const focusAnswerInput = useCallback(() => {
    setTimeout(() => {
      answerInputRef.current?.focus();
    }, 40);
  }, []);

  useEffect(() => {
    return () => {
      if (wrongTimerRef.current !== null) {
        window.clearTimeout(wrongTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    answerInputRef.current?.focus();
  }, [currentLetter]);

  const handleResetProgress = () => {
    resetProgress();
    setIsMasteryOpen(false);
    setInputVal('');
    setWrongFeedback(null);
    focusAnswerInput();
  };

  const confirmAnswerWithChar = useCallback(
    (answeredChar: string) => {
      const cleanAnswer = answeredChar.trim().toUpperCase();
      if (!cleanAnswer || !/^[A-Z]$/.test(cleanAnswer)) return;

      // If currently displaying wrong feedback, typing any key immediately skips to the next card
      if (wrongTimerRef.current !== null) {
        window.clearTimeout(wrongTimerRef.current);
        wrongTimerRef.current = null;
        setWrongFeedback(null);
        setInputVal('');
        advanceCard();
        focusAnswerInput();
        return;
      }

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
        setWrongFeedback(null);
        focusAnswerInput();
      } else {
        setWrongFeedback(currentLetter);
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
      cipher,
      currentLetter,
      focusAnswerInput,
      recordAttempt,
      recordHit,
      recordMiss,
      spawnGhost,
    ]
  );

  const confirmAnswer = useCallback(() => {
    confirmAnswerWithChar(inputVal);
  }, [confirmAnswerWithChar, inputVal]);

  const latestRef = useRef({ confirmAnswerWithChar, wrongFeedback });
  useEffect(() => {
    latestRef.current = { confirmAnswerWithChar, wrongFeedback };
  }, [confirmAnswerWithChar, wrongFeedback]);

  // Global typing listener: single keypress immediately answers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.target instanceof HTMLInputElement && e.target !== answerInputRef.current) return;
      if (e.target instanceof HTMLTextAreaElement) return;

      const { confirmAnswerWithChar: handleChar, wrongFeedback: isWrong } = latestRef.current;

      if (isWrong !== null) {
        e.preventDefault();
        handleChar('A');
        return;
      }

      if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        setInputVal(e.key.toUpperCase());
        handleChar(e.key.toUpperCase());
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setInputVal('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleAdvanceWarmup = useCallback(() => {
    flushSession(true);
    workoutContext?.onAdvance({
      warmup60s: sessionBest60s,
    });
  }, [flushSession, sessionBest60s, workoutContext]);

  const headerRight = (
    <WarmupHeaderRight
      streak={streak}
      bestStreak={scores.bestStreak}
      workoutContext={workoutContext}
      elapsedWarmup={elapsedWarmup}
      onSkipWarmup={skipWarmup}
      onAdvanceWarmup={handleAdvanceWarmup}
    />
  );

  const headerTitle = workoutContext ? `Warm-up: ${info.shortTitle}` : info.title;

  return (
    <div className="drill-container symbol-drill-container">
      <DrillHeader title={headerTitle} onBack={onBack} right={headerRight} />

      <div className="offsets-subbar" style={{ justifyContent: 'flex-end' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {isAllowed && (
            <button
              type="button"
              className="leaderboard-chip-btn"
              onClick={() => setIsLeaderboardOpen(true)}
              title={`View Team Leaderboards for ${info.shortTitle}`}
            >
              🏆 Leaderboard
            </button>
          )}
          <button
            type="button"
            className="mastery-chip-btn"
            onClick={() => setIsMasteryOpen(true)}
            title={`Click to view detailed Alphabet Mastery for ${info.shortTitle}`}
          >
            📊 {masteredCount}/26 Mastered
          </button>
        </div>
      </div>

      <CollapsibleReference
        className="sticky-ref-container reference-sheet symbol-drill-ref-box"
        showLabel={`Show ${info.sheetLabel}`}
      >
        <ReferenceSheet cipher={cipher} />
      </CollapsibleReference>

      <SpeedometerBar
        heat={heat}
        current60s={current60s}
        best60s={scores.best60s}
        barPercent={barPercent}
        newRecordAlert={newRecordAlert}
      />

      <div className="offset-card-wrapper">
        <FloatingGhosts ghosts={ghosts} onRemove={removeGhost} />

        <div
          className={`offset-card ${wrongFeedback ? 'feedback-wrong' : ''} ${
            heat.tier === 'onfire'
              ? 'card-onfire'
              : heat.tier === 'overdrive'
                ? 'card-overdrive'
                : ''
          }`}
        >
          <div className="prompt-label">{info.prompt}</div>

          <div className="prompt-value symbol-prompt-value">
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
                  size={76}
                  color="var(--accent-blue)"
                />
              )}
            </div>
          </div>

          <div
            className="user-answer-box-wrapper"
            onClick={() => answerInputRef.current?.focus()}
          >
            <input
              ref={answerInputRef}
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck="false"
              enterKeyHint="done"
              className="user-answer-native-input"
              value={inputVal}
              placeholder="?"
              maxLength={1}
              onChange={(e) => {
                const char = e.target.value.replace(/[^A-Za-z]/g, '').slice(-1).toUpperCase();
                setInputVal(char);
                if (char) {
                  confirmAnswerWithChar(char);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirmAnswer();
                }
              }}
            />
          </div>

          {wrongFeedback && (
            <div className="answer-hint">
              Answer was: <strong>{wrongFeedback}</strong>
              {cipher === 'atbash' && (
                <small style={{ display: 'block', marginTop: '4px', opacity: 0.8 }}>
                  ({atbashChar(wrongFeedback)} ↔ {wrongFeedback})
                </small>
              )}
            </div>
          )}
        </div>
      </div>

      <DrillActionRow
        info={
          <>
            Accuracy:{' '}
            <strong>
              {totalQuestions > 0 ? Math.round((correctQuestions / totalQuestions) * 100) : 100}%
            </strong>{' '}
            ({correctQuestions}/{totalQuestions})
          </>
        }
      >
        <button
          type="button"
          className="btn-submit"
          onClick={confirmAnswer}
          disabled={!inputVal || wrongFeedback !== null}
        >
          Submit Answer ⏎
        </button>
      </DrillActionRow>

      <AlphabetMasteryModal
        isOpen={isMasteryOpen}
        onClose={() => setIsMasteryOpen(false)}
        progress={progress}
        onResetProgress={handleResetProgress}
        currentLetter={currentLetter}
        currentOffset={currentOffset}
        title={`${info.shortTitle} Alphabet Mastery`}
      />

      {isAllowed && (
        <LeaderboardModal
          isOpen={isLeaderboardOpen}
          onClose={() => setIsLeaderboardOpen(false)}
          initialDrill={cipher}
        />
      )}
    </div>
  );
};
