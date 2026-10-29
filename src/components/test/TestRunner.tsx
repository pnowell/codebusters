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
  clearLocalTestAttempt,
} from '../../services/testService';
import { TestCipherWorkspace } from './TestCipherWorkspace';
import { TestReviewScreen } from './TestReviewScreen';
import { TestResultsView } from './TestResultsView';

interface TestRunnerProps {
  testPacket: TestPacket;
  studentUid?: string;
  studentUids?: string[];
  studentName?: string;
  initialAttempt?: TestAttempt | null;
  onExitToMenu: () => void;
}

export const TestRunner: React.FC<TestRunnerProps> = ({
  testPacket,
  studentUid,
  studentUids,
  studentName: _studentName,
  initialAttempt,
  onExitToMenu,
}) => {
  // Resolve array of student UIDs
  const resolvedStudentUids = useMemo(() => {
    if (studentUids && studentUids.length > 0) return studentUids;
    if (initialAttempt?.studentUids && initialAttempt.studentUids.length > 0) return initialAttempt.studentUids;
    if (studentUid) return [studentUid];
    return ['student'];
  }, [studentUids, initialAttempt?.studentUids, studentUid]);

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
      status: isFinished ? (attemptRef.current.status || 'submitted') : 'in_progress',
      workspaces,
      results: results ?? undefined,
    };
  }, [attemptId, testPacket.testId, resolvedStudentUids, startedAt, isFinished, workspaces, results]);

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

  // Periodic Firestore sync every 30 seconds
  useEffect(() => {
    if (isFinished) return;
    const interval = setInterval(() => {
      saveTestAttemptToFirestore(attemptRef.current);
    }, 30000);

    return () => clearInterval(interval);
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
    saveLocalTestAttempt(currentAttempt);
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
    clearLocalTestAttempt(testPacket.testId);
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
              onClick={() => submitTest(false)}
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
            remainingSeconds={remainingSeconds}
            onJumpToQuestion={idx => setActiveQIndex(idx)}
            onSubmitTest={() => submitTest(false)}
          />
        )}
      </main>
    </div>
  );
};
