import React, { useEffect, useMemo, useState } from 'react';
import type { TestPacket } from '../../types';
import {
  fetchStudentQuoteCompletions,
  getCachedStudentQuoteCompletions,
} from '../../services/quoteCompletionService';
import { QuoteBrowserPanel } from './QuoteBrowserPanel';

interface QuoteBrowserViewProps {
  tests: TestPacket[];
  onBack: () => void;
}

export const QuoteBrowserView: React.FC<QuoteBrowserViewProps> = ({
  tests,
  onBack,
}) => {
  const [finishedByQuotesMap, setFinishedByQuotesMap] = useState<
    ReadonlyMap<number, string[]>
  >(() => getCachedStudentQuoteCompletions());
  const [usersReadBlocked, setUsersReadBlocked] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    void fetchStudentQuoteCompletions(tests).then((snapshot) => {
      if (cancelled) return;
      setFinishedByQuotesMap(snapshot.finishedByQuotesMap);
      setUsersReadBlocked(snapshot.usersReadBlocked);
    });
    return () => {
      cancelled = true;
    };
  }, [tests]);

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
        finishedByQuotesMap={finishedByQuotesMap}
        usersReadBlocked={usersReadBlocked}
      />
    </div>
  );
};
