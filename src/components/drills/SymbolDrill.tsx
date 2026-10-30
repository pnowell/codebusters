import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PigpenGlyph } from '../symbols/PigpenGlyph';
import { GalacticGlyph } from '../symbols/GalacticGlyph';
import { atbashChar, letterToOffset } from '../../utils/ciphers';
import {
  loadDrillScore,
  saveDrillScore,
  loadDrillProgress,
  saveDrillProgress,
  resetDrillProgress,
} from '../../services/storage';
import { DrillHeader } from '../drill/DrillHeader';
import { DrillActionRow } from '../drill/DrillActionRow';
import { CollapsibleReference } from '../drill/CollapsibleReference';
import { ReferenceSheet } from '../drill/ReferenceSheet';
import { AlphabetMasteryModal } from '../drill/AlphabetMasteryModal';
import { LeaderboardModal } from '../leaderboard/LeaderboardModal';
import { useAuth } from '../../context/useAuth';
import type { DrillProgress, DrillScore } from '../../types';
import type { WorkoutStepContext } from './LetterOffsetDrill';

export type SymbolCipherType = 'atbash' | 'pigpen' | 'galactic';

interface SymbolDrillProps {
  cipher: SymbolCipherType;
  onBack: () => void;
  workoutContext?: WorkoutStepContext;
}

interface FloatingGhost {
  id: string;
  text: string;
}

const ALL_LETTERS: readonly string[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function shuffle<T>(arr: readonly T[] | T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getMasteredInsertIndex(deckLength: number): number {
  const rand = Math.random();
  let offsetFromBack = 0;
  if (rand < 0.50) {
    offsetFromBack = 0;
  } else if (rand < 0.75) {
    offsetFromBack = 1;
  } else if (rand < 0.90) {
    offsetFromBack = 2;
  } else {
    offsetFromBack = 3;
  }
  return Math.max(0, deckLength - offsetFromBack);
}

function initDeck(progress: DrillProgress): string[] {
  const learningOrMissed: string[] = [];
  const unseen: string[] = [];
  const mastered: string[] = [];

  for (const letter of ALL_LETTERS) {
    const p = progress ? progress[letter] : undefined;
    if (!p || typeof p !== 'object' || p.attempts === 0) {
      unseen.push(letter);
    } else if ((p.streak || 0) >= 3) {
      mastered.push(letter);
    } else {
      learningOrMissed.push(letter);
    }
  }

  // Fresh start or reset (all 26 unseen): fully shuffle all 26 letters
  if (unseen.length === 26) {
    return shuffle(ALL_LETTERS);
  }

  // Resumed progress: learning items come first, then unseen, then mastered
  return [
    ...shuffle(learningOrMissed),
    ...shuffle(unseen),
    ...shuffle(mastered),
  ];
}

function getHeatTier(cpm: number): {
  tier: 'idle' | 'cruise' | 'fast' | 'overdrive' | 'onfire';
  label: string;
  icon: string;
} {
  if (cpm >= 36) return { tier: 'onfire', label: 'ON FIRE!', icon: '🔥🔥🔥' };
  if (cpm >= 26) return { tier: 'overdrive', label: 'OVERDRIVE', icon: '🔥' };
  if (cpm >= 16) return { tier: 'fast', label: 'FAST', icon: '⚡⚡' };
  if (cpm > 0) return { tier: 'cruise', label: 'CRUISE', icon: '⚡' };
  return { tier: 'idle', label: 'IDLE', icon: '⏱️' };
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

export const SymbolDrill: React.FC<SymbolDrillProps> = ({
  cipher,
  onBack,
  workoutContext,
}) => {
  const { isAllowed } = useAuth();
  const info = CIPHER_INFO[cipher];

  const [scores, setScores] = useState<DrillScore>(() => loadDrillScore(cipher));
  const [progress, setProgress] = useState<DrillProgress>(() => loadDrillProgress(cipher));
  const [isMasteryOpen, setIsMasteryOpen] = useState<boolean>(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState<boolean>(false);
  const [newRecordAlert, setNewRecordAlert] = useState<boolean>(false);

  // Velocity Metrics
  const [current60s, setCurrent60s] = useState<number>(0);
  const [cadence, setCadence] = useState<number>(0);
  const [streak, setStreak] = useState<number>(0);
  const correctTimestampsRef = useRef<number[]>([]);
  const lastCorrectTimeRef = useRef<number | null>(null);

  // Warm-up timer when in Workout session
  const [elapsedWarmup, setElapsedWarmup] = useState(0);
  useEffect(() => {
    if (!workoutContext) return;
    const interval = window.setInterval(() => {
      setElapsedWarmup(s => s + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [workoutContext]);

  // Spaced Repetition deck initialization
  const [initialData] = useState(() => {
    const initialDeck = initDeck(loadDrillProgress(cipher));
    const initialLetter = initialDeck[0] ?? 'A';
    return { initialDeck, initialLetter };
  });

  const deckQueueRef = useRef<string[]>(initialData.initialDeck);
  const [currentLetter, setCurrentLetter] = useState<string>(initialData.initialLetter);
  const [inputVal, setInputVal] = useState<string>('');
  const [wrongFeedback, setWrongFeedback] = useState<string | null>(null);
  const [totalQuestions, setTotalQuestions] = useState<number>(0);
  const [correctQuestions, setCorrectQuestions] = useState<number>(0);
  const [ghosts, setGhosts] = useState<FloatingGhost[]>([]);

  const answerInputRef = useRef<HTMLInputElement | null>(null);
  const ghostSeq = useRef(0);
  const wrongTimerRef = useRef<number | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (wrongTimerRef.current !== null) {
        window.clearTimeout(wrongTimerRef.current);
      }
    };
  }, []);

  // Focus input automatically
  useEffect(() => {
    answerInputRef.current?.focus();
  }, [currentLetter]);

  // Live 150ms interval: Prune 60s timestamps and smoothly decay cadence
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();

      // Prune timestamps older than 60s
      const filtered = correctTimestampsRef.current.filter(t => now - t <= 60000);
      correctTimestampsRef.current = filtered;
      setCurrent60s(filtered.length);

      // Hold cadence steady for 3.5s, then decay smoothly (~3 CPM per second)
      if (lastCorrectTimeRef.current !== null) {
        const timeSinceLast = (now - lastCorrectTimeRef.current) / 1000;
        if (timeSinceLast > 3.5) {
          setCadence(prev => {
            if (prev <= 0.5) return 0;
            const decayed = prev * 0.97 - 0.25;
            return Math.max(0, Math.round(decayed * 10) / 10);
          });
        }
      }
    }, 150);

    return () => window.clearInterval(interval);
  }, []);

  const nextCard = useCallback(() => {
    const currentDeck = deckQueueRef.current || [];
    const nextL = currentDeck.length > 0 ? currentDeck[0] : ALL_LETTERS[Math.floor(Math.random() * 26)];
    setCurrentLetter(nextL);
    setInputVal('');
    setWrongFeedback(null);
    setTimeout(() => {
      answerInputRef.current?.focus();
    }, 40);
  }, []);

  const handleResetProgress = () => {
    resetDrillProgress(cipher);
    const freshProgress: DrillProgress = {};
    setProgress(freshProgress);
    const freshDeck = initDeck(freshProgress);
    deckQueueRef.current = freshDeck;
    setIsMasteryOpen(false);
    nextCard();
  };

  const confirmAnswerWithChar = useCallback((answeredChar: string) => {
    const cleanAnswer = answeredChar.trim().toUpperCase();
    if (!cleanAnswer || !/^[A-Z]$/.test(cleanAnswer)) return;

    // If currently displaying wrong feedback, typing any key immediately skips to the next card
    if (wrongTimerRef.current !== null) {
      window.clearTimeout(wrongTimerRef.current);
      wrongTimerRef.current = null;
      setWrongFeedback(null);
      nextCard();
      return;
    }

    setTotalQuestions(prev => prev + 1);

    const isCorrect = cleanAnswer === currentLetter;
    const deck = deckQueueRef.current;
    const targetLetter = currentLetter;
    const now = Date.now();

    // Pop the answered letter from the front of the active deck
    if (deck && deck[0] === targetLetter) {
      deck.shift();
    } else if (deck) {
      const idx = deck.indexOf(targetLetter);
      if (idx !== -1) deck.splice(idx, 1);
    }

    if (isCorrect) {
      setCorrectQuestions(prev => prev + 1);
      const newStreak = streak + 1;
      setStreak(newStreak);

      // Record timestamp for 60s Blitz
      correctTimestampsRef.current.push(now);
      const updated60s = correctTimestampsRef.current.filter(t => now - t <= 60000).length;
      setCurrent60s(updated60s);

      // High Score check
      if (updated60s > scores.best60s) {
        const updated = saveDrillScore(cipher, { best60s: updated60s });
        setScores(prev => ({ ...prev, best60s: updated.best60s }));
        setNewRecordAlert(true);
        setTimeout(() => setNewRecordAlert(false), 2000);
      }

      if (newStreak > scores.bestStreak) {
        const updated = saveDrillScore(cipher, { bestStreak: newStreak });
        setScores(prev => ({ ...prev, bestStreak: updated.bestStreak }));
      }

      // Calculate instantaneous cadence (CPM) with responsive blend
      if (lastCorrectTimeRef.current !== null) {
        const dt = Math.max(0.6, (now - lastCorrectTimeRef.current) / 1000);
        const instantRate = Math.min(65, Math.round(60 / dt));
        setCadence(prev => (prev === 0 ? instantRate : Math.round(0.6 * instantRate + 0.4 * prev)));
      } else {
        setCadence(22);
      }
      lastCorrectTimeRef.current = now;

      // Update letter progress
      const prevLetterProgress = progress[targetLetter] || { streak: 0, attempts: 0, correct: 0 };
      const wasUnseen = prevLetterProgress.attempts === 0;
      const wasMastered = prevLetterProgress.streak >= 3;

      let updatedLetterProgress: { streak: number; attempts: number; correct: number };
      let insertIdx: number;

      if (wasUnseen) {
        // UNSEEN correct: immediately mark as Mastered (streak 3) and send to absolute back of deck!
        updatedLetterProgress = {
          streak: 3,
          attempts: 1,
          correct: 1,
        };
        insertIdx = deck ? deck.length : 0;
      } else if (wasMastered) {
        // Already mastered: increment streak, insert into last few slots
        updatedLetterProgress = {
          streak: prevLetterProgress.streak + 1,
          attempts: prevLetterProgress.attempts + 1,
          correct: prevLetterProgress.correct + 1,
        };
        insertIdx = deck ? getMasteredInsertIndex(deck.length) : 0;
      } else {
        // Learning (recovering from a miss)
        const nextStreak = prevLetterProgress.streak + 1;
        updatedLetterProgress = {
          streak: nextStreak,
          attempts: prevLetterProgress.attempts + 1,
          correct: prevLetterProgress.correct + 1,
        };
        if (nextStreak >= 3) {
          insertIdx = deck ? getMasteredInsertIndex(deck.length) : 0;
        } else {
          insertIdx = deck ? Math.min(deck.length, 4 + nextStreak * 2) : 0;
        }
      }

      const newProgress: DrillProgress = {
        ...progress,
        [targetLetter]: updatedLetterProgress,
      };
      setProgress(newProgress);
      saveDrillProgress(cipher, newProgress);

      if (deck) {
        deck.splice(insertIdx, 0, targetLetter);
      }

      // Celebration ghost
      const ghostId = `ghost-${++ghostSeq.current}`;
      const ghostText =
        cipher === 'atbash'
          ? `${atbashChar(targetLetter)} ➔ ${targetLetter} ✓`
          : `${targetLetter} ✓`;
      setGhosts(prev => [...prev, { id: ghostId, text: ghostText }]);

      nextCard();
    } else {
      if (wrongTimerRef.current !== null) {
        window.clearTimeout(wrongTimerRef.current);
      }
      setWrongFeedback(targetLetter);
      setStreak(0);

      // Update letter progress on miss
      const prevLetterProgress = progress[targetLetter] || { streak: 0, attempts: 0, correct: 0 };
      const updatedLetterProgress = {
        streak: 0,
        attempts: prevLetterProgress.attempts + 1,
        correct: prevLetterProgress.correct,
      };
      const newProgress: DrillProgress = {
        ...progress,
        [targetLetter]: updatedLetterProgress,
      };
      setProgress(newProgress);
      saveDrillProgress(cipher, newProgress);

      // Miss: re-insert shallowly (index 3 => 2-3 intervening questions)
      if (deck) {
        const shallowIdx = Math.min(deck.length, 3);
        deck.splice(shallowIdx, 0, targetLetter);
      }

      wrongTimerRef.current = window.setTimeout(() => {
        wrongTimerRef.current = null;
        setWrongFeedback(null);
        nextCard();
      }, 1200);
    }
  }, [cipher, currentLetter, nextCard, progress, scores.best60s, scores.bestStreak, streak]);

  const confirmAnswer = useCallback(() => {
    confirmAnswerWithChar(inputVal);
  }, [confirmAnswerWithChar, inputVal]);

  // Remove ghost after animation
  const handleRemoveGhost = (id: string) => {
    setGhosts(prev => prev.filter(g => g.id !== id));
  };

  // Keep latest refs for keyboard listener
  const latestRef = useRef({ confirmAnswerWithChar, wrongFeedback });
  useEffect(() => {
    latestRef.current = { confirmAnswerWithChar, wrongFeedback };
  }, [confirmAnswerWithChar, wrongFeedback]);

  // Global typing listener: single keypress immediately answers!
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is inside a general text area or modal input
      if (e.target instanceof HTMLInputElement && e.target !== answerInputRef.current) return;
      if (e.target instanceof HTMLTextAreaElement) return;

      const { confirmAnswerWithChar: handleChar, wrongFeedback: isWrong } = latestRef.current;

      if (isWrong !== null) {
        // Any key dismisses error feedback immediately
        e.preventDefault();
        handleChar('A'); // Trigger dismiss
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

  const masteredCount = progress
    ? Object.values(progress).filter(p => p && typeof p === 'object' && (p.streak || 0) >= 3).length
    : 0;
  const heat = getHeatTier(cadence);
  const barPercent = Math.min(100, Math.round((cadence / 45) * 100));

  const streakBadge = (
    <div className="streak-badge-compact" title={`Current streak: ${streak} | Best: ${scores.bestStreak}`}>
      🔥 <strong>{streak}</strong> <small>({scores.bestStreak})</small>
    </div>
  );

  const formatWarmup = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const headerRight = workoutContext ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      {streakBadge}
      {elapsedWarmup >= 120 ? (
        <button
          type="button"
          className="btn-workout-next"
          onClick={() =>
            workoutContext.onAdvance({
              offsets60s: scores.best60s,
              offsetsCadence: cadence,
            })
          }
          title="Warm-up complete! Click to start next cipher"
        >
          Next: {workoutContext.nextCipherTitle || 'Next'} ➔
        </button>
      ) : (
        <span
          className="workout-warmup-timer"
          onDoubleClick={() => setElapsedWarmup(120)}
          title="Warm-up target: 2:00 (double-click to complete in testing)"
        >
          ⏱️ {formatWarmup(elapsedWarmup)} / 2:00
        </span>
      )}
    </div>
  ) : (
    streakBadge
  );

  const headerTitle = workoutContext
    ? `Warm-up: ${info.shortTitle}`
    : info.title;

  const renderCiphertextGlyph = () => {
    if (cipher === 'atbash') {
      return (
        <div className="symbol-glyph-box">
          <span className="atbash-cipher-char" aria-label={`Atbash ciphertext ${atbashChar(currentLetter)}`}>
            {atbashChar(currentLetter)}
          </span>
        </div>
      );
    }
    if (cipher === 'pigpen') {
      return (
        <div className="symbol-glyph-box">
          <PigpenGlyph letter={currentLetter} size={76} color="var(--accent-blue)" />
        </div>
      );
    }
    if (cipher === 'galactic') {
      return (
        <div className="symbol-glyph-box">
          <GalacticGlyph letter={currentLetter} size={76} color="var(--accent-blue)" />
        </div>
      );
    }
    return null;
  };

  return (
    <div className="drill-container symbol-drill-container">
      <DrillHeader title={headerTitle} onBack={onBack} right={headerRight} />

      {/* Sub-bar: Leaderboard + Mastery modal button */}
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

      {/* Official Cipher Reference Table (starts expanded, can be collapsed) */}
      <CollapsibleReference
        className="sticky-ref-container reference-sheet symbol-drill-ref-box"
        showLabel={`Show ${info.sheetLabel}`}
      >
        <ReferenceSheet cipher={cipher} />
      </CollapsibleReference>

      {/* Speedometer & 60s Blitz Bar */}
      <div className={`speedometer-container tier-${heat.tier}`}>
        <div className="speedometer-top-row">
          <div className="speedometer-left">
            <span className="speedometer-tier-badge">
              {heat.icon} {heat.label}
            </span>
          </div>

          <div className="speedometer-60s-stats">
            <span className="speedometer-60s-current">
              60s: <strong>{current60s}</strong>
            </span>
            <span className="speedometer-60s-best">
              (Best: {scores.best60s})
            </span>
            {newRecordAlert && (
              <span style={{ color: '#fbbf24', fontWeight: 800, animation: 'flameGlow 0.8s infinite' }}>
                ★ NEW BEST!
              </span>
            )}
          </div>
        </div>

        <div className="speedometer-bar-wrapper">
          <div className="speedometer-bar-fill" style={{ width: `${barPercent}%` }} />
        </div>
      </div>

      {/* Symbol Flashcard Question Card */}
      <div className="offset-card-wrapper">
        <div className="ghost-container">
          {ghosts.map(g => (
            <div
              key={g.id}
              className="floating-ghost"
              onAnimationEnd={() => handleRemoveGhost(g.id)}
            >
              {g.text}
            </div>
          ))}
        </div>

        <div
          className={`offset-card ${wrongFeedback ? 'feedback-wrong' : ''} ${
            heat.tier === 'onfire' ? 'card-onfire' : heat.tier === 'overdrive' ? 'card-overdrive' : ''
          }`}
        >
          <div className="prompt-label">{info.prompt}</div>

          {/* Ciphertext Visual Display */}
          <div className="prompt-value symbol-prompt-value">
            {renderCiphertextGlyph()}
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
              onChange={e => {
                const char = e.target.value.replace(/[^A-Za-z]/g, '').slice(-1).toUpperCase();
                setInputVal(char);
                if (char) {
                  confirmAnswerWithChar(char);
                }
              }}
              onKeyDown={e => {
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

      {/* Alphabet Mastery Modal */}
      <AlphabetMasteryModal
        isOpen={isMasteryOpen}
        onClose={() => setIsMasteryOpen(false)}
        progress={progress}
        onResetProgress={handleResetProgress}
        currentLetter={currentLetter}
        currentOffset={letterToOffset(currentLetter)}
        title={`${info.shortTitle} Alphabet Mastery`}
      />

      {/* Team Leaderboards Modal */}
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
