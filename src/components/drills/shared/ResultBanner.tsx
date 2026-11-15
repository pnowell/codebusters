import React from 'react';
import type { EvaluationResult } from '../../../types';

interface Props {
  result: EvaluationResult;
  solveTimeText?: string;
  paceText?: string;
}

export const ResultBanner: React.FC<Props> = ({
  result,
  solveTimeText,
  paceText,
}) => (
  <div className={`result-banner score-${result.scoreTier}`}>
    <div className="result-banner-msg">
      {result.scoreTier === 'full' && (
        <>
          🎉 <strong>Full Credit!</strong> Decoded with {result.errorCount} error
          {result.errorCount === 1 ? '' : 's'} (allowed: ≤ 2 errors).
        </>
      )}
      {result.scoreTier === 'half' && (
        <>
          ⚖️ <strong>Half Credit!</strong> Decoded with {result.errorCount}{' '}
          errors (3–4 errors allowed).
        </>
      )}
      {result.scoreTier === 'none' && (
        <>
          ❌ <strong>{result.errorCount} Errors!</strong> Keep practicing with
          the reference table.
        </>
      )}
    </div>
    {(solveTimeText || paceText) && (
      <div className="result-banner-metrics" aria-label="Solve time and speed">
        {solveTimeText && (
          <span className="result-metric-time">
            ⏱️ <strong>{solveTimeText}</strong>
          </span>
        )}
        {solveTimeText && paceText && (
          <span className="result-metric-sep" aria-hidden="true">
            ·
          </span>
        )}
        {paceText && <span className="result-metric-pace">{paceText}</span>}
      </div>
    )}
  </div>
);

