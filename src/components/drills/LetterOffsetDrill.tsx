import React, { useState, useEffect, useCallback } from 'react';
import { offsetToLetter, ALPHABET } from '../../utils/ciphers';

interface LetterOffsetDrillProps {
  onBack: () => void;
}

type DrillMode = 'letterToNum' | 'numToLetter' | 'mixed';

interface FloatingGhost {
  id: string;
  text: string;
}

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
      }, 1200);
    }
  }, [bestStreak, currentLetter, currentOffset, inputVal, nextQuestion, promptType, streak]);

  // Remove ghost when animation finishes
  const handleRemoveGhost = (id: string) => {
    setGhosts(prev => prev.filter(g => g.id !== id));
  };

  const handleDigit = useCallback((digit: string) => {
    if (promptType !== 'letter') return;
    setInputVal(prev => (prev.length < 2 ? prev + digit : digit));
  }, [promptType]);

  const handleLetter = useCallback((char: string) => {
    if (promptType !== 'number') return;
    setInputVal(char);
  }, [promptType]);

  const handleBackspace = useCallback(() => {
    setInputVal(prev => prev.slice(0, -1));
  }, []);

  // Physical Keyboard listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if an input in modal has focus
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        confirmAnswer();
      } else if (promptType === 'letter') {
        if (e.key >= '0' && e.key <= '9') {
          e.preventDefault();
          handleDigit(e.key);
        }
      } else if (promptType === 'number') {
        if (/^[a-zA-Z]$/.test(e.key)) {
          e.preventDefault();
          handleLetter(e.key.toUpperCase());
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmAnswer, handleBackspace, handleDigit, handleLetter, promptType]);

  return (
    <div className="drill-container card-panel">
      <div className="drill-header">
        <button className="btn-simple" onClick={onBack}>
          ← Back to Menu
        </button>
        <div className="drill-title">
          <h2>Letter Offsets Training</h2>
        </div>
        <div className="streak-badge">
          🔥 Streak: <strong>{streak}</strong> <small>(Best: {bestStreak})</small>
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
          Letter → Number
        </button>
        <button
          className={`mode-btn ${mode === 'numToLetter' ? 'active' : ''}`}
          onClick={(e) => {
            (e.currentTarget as HTMLButtonElement).blur();
            handleModeChange('numToLetter');
          }}
        >
          Number → Letter
        </button>
        <button
          className={`mode-btn ${mode === 'mixed' ? 'active' : ''}`}
          onClick={(e) => {
            (e.currentTarget as HTMLButtonElement).blur();
            handleModeChange('mixed');
          }}
        >
          Mixed Sprint
        </button>
      </div>

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
          <div className="user-answer-box">
            {inputVal || <span className="placeholder">?</span>}
          </div>
          {wrongFeedback && (
            <div className="answer-hint">
              Answer was: <strong>{wrongFeedback}</strong>
            </div>
          )}
        </div>
      </div>

      {/* On-screen Keypad */}
      <div className="input-keypad-wrapper">
        {promptType === 'letter' ? (
          <div className="number-keypad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
              <button
                key={n}
                type="button"
                className="key-btn"
                onClick={(e) => {
                  (e.currentTarget as HTMLButtonElement).blur();
                  handleDigit(n.toString());
                }}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              className="key-btn special-btn"
              onClick={(e) => {
                (e.currentTarget as HTMLButtonElement).blur();
                handleBackspace();
              }}
              title="Backspace"
            >
              ⌫
            </button>
            <button
              type="button"
              className="key-btn"
              onClick={(e) => {
                (e.currentTarget as HTMLButtonElement).blur();
                handleDigit('0');
              }}
            >
              0
            </button>
            <button
              type="button"
              className="key-btn submit-btn"
              onClick={(e) => {
                (e.currentTarget as HTMLButtonElement).blur();
                confirmAnswer();
              }}
              title="Confirm Answer (Enter)"
            >
              ⏎
            </button>
          </div>
        ) : (
          <div className="letter-keypad-with-actions">
            <div className="letter-keypad">
              {ALPHABET.split('').map(char => (
                <button
                  key={char}
                  type="button"
                  className={`key-btn ${inputVal === char ? 'selected-key' : ''}`}
                  onClick={(e) => {
                    (e.currentTarget as HTMLButtonElement).blur();
                    handleLetter(char);
                  }}
                >
                  {char}
                </button>
              ))}
            </div>
            <div className="keypad-confirm-row">
              <button
                type="button"
                className="key-btn special-btn"
                onClick={(e) => {
                  (e.currentTarget as HTMLButtonElement).blur();
                  handleBackspace();
                }}
                title="Backspace"
              >
                ⌫ Clear
              </button>
              <button
                type="button"
                className="key-btn submit-btn"
                onClick={(e) => {
                  (e.currentTarget as HTMLButtonElement).blur();
                  confirmAnswer();
                }}
                disabled={!inputVal}
                title="Confirm Answer (Enter)"
              >
                Confirm ⏎
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="stats-footer">
        Accuracy: {totalQuestions > 0 ? Math.round((correctQuestions / totalQuestions) * 100) : 100}% ({correctQuestions}/{totalQuestions})
      </div>
    </div>
  );
};
