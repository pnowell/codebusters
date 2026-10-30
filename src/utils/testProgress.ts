import type { Quote, QuestionWorkspace, TestQuestion } from '../types';
import { getQuoteById } from '../data/quotes';
import { isLetter } from './ciphers';

export interface QuestionProgress {
  quote: Quote | undefined;
  filledCount: number;
  targetAlphaCount: number;
  isComplete: boolean;
  status: 'complete' | 'in_progress' | 'untouched';
}

/**
 * Computes letter completion counts and status ('complete' | 'in_progress' | 'untouched')
 * for a practice test question against a student workspace or raw input array.
 */
export function getQuestionProgress(
  question: TestQuestion | undefined,
  workspaceOrInputs?: QuestionWorkspace | string[]
): QuestionProgress {
  const quote = question ? getQuoteById(question.quoteId) : undefined;
  const chars = quote ? quote.quote.toUpperCase().split('') : [];
  const targetAlphaCount = chars.filter(isLetter).length;
  const inputs = Array.isArray(workspaceOrInputs)
    ? workspaceOrInputs
    : workspaceOrInputs?.userInputs;

  const filledCount = inputs
    ? inputs.filter((c, idx) => isLetter(chars[idx] ?? '') && c !== '').length
    : 0;

  const isComplete = targetAlphaCount > 0 && filledCount === targetAlphaCount;
  const status: QuestionProgress['status'] = isComplete
    ? 'complete'
    : filledCount > 0
      ? 'in_progress'
      : 'untouched';

  return {
    quote,
    filledCount,
    targetAlphaCount,
    isComplete,
    status,
  };
}
