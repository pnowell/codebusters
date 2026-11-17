import React, { useEffect, useMemo, useState } from 'react';
import type { TestPacket, TestEvaluationResult, QuestionResult } from '../../types';
import { getDrill } from '../../data/drills';
import { getQuoteById } from '../../data/quotes';
import { groupIntoWords, isLetter } from '../../utils/ciphers';
import { formatDuration } from '../../utils/format';
import {
  getDisplayNameForUid,
  getDisplayNamesForUids,
} from '../../services/profileService';
import { resolveTeamNameForMembers } from '../../utils/testSync';
import {
  fetchAttemptBreakdown,
  type AnalyticsProfileInfo,
  type AttemptBreakdownResponse,
  type AttemptBreakdownRow,
} from '../../services/analyticsService';

interface TestResultsViewProps {
  testPacket: TestPacket;
  results: TestEvaluationResult;
  studentUids?: string[];
  attemptId?: string;
  isTeacher?: boolean;
  backLabel?: string;
  backTitle?: string;
  onBack: () => void;
}

interface QuestionDetailCardProps {
  questionResult: QuestionResult;
  isExpanded: boolean;
  onToggle: () => void;
  contributions?: AttemptBreakdownRow[];
  profiles?: Record<string, AnalyticsProfileInfo>;
}

function resolveContribName(
  uid: string,
  profiles?: Record<string, AnalyticsProfileInfo>
): string {
  const fromAnalytics = profiles?.[uid]?.displayName;
  if (fromAnalytics) return fromAnalytics;
  return getDisplayNameForUid(uid);
}

const QuestionDetailCard: React.FC<QuestionDetailCardProps> = ({
  questionResult,
  isExpanded,
  onToggle,
  contributions,
  profiles,
}) => {
  const quote = getQuoteById(questionResult.quoteId);
  const drill = getDrill(questionResult.cipher);
  const cipherTitle = drill ? drill.shortTitle : questionResult.cipher;

  const targetChars = questionResult.targetPlaintext.toUpperCase().split('');
  const studentChars = questionResult.studentInput.toUpperCase().split('');
  const words = groupIntoWords(targetChars);

  const getTierBadge = () => {
    switch (questionResult.scoreTier) {
      case 'full':
        return (
          <span className="results-tier-badge tier-full">
            Full Credit ({questionResult.errorCount} {questionResult.errorCount === 1 ? 'error' : 'errors'})
          </span>
        );
      case 'half':
        return (
          <span className="results-tier-badge tier-half">
            Half Credit ({questionResult.errorCount} errors)
          </span>
        );
      case 'none':
        return (
          <span className="results-tier-badge tier-none">
            No Credit ({questionResult.errorCount} errors)
          </span>
        );
    }
  };

  return (
    <div className={`results-question-card tier-${questionResult.scoreTier}`}>
      <div
        className="results-question-header"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="results-q-title-group">
          <span className="results-q-num">Q{questionResult.questionNumber}</span>
          <span className="results-q-cipher">{cipherTitle}</span>
          {questionResult.isTiebreaker && (
            <span className="results-tb-badge">★ TIEBREAKER</span>
          )}
        </div>

        <div className="results-q-score-group">
          <span className="results-q-points">
            <strong>{questionResult.pointsEarned}</strong> / {questionResult.maxPoints} pts
          </span>
          {getTierBadge()}
          <span className="results-accordion-arrow">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {isExpanded && (
        <div className="results-question-body">
          {quote?.author && (
            <div className="results-q-author">Quote by: {quote.author}</div>
          )}

          {contributions && contributions.length > 0 && (
            <div className="results-q-contributions">
              <span className="results-q-contrib-label">Contributions:</span>
              {contributions.map((c) => (
                <span key={c.uid} className="results-q-contrib-badge">
                  <strong>{resolveContribName(c.uid, profiles)}</strong>
                  <span className="results-q-contrib-stats">
                    {formatDuration(Math.round(c.activeScreenTimeSec))} ·{' '}
                    {c.correctGradableInputs}/{c.totalGradableUnits} inputs
                  </span>
                </span>
              ))}
            </div>
          )}

          <div className="results-diff-container">
            <div className="results-diff-canvas">
              {words.map((word, wIdx) => (
                <div key={wIdx} className="results-word-cluster">
                  {word.map(({ char, index }) => {
                    const isAlpha = isLetter(char);
                    const targetChar = char.toUpperCase();
                    const studentChar = (studentChars[index] || '').toUpperCase();

                    // Punctuation is rendered inline without a box border
                    if (!isAlpha) {
                      return (
                        <div key={index} className="results-punct-inline">
                          {char}
                        </div>
                      );
                    }

                    const isCorrect = studentChar === targetChar;
                    const hasWrongGuess = studentChar !== '' && !isCorrect;

                    return (
                      <div
                        key={index}
                        className={`results-char-tile ${isCorrect ? 'tile-correct' : 'tile-error'}`}
                        title={
                          isCorrect
                            ? `Correct: ${targetChar}`
                            : hasWrongGuess
                            ? `Guessed: ${studentChar}, Correct: ${targetChar}`
                            : `Unanswered, Correct: ${targetChar}`
                        }
                      >
                        {isCorrect ? (
                          <div className="results-correct-letter">{targetChar}</div>
                        ) : (
                          <>
                            {hasWrongGuess ? (
                              <span className="results-wrong-guess">{studentChar}</span>
                            ) : (
                              <span className="results-guess-spacer" />
                            )}
                            <div className="results-target-correction">{targetChar}</div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="results-diff-legend">
            <span className="legend-item legend-correct">■ Correct</span>
            <span className="legend-item legend-error">■ Error / Unanswered (correct letter shown)</span>
            <span className="legend-item legend-wrong-note"><del>A</del> = Your guess</span>
          </div>
        </div>
      )}
    </div>
  );
};

export const TestResultsView: React.FC<TestResultsViewProps> = ({
  testPacket,
  results,
  studentUids,
  attemptId,
  isTeacher = false,
  backLabel = '← Practice Tests',
  backTitle = 'Return to Practice Tests List',
  onBack,
}) => {
  const breakdownRequestKey = isTeacher && attemptId ? attemptId : '';
  const [breakdownState, setBreakdownState] = useState<{
    key: string;
    data: AttemptBreakdownResponse | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!breakdownRequestKey) return;

    const controller = new AbortController();

    fetchAttemptBreakdown(breakdownRequestKey, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          setBreakdownState({ key: breakdownRequestKey, data: res, error: null });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Unable to load teammate contributions.';
        setBreakdownState({ key: breakdownRequestKey, data: null, error: msg });
      });

    return () => controller.abort();
  }, [breakdownRequestKey]);

  const isBreakdownLoading = Boolean(
    breakdownRequestKey && breakdownState?.key !== breakdownRequestKey
  );
  const breakdown =
    breakdownRequestKey && breakdownState?.key === breakdownRequestKey
      ? breakdownState.data
      : null;
  const breakdownError =
    breakdownRequestKey && breakdownState?.key === breakdownRequestKey
      ? breakdownState.error
      : null;

  const { teammateTotals, questionBreakdownMap } = useMemo(() => {
    const byUid = new Map<
      string,
      {
        uid: string;
        activeScreenTimeSec: number;
        correctGradableInputs: number;
        totalGradableUnits: number;
      }
    >();
    const byQuestion = new Map<number, AttemptBreakdownRow[]>();

    for (const row of breakdown?.rows ?? []) {
      const prev = byUid.get(row.uid) ?? {
        uid: row.uid,
        activeScreenTimeSec: 0,
        correctGradableInputs: 0,
        totalGradableUnits: 0,
      };
      prev.activeScreenTimeSec += row.activeScreenTimeSec;
      prev.correctGradableInputs += row.correctGradableInputs;
      prev.totalGradableUnits += row.totalGradableUnits;
      byUid.set(row.uid, prev);

      const list = byQuestion.get(row.questionNumber) ?? [];
      list.push(row);
      byQuestion.set(row.questionNumber, list);
    }

    const totals = Array.from(byUid.values()).sort(
      (a, b) =>
        b.activeScreenTimeSec - a.activeScreenTimeSec ||
        b.correctGradableInputs - a.correctGradableInputs
    );

    return { teammateTotals: totals, questionBreakdownMap: byQuestion };
  }, [breakdown]);
  const liveTeamName = resolveTeamNameForMembers(testPacket, studentUids);
  const teamOrStudentNames =
    liveTeamName ||
    (studentUids && studentUids.length > 0 ? getDisplayNamesForUids(studentUids) : null);

  // Accordion state: by default, all problems start collapsed as requested
  const [expandedIndices, setExpandedIndices] = useState<Record<number, boolean>>({});

  const toggleQuestion = (index: number) => {
    setExpandedIndices((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const isAllExpanded = results.questions.every((_, idx) => Boolean(expandedIndices[idx]));

  const toggleAll = () => {
    if (isAllExpanded) {
      setExpandedIndices({});
    } else {
      const all: Record<number, boolean> = {};
      results.questions.forEach((_, idx) => {
        all[idx] = true;
      });
      setExpandedIndices(all);
    }
  };

  const percentage = Math.round(
    (results.totalScore / (results.maxPossibleScore || 1)) * 100
  );

  const fullCount = results.questions.filter((q) => q.scoreTier === 'full').length;
  const halfCount = results.questions.filter((q) => q.scoreTier === 'half').length;
  const noneCount = results.questions.filter((q) => q.scoreTier === 'none').length;

  return (
    <div className="test-results-view">
      {/* 1. Header with Back Button */}
      <header className="test-results-header">
        <button
          className="btn-simple btn-tests-back"
          onClick={onBack}
          title={backTitle}
        >
          {backLabel}
        </button>
        <div className="test-results-header-title">
          <h2>Test Results</h2>
        </div>
      </header>

      {/* 2. Main Summary Card */}
      <div className="results-summary-card">
        <div className="results-trophy-icon">🏆</div>
        <h3 className="results-summary-test-title">{testPacket.title}</h3>
        {teamOrStudentNames && (
          <div className="results-student-pill">
            <span>👤 Decoder: <strong>{teamOrStudentNames}</strong></span>
          </div>
        )}

        <div className="results-main-stats-grid">
          <div className="results-stat-box score-stat-box">
            <span className="stat-label">TOTAL SCORE</span>
            <span className="stat-value">
              {results.totalScore} <span className="stat-max">/ {results.maxPossibleScore}</span>
            </span>
            <span className="stat-percentage">{percentage}%</span>
          </div>

          <div className="results-stat-box time-stat-box">
            <span className="stat-label">TIME SPENT</span>
            <span className="stat-value">{formatDuration(results.timeSpentSeconds)}</span>
            <span className="stat-max">Limit: {formatDuration(testPacket.timeLimitSeconds)}</span>
          </div>

          <div className="results-stat-box breakdown-stat-box">
            <span className="stat-label">SCORING BREAKDOWN</span>
            <div className="stat-breakdown-row">
              <span className="breakdown-tag tag-full">Full: {fullCount}</span>
              <span className="breakdown-tag tag-half">Half: {halfCount}</span>
              <span className="breakdown-tag tag-none">0: {noneCount}</span>
            </div>
            <span className="stat-so-rules">SoCal Div A Rules: 0-2 errs = full, 3-4 = half, 5+ = 0</span>
          </div>
        </div>
      </div>

      {isTeacher && attemptId && (
        <section className="results-contributions-card">
          <div className="results-contrib-header">
            <h3 className="results-contrib-title">Teammate Contributions</h3>
            <span className="results-contrib-sub">
              Per-user active screen time &amp; correct inputs from BigQuery
            </span>
          </div>

          {isBreakdownLoading && (
            <div className="results-contrib-status">
              Loading teammate activity breakdown…
            </div>
          )}

          {!isBreakdownLoading && breakdownError && (
            <div className="results-contrib-status is-error">
              {breakdownError}
            </div>
          )}

          {!isBreakdownLoading &&
            !breakdownError &&
            teammateTotals.length === 0 && (
              <div className="results-contrib-status">
                No BigQuery activity rows found yet for this attempt.
              </div>
            )}

          {!isBreakdownLoading &&
            !breakdownError &&
            teammateTotals.length > 0 && (
              <div className="results-contrib-grid">
                {teammateTotals.map((member) => (
                  <div key={member.uid} className="results-contrib-chip">
                    <span className="results-contrib-name">
                      {resolveContribName(member.uid, breakdown?.profiles)}
                    </span>
                    <div className="results-contrib-metrics">
                      <span>{formatDuration(Math.round(member.activeScreenTimeSec))} active</span>
                      <span>
                        {member.correctGradableInputs}
                        {member.totalGradableUnits > 0
                          ? ` / ${member.totalGradableUnits}`
                          : ''}{' '}
                        correct inputs
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </section>
      )}

      {/* 3. Problem Breakdown Section */}
      <section className="results-questions-section">
        <div className="results-section-header-row">
          <h3 className="results-questions-heading">Problem Breakdown & Error Analysis</h3>
          <button className="btn-simple btn-toggle-all" onClick={toggleAll}>
            {isAllExpanded ? 'Collapse All ▲' : 'Expand All ▼'}
          </button>
        </div>

        <div className="results-questions-list">
          {results.questions.map((q, idx) => (
            <QuestionDetailCard
              key={q.questionNumber}
              questionResult={q}
              isExpanded={Boolean(expandedIndices[idx])}
              onToggle={() => toggleQuestion(idx)}
              contributions={questionBreakdownMap.get(q.questionNumber)}
              profiles={breakdown?.profiles}
            />
          ))}
        </div>
      </section>
    </div>
  );
};
