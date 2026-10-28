import React, { useState, useEffect, useCallback, useRef } from 'react';
import { offsetToLetter } from '../../utils/ciphers';
import {
  loadOffsetsModeScores,
  saveOffsetsModeScore,
  loadOffsetsProgress,
  saveOffsetsProgress,
  resetOffsetsProgress,
  type OffsetsMode,
  type OffsetsModeScores,
  type OffsetsProgress,
} from '../../services/storage';
import { DrillHeader } from '../drill/DrillHeader';
import { DrillActionRow } from '../drill/DrillActionRow';
import { AlphabetMasteryModal } from '../drill/AlphabetMasteryModal';
import { LeaderboardModal } from '../leaderboard/LeaderboardModal';

export interface WorkoutStepContext {
  round: number;
  stepIndex: number;
  totalSteps: number;
  offsetsMode?: OffsetsMode;
  nextCipherTitle?: string;
  isLastStep: boolean;
  onAdvance: (stepResult?: {
    offsets60s?: number;
    offsetsCadence?: number;
    offsetsMode?: OffsetsMode;
    timeSeconds?: number;
    accuracy?: number;
    author?: string;
  }) => void;
}

interface LetterOffsetDrillProps {
  onBack: () => void;
  workoutContext?: WorkoutStepContext;
}

type DrillMode = OffsetsMode;

interface FloatingGhost {
  id: string;
  text: string;
}

interface Question {
  offset: number;
  letter: string;
  promptType: 'letter' | 'number';
}

const ALL_OFFSETS = Array.from({ length: 26 }, (_, i) => i);

const MODES: readonly { readonly id: DrillMode; readonly label: string }[] = [
  { id: 'letterToNum', label: 'Letter → #' },
  { id: 'numToLetter', label: '# → Letter' },
];

function shuffle<T>(arr: readonly T[] | T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Weighted offset from the back of the deck for already-mastered letters:
 * - 50% chance: 0 (the absolute back of the deck)
 * - 25% chance: 1 (1 card from the back)
 * - 15% chance: 2 (2 cards from the back)
 * - 10% chance: 3 (3 cards from the back)
 * Favors 0 strongly to prevent any card from getting stranded, while providing gentle shuffling.
 */
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

function initDeck(progress: OffsetsProgress): number[] {
  const learningOrMissed: number[] = [];
  const unseen: number[] = [];
  const mastered: number[] = [];

  for (let o = 0; o < 26; o++) {
    const letter = offsetToLetter(o);
    const p = progress[letter];
    if (!p || p.attempts === 0) {
      unseen.push(o);
    } else if (p.streak >= 3) {
      mastered.push(o);
    } else {
      learningOrMissed.push(o);
    }
  }

  // Fresh start or reset (all 26 unseen): fully shuffle all 26 letters
  if (unseen.length === 26) {
    return shuffle(ALL_OFFSETS);
  }

  // Resumed progress: learning items come first, then unseen, then mastered
  return [
    ...shuffle(learningOrMissed),
    ...shuffle(unseen),
    ...shuffle(mastered),
  ];
}

function makeQuestionForOffset(offset: number, mode: DrillMode): Question {
  const letter = offsetToLetter(offset);
  const promptType = mode === 'letterToNum' ? 'letter' : 'number';
  return { offset, letter, promptType };
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

export const LetterOffsetDrill: React.FC<LetterOffsetDrillProps> = ({ onBack, workoutContext }) => {
  const initialMode: DrillMode = workoutContext?.offsetsMode || 'letterToNum';
  const [mode, setMode] = useState<DrillMode>(initialMode);
  const [scores, setScores] = useState<OffsetsModeScores>(() => loadOffsetsModeScores(initialMode));
  const [progress, setProgress] = useState<OffsetsProgress>(() => loadOffsetsProgress(initialMode));
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState<boolean>(false);
  const [newRecordAlert, setNewRecordAlert] = useState<boolean>(false);

  // Velocity Metrics
  const [current60s, setCurrent60s] = useState<number>(0);
  const [cadence, setCadence] = useState<number>(0);
  const [streak, setStreak] = useState<number>(0);
  const correctTimestampsRef = useRef<number[]>([]);
  const lastCorrectTimeRef = useRef<number | null>(null);

  // Warm-up timer when in General Practice workout mode
  const [elapsedWarmup, setElapsedWarmup] = useState(0);
  useEffect(() => {
    if (!workoutContext) return;
    const interval = window.setInterval(() => {
      setElapsedWarmup(s => s + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [workoutContext]);

  // Spaced Repetition deck initialization: always 26 letters in rotation
  const [initialData] = useState(() => {
    const initialDeck = initDeck(loadOffsetsProgress(initialMode));
    const initialQ = makeQuestionForOffset(initialDeck[0] ?? 0, initialMode);
    return { initialDeck, initialQ };
  });

  const deckQueueRef = useRef<number[]>(initialData.initialDeck);
  const [question, setQuestion] = useState<Question>(initialData.initialQ);
  const [inputVal, setInputVal] = useState<string>('');
  const [wrongFeedback, setWrongFeedback] = useState<string | null>(null);
  const [totalQuestions, setTotalQuestions] = useState<number>(0);
  const [correctQuestions, setCorrectQuestions] = useState<number>(0);
  const [ghosts, setGhosts] = useState<FloatingGhost[]>([]);

  const answerInputRef = useRef<HTMLInputElement | null>(null);
  const ghostSeq = useRef(0);
  const wrongTimerRef = useRef<number | null>(null);

  // Clean up wrong feedback timer on unmount
  useEffect(() => {
    return () => {
      if (wrongTimerRef.current !== null) {
        window.clearTimeout(wrongTimerRef.current);
      }
    };
  }, []);

  // Live 150ms interval: Prune 60s timestamps and smoothly decay cadence after 3.5s hold
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

  const nextQuestion = useCallback((overrideMode?: DrillMode) => {
    const activeMode = overrideMode || mode;
    const currentDeck = deckQueueRef.current || [];
    const nextOffset = currentDeck.length > 0 ? currentDeck[0] : Math.floor(Math.random() * 26);
    setQuestion(makeQuestionForOffset(nextOffset, activeMode));
    setInputVal('');
    setWrongFeedback(null);
    setTimeout(() => {
      answerInputRef.current?.focus();
    }, 40);
  }, [mode]);

  const handleModeChange = (newMode: DrillMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setScores(loadOffsetsModeScores(newMode));
    const newProgress = loadOffsetsProgress(newMode);
    setProgress(newProgress);
    const newDeck = initDeck(newProgress);
    deckQueueRef.current = newDeck;
    setStreak(0);
    setCurrent60s(0);
    setCadence(0);
    correctTimestampsRef.current = [];
    lastCorrectTimeRef.current = null;

    setQuestion(makeQuestionForOffset(newDeck[0] ?? 0, newMode));
    setInputVal('');
    setWrongFeedback(null);
    setTimeout(() => {
      answerInputRef.current?.focus();
    }, 40);
  };

  const handleResetProgress = () => {
    const modeLabel = mode === 'letterToNum' ? 'Letter → #' : '# → Letter';
    const confirmed = window.confirm(
      `⚠️ Resetting ${modeLabel} alphabet mastery will clear all letter streaks for this mode and return all 26 letters to unseen in the deck.\n\nAre you sure you want to proceed?`
    );
    if (confirmed) {
      resetOffsetsProgress(mode);
      const freshProgress: OffsetsProgress = {};
      setProgress(freshProgress);
      const freshDeck = initDeck(freshProgress);
      deckQueueRef.current = freshDeck;
      setIsModalOpen(false);
      nextQuestion();
    }
  };

  const confirmAnswer = useCallback(() => {
    if (wrongTimerRef.current !== null) return;

    const trimmed = inputVal.trim().toUpperCase();
    if (!trimmed) return;

    setTotalQuestions(prev => prev + 1);

    const isCorrect =
      question.promptType === 'letter'
        ? parseInt(trimmed, 10) === question.offset
        : trimmed === question.letter;

    const deck = deckQueueRef.current;
    const currentOffset = question.offset;
    const letter = question.letter;
    const now = Date.now();

    // Pop the answered offset from the front of the active deck
    if (deck && deck[0] === currentOffset) {
      deck.shift();
    } else if (deck) {
      const idx = deck.indexOf(currentOffset);
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

      // High Score check (all 26 letters are in the deck from the start)
      if (updated60s > scores.best60s) {
        const updated = saveOffsetsModeScore(mode, { best60s: updated60s });
        setScores(prev => ({ ...prev, best60s: updated.best60s }));
        setNewRecordAlert(true);
        setTimeout(() => setNewRecordAlert(false), 2000);
      }

      if (newStreak > scores.bestStreak) {
        const updated = saveOffsetsModeScore(mode, { bestStreak: newStreak });
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
      const prevLetterProgress = progress[letter] || { streak: 0, attempts: 0, correct: 0 };
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
        // Already mastered: increment streak, insert into last few slots (50% back, 25% -1, 15% -2, 10% -3)
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

      const newProgress: OffsetsProgress = {
        ...progress,
        [letter]: updatedLetterProgress,
      };
      setProgress(newProgress);
      saveOffsetsProgress(mode, newProgress);

      if (deck) {
        deck.splice(insertIdx, 0, currentOffset);
      }

      // Celebration ghost
      const ghostId = `ghost-${++ghostSeq.current}`;
      const ghostText = `${question.letter} = ${question.offset} ✓`;
      setGhosts(prev => [...prev, { id: ghostId, text: ghostText }]);

      nextQuestion();
    } else {
      if (wrongTimerRef.current !== null) {
        window.clearTimeout(wrongTimerRef.current);
      }
      setWrongFeedback(question.promptType === 'letter' ? `${question.offset}` : question.letter);
      setStreak(0);

      // Update letter progress on miss
      const prevLetterProgress = progress[letter] || { streak: 0, attempts: 0, correct: 0 };
      const updatedLetterProgress = {
        streak: 0,
        attempts: prevLetterProgress.attempts + 1,
        correct: prevLetterProgress.correct,
      };
      const newProgress: OffsetsProgress = {
        ...progress,
        [letter]: updatedLetterProgress,
      };
      setProgress(newProgress);
      saveOffsetsProgress(mode, newProgress);

      // Miss: re-insert shallowly (index 3 => 2-3 intervening questions)
      if (deck) {
        const shallowIdx = Math.min(deck.length, 3);
        deck.splice(shallowIdx, 0, currentOffset);
      }

      wrongTimerRef.current = window.setTimeout(() => {
        wrongTimerRef.current = null;
        setWrongFeedback(null);
        nextQuestion();
      }, 1200);
    }
  }, [inputVal, mode, nextQuestion, progress, question, scores.best60s, scores.bestStreak, streak]);

  // Remove ghost after animation
  const handleRemoveGhost = (id: string) => {
    setGhosts(prev => prev.filter(g => g.id !== id));
  };

  // Keep latest refs for keyboard listener
  const latestRef = useRef({ confirmAnswer, question });
  useEffect(() => {
    latestRef.current = { confirmAnswer, question };
  }, [confirmAnswer, question]);

  // Global typing listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === answerInputRef.current) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const { confirmAnswer: handleConfirm, question: currentQ } = latestRef.current;

      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setInputVal(prev => prev.slice(0, -1));
        answerInputRef.current?.focus();
      } else if (currentQ.promptType === 'letter' && e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        setInputVal(prev => (prev.length < 2 ? prev + e.key : e.key));
        answerInputRef.current?.focus();
      } else if (currentQ.promptType === 'number' && /^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        setInputVal(e.key.toUpperCase());
        answerInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const masteredCount = Object.values(progress).filter(p => p.streak >= 3).length;
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
              offsetsMode: mode,
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

  const modeLabel = mode === 'letterToNum' ? 'Letter → #' : '# → Letter';
  const headerTitle = workoutContext
    ? `Warm-up: ${modeLabel}`
    : 'Letter Offsets';

  return (
    <div className="drill-container">
      <DrillHeader title={headerTitle} onBack={onBack} right={headerRight} />

      {/* Sub-bar: 2 Modes on the left + Mastery trigger chip on the right */}
      <div className="offsets-subbar">
        <div className="mode-selector" style={{ margin: 0 }}>
          {MODES.map(m => (
            <button
              key={m.id}
              type="button"
              className={`mode-btn ${mode === m.id ? 'active' : ''}`}
              onClick={e => {
                e.currentTarget.blur();
                handleModeChange(m.id);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button
            type="button"
            className="leaderboard-chip-btn"
            onClick={() => setIsLeaderboardOpen(true)}
            title="View Team Leaderboard for this mode"
          >
            🏆 Leaderboard
          </button>
          <button
            type="button"
            className="mastery-chip-btn"
            onClick={() => setIsModalOpen(true)}
            title={`Click to view detailed Alphabet Mastery & letter streaks for ${modeLabel}`}
          >
            📊 {masteredCount}/26 Mastered
          </button>
        </div>
      </div>

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

      {/* Offset Question Card */}
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
          <div className="prompt-label">
            {question.promptType === 'letter'
              ? 'What is the number offset for:'
              : 'Which letter has offset:'}
          </div>
          <div className="prompt-value">
            {question.promptType === 'letter' ? question.letter : question.offset}
          </div>

          <div
            className="user-answer-box-wrapper"
            onClick={() => answerInputRef.current?.focus()}
          >
            <input
              ref={answerInputRef}
              type="text"
              inputMode={question.promptType === 'letter' ? 'numeric' : 'text'}
              pattern={question.promptType === 'letter' ? '[0-9]*' : undefined}
              autoCapitalize={question.promptType === 'number' ? 'characters' : 'off'}
              autoCorrect="off"
              autoComplete="off"
              spellCheck="false"
              enterKeyHint="done"
              className="user-answer-native-input"
              value={inputVal}
              placeholder="?"
              onChange={e => {
                const val = e.target.value.toUpperCase();
                if (question.promptType === 'letter') {
                  const cleaned = val.replace(/[^0-9]/g, '').slice(0, 2);
                  setInputVal(cleaned);
                } else {
                  const cleaned = val.replace(/[^A-Z]/g, '').slice(-1);
                  setInputVal(cleaned);
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
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        progress={progress}
        onResetProgress={handleResetProgress}
        currentOffset={question.offset}
        mode={mode}
      />

      {/* Team Leaderboard Modal */}
      <LeaderboardModal
        isOpen={isLeaderboardOpen}
        onClose={() => setIsLeaderboardOpen(false)}
        initialMode={mode}
      />
    </div>
  );
};
