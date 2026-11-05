import React, { useMemo } from 'react';
import type { TestPacket } from '../../types';
import { QuoteBrowserPanel } from './QuoteBrowserPanel';

interface QuoteBrowserViewProps {
  tests: TestPacket[];
  onBack: () => void;
}

export const QuoteBrowserView: React.FC<QuoteBrowserViewProps> = ({
  tests,
  onBack,
}) => {
  const usedInTestsByQuoteId = useMemo(() => {
    const map = new Map<number, string[]>();
    tests.forEach((test) => {
      test.questions.forEach((q) => {
        const list = map.get(q.quoteId);
        if (list) {
          if (!list.includes(test.title)) list.push(test.title);
        } else {
          map.set(q.quoteId, [test.title]);
        }
      });
    });
    return map;
  }, [tests]);

  return (
    <div className="quote-browser-view">
      <header className="editor-top-header">
        <button
          type="button"
          className="btn-simple btn-tests-back"
          onClick={onBack}
          title="Return to Practice Tests"
        >
          ← Practice Tests
        </button>

        <div className="editor-header-title-group">
          <h2 className="editor-header-title">📚 Quote Database Browser</h2>
          <span className="editor-header-subtitle">
            Inspect, filter, and flag quotes across the database
          </span>
        </div>
      </header>

      <QuoteBrowserPanel
        mode="standalone"
        usedInTestsByQuoteId={usedInTestsByQuoteId}
      />
    </div>
  );
};
