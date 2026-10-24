import React, { useState, useEffect, useCallback, useRef } from 'react';
import { offsetToLetter } from '../../utils/ciphers';
import { loadBestStreak, saveBestStreak } from '../../services/storage';
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

const MODES: readonly { readonly id: DrillMode; readonly label: string }[] = [
  { id: 'letterToNum', label: 'Letter → #' },
  { id: 'numToLetter', label: '# → Letter' },
  { id: 'mixed', label: 'Mixed' },
];

function makeQuestion(mode: DrillMode): Question {
  const offset = Math.floor(Math.random() * 26);
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
  const [question, setQuestion] = useState<Question>(() => makeQuestion('letterToNum'));
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
    setQuestion(makeQuestion(activeMode));
    setInputVal('');
    setWrongFeedback(null);
    setTimeout(() => {
      answerInputRef.current?.focus();
    }, 40);
  }, [mode]);

  const handleModeChange = (newMode: DrillMode) => {
    setMode(newMode);
    nextQuestion(newMode);
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

    if (isCorrect) {
      setCorrectQuestions(prev => prev + 1);
      const newStreak = streak + 1;
      setStreak(newStreak);
      if (newStreak > bestStreak) {
        setBestStreak(newStreak);
        saveBestStreak(newStreak);
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
      wrongTimerRef.current = window.setTimeout(() => {
        wrongTimerRef.current = null;
        setWrongFeedback(null);
        setInputVal('');
        answerInputRef.current?.focus();
      }, 1200);
    }
  }, [bestStreak, inputVal, nextQuestion, question, streak]);

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
