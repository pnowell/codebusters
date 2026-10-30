import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type {
  TestPacket,
  TestAttempt,
  QuestionWorkspace,
  TestEvaluationResult,
  QuestionResult,
} from '../../types';
import { getQuoteById } from '../../data/quotes';
import { evaluateSolution, isLetter } from '../../utils/ciphers';
import {
  saveLocalTestAttempt,
  saveTestAttemptToFirestore,
} from '../../services/testService';
import { TestCipherWorkspace } from './TestCipherWorkspace';
import { TestReviewScreen } from './TestReviewScreen';
import { TestResultsView } from './TestResultsView';

interface TestRunnerProps {
  testPacket: TestPacket;
  studentUids: string[];
  initialAttempt?: TestAttempt | null;
  onExitToMenu: () => void;
}

export const TestRunner: React.FC<TestRunnerProps> = ({
  testPacket,
  studentUids,
  initialAttempt,
  onExitToMenu,
}) => {
  // Resolve array of student UIDs
  const resolvedStudentUids = useMemo(() => {
    const list = new Set<string>();
    if (studentUids) {
      studentUids.forEach((id) => {
        if (id && id !== 'student') list.add(id);
      });
    }
    if (initialAttempt?.studentUids) {
      initialAttempt.studentUids.forEach((id) => {
        if (id && id !== 'student') list.add(id);
      });
    }
    if (list.size === 0) {
      return ['student'];
    }
    return Array.from(list);
  }, [studentUids, initialAttempt]);

  // Total questions count (review screen is index === questions.length)
  const totalQuestions = testPacket.questions.length;
  const reviewIndex = totalQuestions;

  // Initialize or restore attempt
  const [attemptId] = useState<string>(() => {
    if (initialAttempt?.attemptId) return initialAttempt.attemptId;
    const primaryUid = resolvedStudentUids[0] || 'student';
    return `${testPacket.testId}_${primaryUid}_${Date.now()}`;
  });

  const [startedAt] = useState<number>(() => {
    if (initialAttempt?.startedAt) return initialAttempt.startedAt;
    return Date.now();
  });

  const [activeQIndex, setActiveQIndex] = useState<number>(0);

  // Initialize workspaces for all questions
  const [workspaces, setWorkspaces] = useState<Record<number, QuestionWorkspace>>(() => {
    if (initialAttempt?.workspaces) {
      return initialAttempt.workspaces;
    }
    const initial: Record<number, QuestionWorkspace> = {};
    testPacket.questions.forEach((q, idx) => {
      const quote = getQuoteById(q.quoteId);
      const chars = quote ? quote.quote.toUpperCase().split('') : [];
      initial[idx] = {
        userInputs: chars.map(c => (isLetter(c) ? '' : c)),
        completed: false,
        lastEditedAt: Date.now(),
      };
    });
    return initial;
  });

  // Timer calculation
  const endTime = useMemo(
    () => startedAt + testPacket.timeLimitSeconds * 1000,
    [startedAt, testPacket.timeLimitSeconds]
  );

  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    Math.max(0, Math.round((endTime - Date.now()) / 1000))
  );

  const [isFinished, setIsFinished] = useState<boolean>(() => {
    return initialAttempt?.status === 'submitted' || initialAttempt?.status === 'expired';
  });

  const [results, setResults] = useState<TestEvaluationResult | null>(() => {
    return initialAttempt?.results ?? null;
  });

  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);

  const incompleteCount = useMemo(() => {
    let count = 0;
    testPacket.questions.forEach((q, idx) => {
      const quote = getQuoteById(q.quoteId);
      const targetAlpha = quote ? quote.quote.toUpperCase().split('').filter(isLetter).length : 0;
      const ws = workspaces[idx];
      const filled = ws
        ? ws.userInputs.filter((c, cIdx) => {
            if (!quote) return false;
            const orig = quote.quote.toUpperCase()[cIdx];
            return isLetter(orig) && c !== '';
          }).length
        : 0;
      if (targetAlpha === 0 || filled < targetAlpha) {
        count++;
      }
    });
    return count;
  }, [testPacket.questions, workspaces]);

  // Track latest attempt state via ref for timer callback / auto-submit
  const attemptRef = useRef<TestAttempt>({
    attemptId,
    testId: testPacket.testId,
    studentUids: resolvedStudentUids,
    startedAt,
    status: isFinished ? (initialAttempt?.status ?? 'submitted') : 'in_progress',
    workspaces,
    results: results ?? undefined,
  });

  useEffect(() => {
    attemptRef.current = {
      attemptId,
      testId: testPacket.testId,
      studentUids: resolvedStudentUids,
      startedAt,
      status: isFinished
        ? (attemptRef.current.status === 'expired' ? 'expired' : 'submitted')
        : 'in_progress',
      workspaces,
      results: results ?? undefined,
    };
  }, [attemptId, testPacket.testId, resolvedStudentUids, startedAt, isFinished, workspaces, results]);

  const firestoreDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. Immediately persist initial attempt on mount if in progress
  useEffect(() => {
    if (!isFinished) {
      saveLocalTestAttempt(attemptRef.current);
      saveTestAttemptToFirestore(attemptRef.current);
    }
  }, [isFinished]);

  // Evaluate all solutions and finalize attempt
  const submitTest = useCallback((isTimerExpired = false) => {
    if (isFinished) return;

    const currentWorkspaces = attemptRef.current.workspaces;
    const questionResults: QuestionResult[] = testPacket.questions.map((q, idx) => {
      const quote = getQuoteById(q.quoteId);
      const targetPlaintext = quote ? quote.quote : '';
      const ws = currentWorkspaces[idx];
      const studentInput = ws ? ws.userInputs.join('') : '';

      const evalRes = evaluateSolution(targetPlaintext, studentInput);
      let pointsEarned = 0;
      if (evalRes.scoreTier === 'full') {
        pointsEarned = q.points;
      } else if (evalRes.scoreTier === 'half') {
        pointsEarned = Math.round(q.points / 2);
      }

      return {
        questionNumber: q.questionNumber,
        cipher: q.cipher,
        quoteId: q.quoteId,
        pointsEarned,
        maxPoints: q.points,
        errorCount: evalRes.errorCount,
        scoreTier: evalRes.scoreTier,
        isTiebreaker: !!q.isTiebreaker,
        targetPlaintext,
        studentInput,
      };
    });

    const totalScore = questionResults.reduce((sum, q) => sum + q.pointsEarned, 0);
    const maxPossibleScore = questionResults.reduce((sum, q) => sum + q.maxPoints, 0);
    const timeSpentSeconds = Math.min(
      testPacket.timeLimitSeconds,
      Math.max(0, Math.round((Date.now() - startedAt) / 1000))
    );

    const evaluated: TestEvaluationResult = {
      totalScore,
      maxPossibleScore,
      timeSpentSeconds,
      questions: questionResults,
    };

    const finalAttempt: TestAttempt = {
      attemptId,
      testId: testPacket.testId,
      studentUids: resolvedStudentUids,
      startedAt,
      submittedAt: Date.now(),
      status: isTimerExpired ? 'expired' : 'submitted',
      workspaces: currentWorkspaces,
      results: evaluated,
    };

    if (firestoreDebounceRef.current) {
      clearTimeout(firestoreDebounceRef.current);
      firestoreDebounceRef.current = null;
    }

    attemptRef.current = finalAttempt;
    setResults(evaluated);
    setIsFinished(true);

    // Save final state
    saveLocalTestAttempt(finalAttempt);
    saveTestAttemptToFirestore(finalAttempt);
  }, [attemptId, isFinished, resolvedStudentUids, startedAt, testPacket]);

  // Wall-clock Countdown Timer
  useEffect(() => {
    if (isFinished) return;

    const timer = setInterval(() => {
      const left = Math.max(0, Math.round((endTime - Date.now()) / 1000));
      setRemainingSeconds(left);

      if (left <= 0) {
        clearInterval(timer);
        submitTest(true);
      }
    }, 250);

    return () => clearInterval(timer);
  }, [endTime, isFinished, submitTest]);

  // Periodic Firestore sync every 30 seconds & flush on unmount
  useEffect(() => {
    if (isFinished) return;
    const interval = setInterval(() => {
      if (attemptRef.current.status === 'in_progress') {
        saveTestAttemptToFirestore(attemptRef.current);
      }
    }, 30000);

    return () => {
      clearInterval(interval);
      if (firestoreDebounceRef.current) {
        clearTimeout(firestoreDebounceRef.current);
        firestoreDebounceRef.current = null;
      }
      if (attemptRef.current.status === 'in_progress') {
        saveLocalTestAttempt(attemptRef.current);
        saveTestAttemptToFirestore(attemptRef.current);
      }
    };
  }, [isFinished]);

  // User input handler for currently active question
  const handleUserInputsChange = (newInputs: string[]) => {
    if (isFinished) return;
    const quote = getQuoteById(testPacket.questions[activeQIndex]?.quoteId);
    const chars = quote ? quote.quote.toUpperCase().split('') : [];
    const totalAlpha = chars.filter(isLetter).length;
    const filledAlpha = newInputs.filter((c, idx) => isLetter(chars[idx]) && c !== '').length;

    const updated = {
      ...workspaces,
      [activeQIndex]: {
        userInputs: newInputs,
        completed: totalAlpha > 0 && filledAlpha === totalAlpha,
        lastEditedAt: Date.now(),
      },
    };

    setWorkspaces(updated);

    // Persist immediately to localStorage
    const currentAttempt: TestAttempt = {
      attemptId,
      testId: testPacket.testId,
      studentUids: resolvedStudentUids,
      startedAt,
      status: 'in_progress',
      workspaces: updated,
    };
    attemptRef.current = currentAttempt;
    saveLocalTestAttempt(currentAttempt);

    // Debounce syncing keystroke changes to Firestore
    if (firestoreDebounceRef.current) {
      clearTimeout(firestoreDebounceRef.current);
    }
    firestoreDebounceRef.current = setTimeout(() => {
      saveTestAttemptToFirestore(attemptRef.current);
    }, 2000);
  };

  const currentQuestion = testPacket.questions[activeQIndex];
  const currentQuote = currentQuestion ? getQuoteById(currentQuestion.quoteId) : undefined;
  const currentWorkspace = workspaces[activeQIndex];

  // Navigation actions
  const handlePrev = () => {
    if (activeQIndex > 0) {
      setActiveQIndex(prev => prev - 1);
    }
  };

  const handleNext = () => {
    if (activeQIndex < reviewIndex) {
      setActiveQIndex(prev => prev + 1);
    }
  };

  const handleCloseResults = () => {
    onExitToMenu();
  };

  const handleExit = () => {
    if (!isFinished) {
      if (firestoreDebounceRef.current) {
        clearTimeout(firestoreDebounceRef.current);
        firestoreDebounceRef.current = null;
      }
      saveLocalTestAttempt(attemptRef.current);
      saveTestAttemptToFirestore(attemptRef.current);
    }
    onExitToMenu();
  };

  // Timer styling
  const isTimeCritical = remainingSeconds <= 60;
  const isTimeWarning = remainingSeconds <= 300 && !isTimeCritical;

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (isFinished && results) {
    return (
      <TestResultsView
        testPacket={testPacket}
        results={results}
        onBack={handleCloseResults}
      />
    );
  }

  return (
    <div className="test-runner-container">
      {/* 1. Header Navigation Bar */}
      <header className="test-runner-header">
        <div className="test-header-left">
          <button
            className="btn-simple btn-test-exit"
            onClick={handleExit}
            title="Pause and Exit to Practice Tests"
          >
            ← Tests
          </button>
          <button
            className="btn-simple btn-nav-step"
            onClick={handlePrev}
            disabled={activeQIndex === 0}
            title="Previous Problem"
          >
            ← Prev
          </button>
        </div>

        <div className="test-header-center">
          <div className="test-header-meta">
            {activeQIndex < totalQuestions ? (
              <>
                <span className="test-q-counter">
                  Problem {activeQIndex + 1} of {totalQuestions}
                </span>
                <span className="test-q-pts">[{currentQuestion?.points} pts]</span>
                {currentQuestion?.isTiebreaker && (
                  <span className="test-tb-badge">★ TIEBREAKER</span>
                )}
              </>
            ) : (
              <span className="test-q-counter">Review & Submit</span>
            )}
          </div>

          <div
            className={`test-countdown-clock ${isTimeCritical ? 'clock-critical' : ''} ${
              isTimeWarning ? 'clock-warning' : ''
            }`}
          >
            ⏱️ {formatTimer(remainingSeconds)}
          </div>
        </div>

        <div className="test-header-right">
          {activeQIndex < totalQuestions - 1 ? (
            <button className="btn-simple btn-nav-step" onClick={handleNext} title="Next Problem">
              Next →
            </button>
          ) : activeQIndex === totalQuestions - 1 ? (
            <button className="btn-simple btn-nav-step btn-review-cta" onClick={handleNext}>
              Review 📋
            </button>
          ) : (
            <button
              className="btn-simple btn-nav-step btn-submit-cta"
              onClick={() => setShowSubmitModal(true)}
            >
              Submit ✓
            </button>
          )}
        </div>
      </header>

      {/* 2. Question Navigator Strip */}
      <nav className="test-navigator-strip" aria-label="Question Navigation">
        {testPacket.questions.map((q, idx) => {
          const ws = workspaces[idx];
          const quote = getQuoteById(q.quoteId);
          const chars = quote ? quote.quote.toUpperCase().split('') : [];
          const totalAlpha = chars.filter(isLetter).length;
          const filled = ws
            ? ws.userInputs.filter((c, cIdx) => isLetter(chars[cIdx]) && c !== '').length
            : 0;

          const isComplete = totalAlpha > 0 && filled === totalAlpha;
          const isInProgress = filled > 0 && !isComplete;
          const isActive = activeQIndex === idx;

          return (
            <button
              key={q.questionNumber}
              className={`test-nav-tab ${isActive ? 'tab-active' : ''} ${
                isComplete ? 'tab-complete' : isInProgress ? 'tab-progress' : 'tab-untouched'
              }`}
              onClick={() => setActiveQIndex(idx)}
              title={`Question ${q.questionNumber}: ${q.cipher}`}
            >
              <span className="tab-q-label">Q{q.questionNumber}</span>
              {isComplete && <span className="tab-status-icon">✓</span>}
              {isInProgress && <span className="tab-status-icon">✎</span>}
            </button>
          );
        })}

        <button
          className={`test-nav-tab tab-review ${activeQIndex === reviewIndex ? 'tab-active' : ''}`}
          onClick={() => setActiveQIndex(reviewIndex)}
          title="Review and Submit Test"
        >
          <span className="tab-q-label">Review 📋</span>
        </button>
      </nav>

      {/* 3. Main Workspace Area */}
      <main className="test-runner-body">
        {activeQIndex < totalQuestions && currentQuestion && currentQuote && currentWorkspace && (
          <TestCipherWorkspace
            key={currentQuestion.questionNumber}
            question={currentQuestion}
            quote={currentQuote}
            userInputs={currentWorkspace.userInputs}
            onChangeUserInputs={handleUserInputsChange}
            disabled={isFinished}
          />
        )}

        {activeQIndex === reviewIndex && (
          <TestReviewScreen
            testPacket={testPacket}
            workspaces={workspaces}
            onJumpToQuestion={idx => setActiveQIndex(idx)}
            onSubmitTest={() => setShowSubmitModal(true)}
          />
        )}
      </main>

      {/* 4. Submit Confirmation Modal */}
      {showSubmitModal && (
        <div className="modal-backdrop confirm-modal-backdrop" onClick={() => setShowSubmitModal(false)}>
          <div className="modal-card confirm-modal" onClick={e => e.stopPropagation()}>
            <h3 className="confirm-modal-title">Submit Practice Test?</h3>
            {incompleteCount > 0 ? (
              <>
                <p className="confirm-modal-text">
                  You have <strong>{formatTimer(remainingSeconds)}</strong> remaining on the clock and{' '}
                  <strong>{incompleteCount} problem{incompleteCount > 1 ? 's' : ''}</strong> incomplete or not started.
                </p>
                <div className="confirm-modal-warning">
                  ⚠️ Unanswered letters are counted as errors under Science Olympiad rules.
                </div>
              </>
            ) : (
              <p className="confirm-modal-text">
                You have completed all <strong>{totalQuestions} problems</strong> with{' '}
                <strong>{formatTimer(remainingSeconds)}</strong> remaining on the clock!
              </p>
            )}
            <p className="confirm-modal-text-sub">
              Are you sure you want to finish now and score your test?
            </p>
            <div className="confirm-modal-buttons">
              <button
                className="btn-simple"
                onClick={() => setShowSubmitModal(false)}
              >
                Keep Solving ➔
              </button>
              <button
                className="btn-main-action btn-submit-confirm"
                onClick={() => {
                  setShowSubmitModal(false);
                  submitTest(false);
                }}
              >
                Submit Score Now ✓
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
