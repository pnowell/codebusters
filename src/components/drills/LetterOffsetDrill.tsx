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

interface LetterOffsetDrillProps {
  onBack: () => void;
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

const ANCHOR_OFFSETS = [2, 5, 8, 11, 14, 17, 20, 23] as const;
const ALL_OFFSETS = Array.from({ length: 26 }, (_, i) => i);
const NON_ANCHOR_OFFSETS = ALL_OFFSETS.filter(o => !ANCHOR_OFFSETS.includes(o as any));

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

function initDeckAndPool(progress: OffsetsProgress): { deck: number[]; unseen: number[] } {
  const unseen: number[] = [];
  const active: number[] = [];
  const mastered: number[] = [];

  for (let o = 0; o < 26; o++) {
    const letter = offsetToLetter(o);
    const p = progress[letter];
    if (!p || p.attempts === 0) {
      unseen.push(o);
    } else if (p.streak >= 3) {
      mastered.push(o);
    } else {
      active.push(o);
    }
  }

  // Fresh start (all 26 unseen):
  if (unseen.length === 26) {
    const initialAnchors = shuffle(ANCHOR_OFFSETS);
    const initialNeighbors = [0, 1]; // A, B
    const initialDeck = shuffle([...initialAnchors, ...initialNeighbors]);
    const initialUnseen = shuffle(NON_ANCHOR_OFFSETS.filter(o => !initialNeighbors.includes(o)));
    return { deck: initialDeck, unseen: initialUnseen };
  }

  // Resumed progress:
  let deck = shuffle(active);
  const shuffledUnseen = shuffle(unseen);

  while (deck.length < 10 && shuffledUnseen.length > 0) {
    deck.push(shuffledUnseen.shift()!);
  }

  if (deck.length < 10 && mastered.length > 0) {
    const shuffledMastered = shuffle(mastered);
    while (deck.length < 10 && shuffledMastered.length > 0) {
      deck.push(shuffledMastered.shift()!);
    }
  }

  if (deck.length === 0) {
    deck = shuffle(ALL_OFFSETS);
  }

  return { deck, unseen: shuffledUnseen };
}

function makeQuestionForOffset(offset: number, mode: DrillMode): Question {
  const letter = offsetToLetter(offset);
  const promptType = mode === 'letterToNum' ? 'letter' : 'number';
  return { offset, letter, promptType };
}

function getHeatTier(cpm: number): {
  tier: 'cruise' | 'fast' | 'overdrive' | 'onfire';
  label: string;
  icon: string;
} {
  if (cpm >= 36) return { tier: 'onfire', label: 'ON FIRE!', icon: '🔥🔥🔥' };
  if (cpm >= 26) return { tier: 'overdrive', label: 'OVERDRIVE', icon: '🔥' };
  if (cpm >= 16) return { tier: 'fast', label: 'FAST', icon: '⚡⚡' };
  return { tier: 'cruise', label: 'CRUISE', icon: '⚡' };
}

export const LetterOffsetDrill: React.FC<LetterOffsetDrillProps> = ({ onBack }) => {
  const [mode, setMode] = useState<DrillMode>('letterToNum');
  const [scores, setScores] = useState<OffsetsModeScores>(() => loadOffsetsModeScores('letterToNum'));
  const [progress, setProgress] = useState<OffsetsProgress>(loadOffsetsProgress);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [newRecordAlert, setNewRecordAlert] = useState<boolean>(false);

  // Velocity Metrics
  const [current60s, setCurrent60s] = useState<number>(0);
  const [cadence, setCadence] = useState<number>(0);
  const [streak, setStreak] = useState<number>(0);
  const correctTimestampsRef = useRef<number[]>([]);
  const lastCorrectTimeRef = useRef<number | null>(null);

  // Spaced Repetition deck initialization
  const [initialData] = useState(() => {
    const initialDeck = initDeckAndPool(loadOffsetsProgress());
    const initialQ = makeQuestionForOffset(initialDeck.deck[0] ?? 0, 'letterToNum');
    return { initialDeck, initialQ };
  });

  const deckQueueRef = useRef<{ deck: number[]; unseen: number[] }>(initialData.initialDeck);
  const [unseenCount, setUnseenCount] = useState<number>(initialData.initialDeck.unseen.length);
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

  // Live 150ms interval: Prune 60s timestamps and smoothly decay cadence if idle
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();

      // Prune timestamps older than 60s
      const filtered = correctTimestampsRef.current.filter(t => now - t <= 60000);
      correctTimestampsRef.current = filtered;
      setCurrent60s(filtered.length);

      // Decay cadence if idle for > 2.0s
      if (lastCorrectTimeRef.current !== null) {
        const timeSinceLast = (now - lastCorrectTimeRef.current) / 1000;
        if (timeSinceLast > 2.0) {
          setCadence(prev => {
            if (prev <= 1) return 0;
            return Math.max(0, Math.round((prev * 0.92 - 0.4) * 10) / 10);
          });
        }
      }
    }, 150);

    return () => window.clearInterval(interval);
  }, []);

  const nextQuestion = useCallback((overrideMode?: DrillMode) => {
    const activeMode = overrideMode || mode;
    const currentDeck = deckQueueRef.current?.deck || [];
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
    setStreak(0);
    setCurrent60s(0);
    setCadence(0);
    correctTimestampsRef.current = [];
    lastCorrectTimeRef.current = null;

    setQuestion(prev => makeQuestionForOffset(prev.offset, newMode));
    setInputVal('');
    setWrongFeedback(null);
    setTimeout(() => {
      answerInputRef.current?.focus();
    }, 40);
  };

  const handleResetProgress = () => {
    const confirmed = window.confirm(
      '⚠️ Resetting alphabet mastery will clear all letter streaks and lock 60s high-score recording until all 26 letters are re-introduced into practice.\n\nAre you sure you want to proceed?'
    );
    if (confirmed) {
      resetOffsetsProgress();
      const freshProgress: OffsetsProgress = {};
      setProgress(freshProgress);
      const freshDeck = initDeckAndPool(freshProgress);
      deckQueueRef.current = freshDeck;
      setUnseenCount(freshDeck.unseen.length);
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

    const queue = deckQueueRef.current;
    const currentOffset = question.offset;
    const letter = question.letter;
    const now = Date.now();

    // Pop the answered offset from the front of the active deck
    if (queue && queue.deck[0] === currentOffset) {
      queue.deck.shift();
    } else if (queue) {
      const idx = queue.deck.indexOf(currentOffset);
      if (idx !== -1) queue.deck.splice(idx, 1);
    }

    if (isCorrect) {
      setCorrectQuestions(prev => prev + 1);
      const newStreak = streak + 1;
      setStreak(newStreak);

      // Record timestamp for 60s Blitz
      correctTimestampsRef.current.push(now);
      const updated60s = correctTimestampsRef.current.filter(t => now - t <= 60000).length;
      setCurrent60s(updated60s);

      // Full Track Qualifier: All 26 letters in rotation
      const isQualified = unseenCount === 0;

      if (isQualified && updated60s > scores.best60s) {
        const updated = saveOffsetsModeScore(mode, { best60s: updated60s });
        setScores(prev => ({ ...prev, best60s: updated.best60s }));
        setNewRecordAlert(true);
        setTimeout(() => setNewRecordAlert(false), 2000);
      }

      if (newStreak > scores.bestStreak) {
        const updated = saveOffsetsModeScore(mode, { bestStreak: newStreak });
        setScores(prev => ({ ...prev, bestStreak: updated.bestStreak }));
      }

      // Calculate instantaneous cadence (CPM) with EMA smoothing
      if (lastCorrectTimeRef.current !== null) {
        const dt = Math.max(0.5, (now - lastCorrectTimeRef.current) / 1000);
        const instantRate = Math.min(65, Math.round(60 / dt));
        setCadence(prev => (prev === 0 ? instantRate : Math.round(0.55 * instantRate + 0.45 * prev)));
      } else {
        setCadence(20);
      }
      lastCorrectTimeRef.current = now;

      // Update letter progress
      const prevLetterProgress = progress[letter] || { streak: 0, attempts: 0, correct: 0 };
      const updatedLetterProgress = {
        streak: prevLetterProgress.streak + 1,
        attempts: prevLetterProgress.attempts + 1,
        correct: prevLetterProgress.correct + 1,
      };
      const newProgress: OffsetsProgress = {
        ...progress,
        [letter]: updatedLetterProgress,
      };
      setProgress(newProgress);
      saveOffsetsProgress(newProgress);

      // Re-insert current letter deep into the deck (min 4 intervening questions)
      if (queue) {
        const insertIdx = Math.min(queue.deck.length, 4 + updatedLetterProgress.streak * 2);
        queue.deck.splice(insertIdx, 0, currentOffset);

        // Introduce unseen letter if deck length < 14 and pool has candidates
        if (queue.unseen.length > 0 && queue.deck.length < 14) {
          const newOffset = queue.unseen.shift()!;
          const introIdx = Math.min(queue.deck.length, 4 + Math.floor(Math.random() * 3));
          queue.deck.splice(introIdx, 0, newOffset);
          setUnseenCount(queue.unseen.length);
        }
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
      saveOffsetsProgress(newProgress);

      // Re-insert shallowly (index 3 => 2-3 intervening questions)
      if (queue) {
        const shallowIdx = Math.min(queue.deck.length, 3);
        queue.deck.splice(shallowIdx, 0, currentOffset);
      }

      wrongTimerRef.current = window.setTimeout(() => {
        wrongTimerRef.current = null;
        setWrongFeedback(null);
        nextQuestion();
      }, 1200);
    }
  }, [inputVal, mode, nextQuestion, progress, question, scores.best60s, scores.bestStreak, streak, unseenCount]);

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
  const isFullTrackQualified = unseenCount === 0;

  const heat = getHeatTier(cadence);
  const barPercent = Math.min(100, Math.round((cadence / 45) * 100));

  const streakBadge = (
    <div className="streak-badge-compact" title={`Current streak: ${streak} | Best: ${scores.bestStreak}`}>
      🔥 <strong>{streak}</strong> <small>({scores.bestStreak})</small>
    </div>
  );

  return (
    <div className="drill-container">
      <DrillHeader title="Letter Offsets" onBack={onBack} right={streakBadge} />

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

        <button
          type="button"
          className="mastery-chip-btn"
          onClick={() => setIsModalOpen(true)}
          title="Click to view detailed Alphabet Mastery & letter streaks"
        >
          📊 {masteredCount}/26 Mastered
        </button>
      </div>

      {/* Speedometer & 60s Blitz Bar */}
      <div className={`speedometer-container tier-${heat.tier}`}>
        <div className="speedometer-top-row">
          <div className="speedometer-left">
            <span className="speedometer-tier-badge">
              {heat.icon} {heat.label}
            </span>
            <span className="speedometer-cpm-text">
              {cadence} <small style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>cpm</small>
            </span>
          </div>

          <div className="speedometer-60s-stats">
            {isFullTrackQualified ? (
              <>
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
              </>
            ) : (
              <>
                <span className="speedometer-60s-current">
                  60s: <strong>{current60s}</strong>
                </span>
                <span className="speedometer-training-tag" title="Unlock all 26 letters into practice to qualify for official 60s records!">
                  Training ({26 - unseenCount}/26)
                </span>
              </>
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
      />
    </div>
  );
};
