import React, { useState, useEffect, useCallback, useRef } from 'react';
import { offsetToLetter } from '../../utils/ciphers';

interface LetterOffsetDrillProps {
  onBack: () => void;
}

type DrillMode = 'letterToNum' | 'numToLetter' | 'mixed';

interface FloatingGhost {
  id: string;
  text: string;
}

const ANCHORS = [
  { letter: 'C', offset: 2 },
  { letter: 'F', offset: 5 },
  { letter: 'I', offset: 8 },
  { letter: 'L', offset: 11 },
  { letter: 'O', offset: 14 },
  { letter: 'R', offset: 17 },
  { letter: 'U', offset: 20 },
  { letter: 'X', offset: 23 },
];

export const LetterOffsetDrill: React.FC<LetterOffsetDrillProps> = ({ onBack }) => {
  const [mode, setMode] = useState<DrillMode>('letterToNum');
  const [currentLetter, setCurrentLetter] = useState<string>('A');
  const [currentOffset, setCurrentOffset] = useState<number>(0);
  const [promptType, setPromptType] = useState<'letter' | 'number'>('letter');

  const [inputVal, setInputVal] = useState<string>('');
  const [wrongFeedback, setWrongFeedback] = useState<string | null>(null);
  const [streak, setStreak] = useState<number>(0);
  const [bestStreak, setBestStreak] = useState<number>(() => {
    return parseInt(localStorage.getItem('davinci_offsets_best_streak') || '0', 10);
  });
  const [totalQuestions, setTotalQuestions] = useState<number>(0);
  const [correctQuestions, setCorrectQuestions] = useState<number>(0);
  const [ghosts, setGhosts] = useState<FloatingGhost[]>([]);
  const [showRef, setShowRef] = useState<boolean>(true);

  const answerInputRef = useRef<HTMLInputElement | null>(null);

  // Pick next question
  const nextQuestion = useCallback((overrideMode?: DrillMode) => {
    const activeMode = overrideMode || mode;
    const randOffset = Math.floor(Math.random() * 26);
    const randLetter = offsetToLetter(randOffset);

    setCurrentOffset(randOffset);
    setCurrentLetter(randLetter);
    setInputVal('');
    setWrongFeedback(null);

    if (activeMode === 'letterToNum') {
      setPromptType('letter');
    } else if (activeMode === 'numToLetter') {
      setPromptType('number');
    } else {
      setPromptType(Math.random() > 0.5 ? 'letter' : 'number');
    }

    setTimeout(() => {
      answerInputRef.current?.focus();
    }, 40);
  }, [mode]);

  useEffect(() => {
    nextQuestion();
  }, [nextQuestion]);

  const handleModeChange = (newMode: DrillMode) => {
    setMode(newMode);
    nextQuestion(newMode);
  };

  const confirmAnswer = useCallback(() => {
    const trimmed = inputVal.trim().toUpperCase();
    if (!trimmed) return;

    setTotalQuestions(prev => prev + 1);

    const isCorrect =
      promptType === 'letter'
        ? parseInt(trimmed, 10) === currentOffset
        : trimmed === currentLetter;

    if (isCorrect) {
      setCorrectQuestions(prev => prev + 1);
      const newStreak = streak + 1;
      setStreak(newStreak);
      if (newStreak > bestStreak) {
        setBestStreak(newStreak);
        localStorage.setItem('davinci_offsets_best_streak', newStreak.toString());
      }

      // Add a celebration ghost that floats away
      const ghostId = Math.random().toString();
      const ghostText = `${currentLetter} = ${currentOffset} ✓`;
      setGhosts(prev => [...prev, { id: ghostId, text: ghostText }]);

      // Immediately jump to next question
      nextQuestion();
    } else {
      setWrongFeedback(promptType === 'letter' ? `${currentOffset}` : currentLetter);
      setStreak(0);
      setTimeout(() => {
        setWrongFeedback(null);
        setInputVal('');
        answerInputRef.current?.focus();
      }, 1200);
    }
  }, [bestStreak, currentLetter, currentOffset, inputVal, nextQuestion, promptType, streak]);

  // Remove ghost when animation finishes
  const handleRemoveGhost = (id: string) => {
    setGhosts(prev => prev.filter(g => g.id !== id));
  };

  // Global listener so typing immediately focuses the native input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === answerInputRef.current) {
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        confirmAnswer();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setInputVal(prev => prev.slice(0, -1));
        answerInputRef.current?.focus();
      } else if (promptType === 'letter' && e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        setInputVal(prev => (prev.length < 2 ? prev + e.key : e.key));
        answerInputRef.current?.focus();
      } else if (promptType === 'number' && /^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        setInputVal(e.key.toUpperCase());
        answerInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmAnswer, promptType]);

  return (
    <div className="drill-container card-panel">
      {/* Compact drill header */}
      <div className="drill-header-compact">
        <button className="btn-simple btn-back" onClick={onBack}>
          ← Menu
        </button>
        <h2 className="drill-title-compact">Letter Offsets</h2>
        <div className="streak-badge-compact">
          🔥 <strong>{streak}</strong> <small>({bestStreak})</small>
        </div>
      </div>

      <div className="mode-selector">
        <button
          className={`mode-btn ${mode === 'letterToNum' ? 'active' : ''}`}
          onClick={(e) => {
            (e.currentTarget as HTMLButtonElement).blur();
            handleModeChange('letterToNum');
          }}
        >
          Letter → #
        </button>
        <button
          className={`mode-btn ${mode === 'numToLetter' ? 'active' : ''}`}
          onClick={(e) => {
            (e.currentTarget as HTMLButtonElement).blur();
            handleModeChange('numToLetter');
          }}
        >
          # → Letter
        </button>
        <button
          className={`mode-btn ${mode === 'mixed' ? 'active' : ''}`}
          onClick={(e) => {
            (e.currentTarget as HTMLButtonElement).blur();
            handleModeChange('mixed');
          }}
        >
          Mixed
        </button>
      </div>

      {/* Sparse Anchors Reference Panel */}
      {showRef ? (
        <div className="sparse-ref-panel">
          <button
            type="button"
            className="ref-close-btn"
            onClick={() => setShowRef(false)}
            title="Hide reference"
            aria-label="Hide reference"
          >
            ✕
          </button>
          <div className="sparse-table-wrapper">
            <table className="sparse-anchor-table">
              <colgroup>
                <col className="col-label" />
                {ANCHORS.map(a => (
                  <col key={a.letter} className="col-data" />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="anchor-header-cell">Letter</th>
                  {ANCHORS.map(a => (
                    <th key={a.letter} className="anchor-col-cell anchor-letter">
                      {a.letter}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="anchor-header-cell">Offset</td>
                  {ANCHORS.map(a => (
                    <td key={a.letter} className="anchor-col-cell anchor-offset">
                      {a.offset}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="show-ref-row">
          <button
            type="button"
            className="btn-simple show-ref-btn"
            onClick={() => setShowRef(true)}
          >
            📖 Show Anchors Reference
          </button>
        </div>
      )}

      <div className="offset-card-wrapper">
        {/* Floating animated ghost badges stacking upwards upon correct answers */}
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
            {promptType === 'letter' ? 'What is the number offset for:' : 'Which letter has offset:'}
          </div>
          <div className="prompt-value">
            {promptType === 'letter' ? currentLetter : currentOffset}
          </div>

          {/* Interactive Native Input Box that opens numeric pad or letter keyboard on mobile */}
          <div
            className="user-answer-box-wrapper"
            onClick={() => answerInputRef.current?.focus()}
          >
            <input
              ref={answerInputRef}
              type="text"
              inputMode={promptType === 'letter' ? 'numeric' : 'text'}
              pattern={promptType === 'letter' ? '[0-9]*' : undefined}
              autoCapitalize={promptType === 'number' ? 'characters' : 'off'}
              autoCorrect="off"
              autoComplete="off"
              spellCheck="false"
              enterKeyHint="done"
              className="user-answer-native-input"
              value={inputVal}
              placeholder="?"
              onChange={e => {
                const val = e.target.value.toUpperCase();
                if (promptType === 'letter') {
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

      {/* Clean submit action using native keyboard */}
      <div className="offset-submit-row">
        <button
          type="button"
          className="btn-submit offset-confirm-btn"
          onClick={confirmAnswer}
          disabled={!inputVal}
        >
          Submit Answer ⏎
        </button>
      </div>

      <div className="stats-footer">
        Accuracy: {totalQuestions > 0 ? Math.round((correctQuestions / totalQuestions) * 100) : 100}% ({correctQuestions}/{totalQuestions})
      </div>
    </div>
  );
};
