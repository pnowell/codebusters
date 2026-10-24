import React, { useState, useEffect, useCallback, useRef } from 'react';
import { offsetToLetter } from '../../utils/ciphers';
import {
  loadBestStreak,
  saveBestStreak,
  loadOffsetsProgress,
  saveOffsetsProgress,
  resetOffsetsProgress,
  type OffsetsProgress,
} from '../../services/storage';
import { DrillHeader } from '../drill/DrillHeader';
import { CollapsibleReference } from '../drill/CollapsibleReference';
import { AnchorTable } from '../drill/AnchorTable';
import { DrillActionRow } from '../drill/DrillActionRow';

interface LetterOffsetDrillProps {
  onBack: () => void;
}

type DrillMode = 'letterToNum' | 'numToLetter' | 'mixed';

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
const ANCHORS = ANCHOR_OFFSETS.map(offset => ({
  offset,
  letter: offsetToLetter(offset),
}));

const ALL_OFFSETS = Array.from({ length: 26 }, (_, i) => i);
const NON_ANCHOR_OFFSETS = ALL_OFFSETS.filter(o => !ANCHOR_OFFSETS.includes(o as any));

const ROW_1_OFFSETS = ALL_OFFSETS.slice(0, 13); // A to M (0 to 12)
const ROW_2_OFFSETS = ALL_OFFSETS.slice(13);     // N to Z (13 to 25)

const MODES: readonly { readonly id: DrillMode; readonly label: string }[] = [
  { id: 'letterToNum', label: 'Letter → #' },
  { id: 'numToLetter', label: '# → Letter' },
  { id: 'mixed', label: 'Mixed' },
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

  // If this is a fresh start (all 26 unseen)
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

  // If active items < 10, pull in unseen items
  while (deck.length < 10 && shuffledUnseen.length > 0) {
    deck.push(shuffledUnseen.shift()!);
  }

  // If deck still < 10 (most items are mastered), pull from mastered
  if (deck.length < 10 && mastered.length > 0) {
    const shuffledMastered = shuffle(mastered);
    while (deck.length < 10 && shuffledMastered.length > 0) {
      deck.push(shuffledMastered.shift()!);
    }
  }

  // If deck is still empty, include all offsets
  if (deck.length === 0) {
    deck = shuffle(ALL_OFFSETS);
  }

  return { deck, unseen: shuffledUnseen };
}

function makeQuestionForOffset(offset: number, mode: DrillMode): Question {
  const letter = offsetToLetter(offset);
  let promptType: 'letter' | 'number';
  if (mode === 'letterToNum') {
    promptType = 'letter';
  } else if (mode === 'numToLetter') {
    promptType = 'number';
  } else {
    promptType = Math.random() > 0.5 ? 'letter' : 'number';
  }
  return { offset, letter, promptType };
}

export const LetterOffsetDrill: React.FC<LetterOffsetDrillProps> = ({ onBack }) => {
  const [mode, setMode] = useState<DrillMode>('letterToNum');
  const [progress, setProgress] = useState<OffsetsProgress>(loadOffsetsProgress);

  const [initialData] = useState(() => {
    const initialDeck = initDeckAndPool(loadOffsetsProgress());
    const initialQ = makeQuestionForOffset(initialDeck.deck[0] ?? 0, 'letterToNum');
    return { initialDeck, initialQ };
  });

  const deckQueueRef = useRef<{ deck: number[]; unseen: number[] }>(initialData.initialDeck);
  const [question, setQuestion] = useState<Question>(initialData.initialQ);
  const [inputVal, setInputVal] = useState<string>('');
  const [wrongFeedback, setWrongFeedback] = useState<string | null>(null);
  const [streak, setStreak] = useState<number>(0);
  const [bestStreak, setBestStreak] = useState<number>(loadBestStreak);
  const [totalQuestions, setTotalQuestions] = useState<number>(0);
  const [correctQuestions, setCorrectQuestions] = useState<number>(0);
  const [ghosts, setGhosts] = useState<FloatingGhost[]>([]);

  const answerInputRef = useRef<HTMLInputElement | null>(null);
  const ghostSeq = useRef(0);
  const wrongTimerRef = useRef<number | null>(null);

  // Clean up any pending wrong feedback timer on unmount
  useEffect(() => {
    return () => {
      if (wrongTimerRef.current !== null) {
        window.clearTimeout(wrongTimerRef.current);
      }
    };
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
    setMode(newMode);
    // Keep current offset and just change prompt type to match new mode
    setQuestion(prev => makeQuestionForOffset(prev.offset, newMode));
    setInputVal('');
    setWrongFeedback(null);
    setTimeout(() => {
      answerInputRef.current?.focus();
    }, 40);
  };

  const handleResetProgress = () => {
    if (window.confirm('Reset alphabet mastery progress?')) {
      resetOffsetsProgress();
      const freshProgress: OffsetsProgress = {};
      setProgress(freshProgress);
      deckQueueRef.current = initDeckAndPool(freshProgress);
      nextQuestion();
    }
  };

  const confirmAnswer = useCallback(() => {
    // Block multiple submissions while wrong answer feedback is showing
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
      if (newStreak > bestStreak) {
        setBestStreak(newStreak);
        saveBestStreak(newStreak);
      }

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

      // Re-insert current letter deep into the deck:
      // Minimum 4 intervening letters, scaling with streak
      if (queue) {
        const insertIdx = Math.min(queue.deck.length, 4 + updatedLetterProgress.streak * 2);
        queue.deck.splice(insertIdx, 0, currentOffset);

        // Introduce an unseen letter if deck length < 14 and unseen pool has candidates
        if (queue.unseen.length > 0 && queue.deck.length < 14) {
          const newOffset = queue.unseen.shift()!;
          const introIdx = Math.min(queue.deck.length, 4 + Math.floor(Math.random() * 3));
          queue.deck.splice(introIdx, 0, newOffset);
        }
      }

      // Add a celebration ghost that floats away
      const ghostId = `ghost-${++ghostSeq.current}`;
      const ghostText = `${question.letter} = ${question.offset} ✓`;
      setGhosts(prev => [...prev, { id: ghostId, text: ghostText }]);

      // Immediately jump to next question
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

      // Re-insert shallowly (guaranteeing 2-3 intervening questions before re-test)
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
  }, [bestStreak, inputVal, nextQuestion, progress, question, streak]);

  // Remove ghost when animation finishes
  const handleRemoveGhost = (id: string) => {
    setGhosts(prev => prev.filter(g => g.id !== id));
  };

  // Keep latest refs so global keydown listener remains stable
  const latestRef = useRef({ confirmAnswer, question });
  useEffect(() => {
    latestRef.current = { confirmAnswer, question };
  }, [confirmAnswer, question]);

  // Global listener so typing immediately focuses the native input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === answerInputRef.current) {
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

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

  const streakBadge = (
    <div className="streak-badge-compact">
      🔥 <strong>{streak}</strong> <small>({bestStreak})</small>
    </div>
  );

  const masteredCount = Object.values(progress).filter(p => p.streak >= 3).length;

  const renderBadge = (offset: number) => {
    const letter = offsetToLetter(offset);
    const p = progress[letter];
    const isAnchor = ANCHOR_OFFSETS.includes(offset as any);
    const isCurrent = question.offset === offset;

    let statusClass = 'status-unseen';
    let statusLabel = 'Unseen';

    if (p && p.attempts > 0) {
      if (p.streak >= 3) {
        statusClass = 'status-mastered';
        statusLabel = `Mastered (${p.correct}/${p.attempts}, streak ${p.streak})`;
      } else if (p.streak === 0) {
        statusClass = 'status-missed';
        statusLabel = `Needs Practice (${p.correct}/${p.attempts})`;
      } else {
        statusClass = 'status-learning';
        statusLabel = `Learning (${p.correct}/${p.attempts}, streak ${p.streak})`;
      }
    }

    const classes = [
      'mastery-badge',
      statusClass,
      isAnchor ? 'is-anchor' : '',
      isCurrent ? 'is-current' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const title = `${letter} (${offset}): ${statusLabel}${isAnchor ? ' • Anchor' : ''}`;

    return (
      <div key={letter} className={classes} title={title}>
        {letter}
      </div>
    );
  };

  return (
    <div className="drill-container">
      <DrillHeader title="Letter Offsets" onBack={onBack} right={streakBadge} />

      <div className="mode-selector">
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

      <CollapsibleReference showLabel="Show Anchors Reference" className="sparse-ref-panel">
        <AnchorTable anchors={ANCHORS} />
      </CollapsibleReference>

      <div className="mastery-tracker">
        <div className="mastery-header">
          <div className="mastery-stats">
            <span className="mastery-title">Alphabet Mastery</span>
            <span className="mastery-count">
              <strong>{masteredCount}</strong> / 26 Mastered
            </span>
          </div>
          <button
            type="button"
            className="mastery-reset-btn"
            title="Reset alphabet mastery"
            onClick={handleResetProgress}
          >
            ↺ Reset
          </button>
        </div>
        <div className="mastery-grid">
          <div className="mastery-row">
            {ROW_1_OFFSETS.map(renderBadge)}
          </div>
          <div className="mastery-row">
            {ROW_2_OFFSETS.map(renderBadge)}
          </div>
        </div>
      </div>

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

        <div className={`offset-card ${wrongFeedback ? 'feedback-wrong' : ''}`}>
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
    </div>
  );
};
