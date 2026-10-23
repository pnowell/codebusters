import React, { useState, useEffect, useCallback } from 'react';
import { offsetToLetter, ALPHABET } from '../../utils/ciphers';

interface LetterOffsetDrillProps {
  onBack: () => void;
}

type DrillMode = 'letterToNum' | 'numToLetter' | 'mixed';

export const LetterOffsetDrill: React.FC<LetterOffsetDrillProps> = ({ onBack }) => {
  const [mode, setMode] = useState<DrillMode>('letterToNum');
  const [currentLetter, setCurrentLetter] = useState<string>('A');
  const [currentOffset, setCurrentOffset] = useState<number>(0);
  const [promptType, setPromptType] = useState<'letter' | 'number'>('letter');

  const [inputVal, setInputVal] = useState<string>('');
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [streak, setStreak] = useState<number>(0);
  const [bestStreak, setBestStreak] = useState<number>(() => {
    return parseInt(localStorage.getItem('davinci_offsets_best_streak') || '0', 10);
  });
  const [totalQuestions, setTotalQuestions] = useState<number>(0);
  const [correctQuestions, setCorrectQuestions] = useState<number>(0);

  // Pick next question
  const nextQuestion = useCallback((overrideMode?: DrillMode) => {
    const activeMode = overrideMode || mode;
    const randOffset = Math.floor(Math.random() * 26);
    const randLetter = offsetToLetter(randOffset);

    setCurrentOffset(randOffset);
    setCurrentLetter(randLetter);
    setInputVal('');
    setFeedback(null);

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

  const checkAnswer = (answer: string) => {
    const trimmed = answer.trim().toUpperCase();
    setTotalQuestions(prev => prev + 1);

    const isCorrect =
      promptType === 'letter'
        ? parseInt(trimmed, 10) === currentOffset
        : trimmed === currentLetter;

    if (isCorrect) {
      setFeedback('correct');
      setCorrectQuestions(prev => prev + 1);
      const newStreak = streak + 1;
      setStreak(newStreak);
      if (newStreak > bestStreak) {
        setBestStreak(newStreak);
        localStorage.setItem('davinci_offsets_best_streak', newStreak.toString());
      }
      setTimeout(() => {
        nextQuestion();
      }, 350);
    } else {
      setFeedback('wrong');
      setStreak(0);
      setTimeout(() => {
        setFeedback(null);
        setInputVal('');
      }, 1000);
    }
  };

  // Keyboard navigation
  const handleDigit = (digit: string) => {
    if (promptType !== 'letter') return;
    const nextVal = inputVal + digit;
    setInputVal(nextVal);
    // If length is 2 or if digit > 2 (since max is 25), auto check
    if (nextVal.length === 2 || (nextVal.length === 1 && parseInt(nextVal, 10) >= 3)) {
      checkAnswer(nextVal);
    }
  };

  const handleLetter = (char: string) => {
    if (promptType !== 'number') return;
    setInputVal(char);
    checkAnswer(char);
  };

  const handleBackspace = () => {
    setInputVal(prev => prev.slice(0, -1));
  };

  return (
    <div className="drill-container card-panel">
      <div className="drill-header">
        <button className="btn-secondary" onClick={onBack}>
          ← Back to Menu
        </button>
        <div className="drill-title">
          <h2>Letter Offsets Training</h2>
          <span className="badge">A=0 … Z=25</span>
        </div>
        <div className="streak-badge">
          🔥 Streak: <strong>{streak}</strong> <small>(Best: {bestStreak})</small>
        </div>
      </div>

      <div className="mode-selector">
        <button
          className={`mode-btn ${mode === 'letterToNum' ? 'active' : ''}`}
          onClick={() => handleModeChange('letterToNum')}
        >
          Letter → Number
        </button>
        <button
          className={`mode-btn ${mode === 'numToLetter' ? 'active' : ''}`}
          onClick={() => handleModeChange('numToLetter')}
        >
          Number → Letter
        </button>
        <button
          className={`mode-btn ${mode === 'mixed' ? 'active' : ''}`}
          onClick={() => handleModeChange('mixed')}
        >
          Mixed Sprint
        </button>
      </div>

      <div className={`offset-card ${feedback ? `feedback-${feedback}` : ''}`}>
        <div className="prompt-label">
          {promptType === 'letter' ? 'What is the number offset for:' : 'Which letter has offset:'}
        </div>
        <div className="prompt-value">
          {promptType === 'letter' ? currentLetter : currentOffset}
        </div>
        <div className="user-answer-box">
          {inputVal || <span className="placeholder">?</span>}
        </div>
        {feedback === 'wrong' && (
          <div className="answer-hint">
            Answer was: <strong>{promptType === 'letter' ? currentOffset : currentLetter}</strong>
          </div>
        )}
      </div>

      {/* On-screen Keypad depending on prompt type */}
      <div className="input-keypad-wrapper">
        {promptType === 'letter' ? (
          <div className="number-keypad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(n => (
              <button
                key={n}
                type="button"
                className="key-btn"
                onClick={() => handleDigit(n.toString())}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              className="key-btn special-btn"
              onClick={handleBackspace}
            >
              ⌫
            </button>
          </div>
        ) : (
          <div className="letter-keypad">
            {ALPHABET.split('').map(char => (
              <button
                key={char}
                type="button"
                className="key-btn"
                onClick={() => handleLetter(char)}
              >
                {char}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="stats-footer">
        Accuracy: {totalQuestions > 0 ? Math.round((correctQuestions / totalQuestions) * 100) : 100}% ({correctQuestions}/{totalQuestions})
      </div>
    </div>
  );
};
