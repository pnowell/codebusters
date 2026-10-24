import React from 'react';
import type { EvaluationResult } from '../../types';

interface Props {
  result: EvaluationResult;
}

export const ResultBanner: React.FC<Props> = ({ result }) => (
  <div className={`result-banner score-${result.scoreTier}`}>
    {result.scoreTier === 'full' && (
      <>
        🎉 <strong>Full Credit!</strong> Decoded with {result.errorCount} error{result.errorCount === 1 ? '' : 's'} (allowed: ≤ 2 errors).
      </>
    )}
    {result.scoreTier === 'half' && (
      <>
        ⚖️ <strong>Half Credit!</strong> Decoded with {result.errorCount} errors (3–4 errors allowed).
      </>
    )}
    {result.scoreTier === 'none' && (
      <>
        ❌ <strong>{result.errorCount} Errors!</strong> Keep practicing with the reference table.
      </>
    )}
  </div>
);
