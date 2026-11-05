import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CryptanalysisTier,
  Quote,
  QuoteBrowserApostropheFilter,
  QuoteBrowserCategoryFilter,
  QuoteBrowserFlagFilter,
  QuoteBrowserMinWordFilter,
  QuoteBrowserMode,
  QuoteBrowserSortOption,
  QuoteBrowserTierFilter,
  QuoteCategory,
  QuoteFlag,
} from '../../types';
import { getAllQuotes, MAX_LOOKUP_LENGTH } from '../../data/quotes';
import {
  getQuoteFlagsMap,
  removeQuoteFlag,
  saveQuoteFlag,
  subscribeQuoteFlags,
} from '../../services/quoteFlagService';
import {
  getDefaultQuoteBrowserPrefs,
  loadQuoteBrowserModePrefs,
  saveQuoteBrowserModePrefs,
} from '../../services/storage';
import { subscribeToSyncUpdates } from '../../services/sync';

export type { QuoteBrowserMode };

export interface QuoteBrowserPanelProps {
  mode?: QuoteBrowserMode;
  selectedQuoteId?: number;
  usedInCurrentTestIds?: ReadonlySet<number>;
  usedInTestsByQuoteId?: ReadonlyMap<number, string[]>;
  finishedByQuotesMap?: ReadonlyMap<number, string[]>;
  usersReadBlocked?: boolean;
  onSelectQuote?: (quote: Quote) => void;
}

const ESTIMATED_ROW_HEIGHT = 118;
const ROW_GAP_PX = 10;
const OVERSCAN_COUNT = 8;

const CATEGORY_LABELS: Record<QuoteCategory, string> = {
  kid_joke: 'Joke',
  kid_science: 'Science',
  kid_book: 'Book',
  kid_movie: 'Movie',
  kid_lyric: 'Lyric',
  general: 'General',
};

const TIER_LABELS: Record<CryptanalysisTier, string> = {
  short_drill: 'Short',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

function deterministicHash(id: number, seed: number): number {
  let x = (id + 1) * 2654435761 + seed * 1597334677;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  return (x >>> 16) ^ x;
}

function findOffsetIndex(offsets: Float64Array, scrollTop: number): number {
  let low = 0;
  let high = Math.max(0, offsets.length - 2);
  while (low < high) {
    const mid = (low + high + 1) >>> 1;
    if (offsets[mid] <= scrollTop) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

export const QuoteBrowserPanel: React.FC<QuoteBrowserPanelProps> = ({
  mode = 'standalone',
  selectedQuoteId,
  usedInCurrentTestIds,
  usedInTestsByQuoteId,
  finishedByQuotesMap,
  usersReadBlocked = false,
  onSelectQuote,
}) => {
  const allQuotes = useMemo(() => getAllQuotes(), []);
  const defaultPickerMaxLen = String(MAX_LOOKUP_LENGTH);

  const validQuoteIds = useMemo(
    () => new Set(allQuotes.map((q) => q.id)),
    [allQuotes]
  );

  // Live Firestore quote flags map (filtered to quotes present in quotes.json so
  // pre-deploy orphaned flags never produce phantom counts or stale exports)
  const [rawFlagsMap, setRawFlagsMap] = useState<ReadonlyMap<number, QuoteFlag>>(() =>
    getQuoteFlagsMap()
  );

  useEffect(() => {
    return subscribeQuoteFlags((updated) => {
      setRawFlagsMap(new Map(updated));
    });
  }, []);

  const flagsMap = useMemo(() => {
    const active = new Map<number, QuoteFlag>();
    for (const [quoteId, flag] of rawFlagsMap.entries()) {
      if (validQuoteIds.has(quoteId)) {
        active.set(quoteId, flag);
      }
    }
    return active;
  }, [rawFlagsMap, validQuoteIds]);

  // Persistent teacher filter & sort state (scoped by 'picker' vs 'standalone' mode)
  const [initialPrefs] = useState(() =>
    loadQuoteBrowserModePrefs(mode, defaultPickerMaxLen)
  );

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [jumpInput, setJumpInput] = useState<string>('');
  const [jumpFeedback, setJumpFeedback] = useState<{
    message: string;
    hiddenQuoteId?: number;
  } | null>(null);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);

  const [sortBy, setSortBy] = useState<QuoteBrowserSortOption>(initialPrefs.sortBy);
  const [randomSeed, setRandomSeed] = useState<number>(1);
  const [filtersExpanded, setFiltersExpanded] = useState<boolean>(
    initialPrefs.filtersExpanded
  );

  const [categoryFilter, setCategoryFilter] = useState<QuoteBrowserCategoryFilter>(
    initialPrefs.categoryFilter
  );
  const [tierFilter, setTierFilter] = useState<QuoteBrowserTierFilter>(
    initialPrefs.tierFilter
  );
  const [minLength, setMinLength] = useState<string>(initialPrefs.minLength);
  const [maxLength, setMaxLength] = useState<string>(initialPrefs.maxLength);
  const [minChi, setMinChi] = useState<string>(initialPrefs.minChi);
  const [maxChi, setMaxChi] = useState<string>(initialPrefs.maxChi);
  const [minWordFilter, setMinWordFilter] = useState<QuoteBrowserMinWordFilter>(
    initialPrefs.minWordFilter
  );
  const [apostropheFilter, setApostropheFilter] =
    useState<QuoteBrowserApostropheFilter>(initialPrefs.apostropheFilter);
  const [flagFilter, setFlagFilter] = useState<QuoteBrowserFlagFilter>(
    initialPrefs.flagFilter
  );
  const [hideUsedInTests, setHideUsedInTests] = useState<boolean>(
    initialPrefs.hideUsedInTests
  );
  const [unseenOnly, setUnseenOnly] = useState<boolean>(initialPrefs.unseenOnly);

  const applyingRemoteSyncRef = useRef<boolean>(false);

  // Sync inbound cloud preference updates if another tab/device updated them
  useEffect(() => {
    return subscribeToSyncUpdates(() => {
      const synced = loadQuoteBrowserModePrefs(mode, defaultPickerMaxLen);
      applyingRemoteSyncRef.current = true;
      setSortBy(synced.sortBy);
      setFiltersExpanded(synced.filtersExpanded);
      setCategoryFilter(synced.categoryFilter);
      setTierFilter(synced.tierFilter);
      setMinLength(synced.minLength);
      setMaxLength(synced.maxLength);
      setMinChi(synced.minChi);
      setMaxChi(synced.maxChi);
      setMinWordFilter(synced.minWordFilter);
      setApostropheFilter(synced.apostropheFilter);
      setFlagFilter(synced.flagFilter);
      setHideUsedInTests(synced.hideUsedInTests);
      setUnseenOnly(synced.unseenOnly);
    });
  }, [mode, defaultPickerMaxLen]);

  // Persist teacher filter & sort changes to localStorage and cloud profile
  const isFirstPersistRef = useRef<boolean>(true);
  useEffect(() => {
    if (isFirstPersistRef.current) {
      isFirstPersistRef.current = false;
      return;
    }
    if (applyingRemoteSyncRef.current) {
      applyingRemoteSyncRef.current = false;
      return;
    }
    saveQuoteBrowserModePrefs(mode, {
      sortBy,
      filtersExpanded,
      categoryFilter,
      tierFilter,
      minLength,
      maxLength,
      minChi,
      maxChi,
      minWordFilter,
      apostropheFilter,
      flagFilter,
      hideUsedInTests,
      unseenOnly,
    });
  }, [
    mode,
    sortBy,
    filtersExpanded,
    categoryFilter,
    tierFilter,
    minLength,
    maxLength,
    minChi,
    maxChi,
    minWordFilter,
    apostropheFilter,
    flagFilter,
    hideUsedInTests,
    unseenOnly,
  ]);

  // Inline flag note editing state
  const [editingFlagQuoteId, setEditingFlagQuoteId] = useState<number | null>(null);
  const [draftFlagNote, setDraftFlagNote] = useState<string>('');
  const [flagSavingId, setFlagSavingId] = useState<number | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [copiedFlagsDone, setCopiedFlagsDone] = useState<boolean>(false);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (categoryFilter !== 'all') count += 1;
    if (tierFilter !== 'all') count += 1;
    if (minLength.trim() !== '') count += 1;
    if (maxLength.trim() !== '') count += 1;
    if (minChi.trim() !== '') count += 1;
    if (maxChi.trim() !== '') count += 1;
    if (minWordFilter !== 'any') count += 1;
    if (apostropheFilter !== 'any') count += 1;
    if (flagFilter !== 'all') count += 1;
    if (hideUsedInTests) count += 1;
    if (unseenOnly) count += 1;
    return count;
  }, [
    categoryFilter,
    tierFilter,
    minLength,
    maxLength,
    minChi,
    maxChi,
    minWordFilter,
    apostropheFilter,
    flagFilter,
    hideUsedInTests,
    unseenOnly,
  ]);

  const hasNonDefaultFilters = useMemo(() => {
    const defaults = getDefaultQuoteBrowserPrefs(mode, defaultPickerMaxLen);
    return (
      searchQuery.trim() !== '' ||
      sortBy !== defaults.sortBy ||
      categoryFilter !== defaults.categoryFilter ||
      tierFilter !== defaults.tierFilter ||
      minLength.trim() !== defaults.minLength ||
      maxLength.trim() !== defaults.maxLength ||
      minChi.trim() !== defaults.minChi ||
      maxChi.trim() !== defaults.maxChi ||
      minWordFilter !== defaults.minWordFilter ||
      apostropheFilter !== defaults.apostropheFilter ||
      flagFilter !== defaults.flagFilter ||
      hideUsedInTests !== defaults.hideUsedInTests ||
      unseenOnly !== defaults.unseenOnly
    );
  }, [
    mode,
    defaultPickerMaxLen,
    searchQuery,
    sortBy,
    categoryFilter,
    tierFilter,
    minLength,
    maxLength,
    minChi,
    maxChi,
    minWordFilter,
    apostropheFilter,
    flagFilter,
    hideUsedInTests,
    unseenOnly,
  ]);

  const resetAllFiltersToShowEverything = useCallback(() => {
    setSearchQuery('');
    setCategoryFilter('all');
    setTierFilter('all');
    setMinLength('');
    setMaxLength('');
    setMinChi('');
    setMaxChi('');
    setMinWordFilter('any');
    setApostropheFilter('any');
    setFlagFilter('all');
    setHideUsedInTests(false);
    setUnseenOnly(false);
  }, []);

  const handleResetDefaultFilters = useCallback(() => {
    const defaults = getDefaultQuoteBrowserPrefs(mode, defaultPickerMaxLen);
    setSearchQuery('');
    setSortBy(defaults.sortBy);
    setCategoryFilter(defaults.categoryFilter);
    setTierFilter(defaults.tierFilter);
    setMinLength(defaults.minLength);
    setMaxLength(defaults.maxLength);
    setMinChi(defaults.minChi);
    setMaxChi(defaults.maxChi);
    setMinWordFilter(defaults.minWordFilter);
    setApostropheFilter(defaults.apostropheFilter);
    setFlagFilter(defaults.flagFilter);
    setHideUsedInTests(defaults.hideUsedInTests);
    setUnseenOnly(defaults.unseenOnly);
    setJumpFeedback(null);
  }, [mode, defaultPickerMaxLen]);

  const filteredQuotes = useMemo(() => {
    const trimmedSearch = searchQuery.trim();
    const lowerSearch = trimmedSearch.toLowerCase();
    const hashIdMatch = /^#(\d+)$/.exec(trimmedSearch);
    const exactHashId = hashIdMatch ? Number.parseInt(hashIdMatch[1], 10) : null;
    const plainId =
      /^\d+$/.test(trimmedSearch) ? Number.parseInt(trimmedSearch, 10) : null;

    const parsedMinLen = minLength.trim() !== '' ? Number(minLength) : null;
    const parsedMaxLen = maxLength.trim() !== '' ? Number(maxLength) : null;
    const parsedMinChi = minChi.trim() !== '' ? Number(minChi) : null;
    const parsedMaxChi = maxChi.trim() !== '' ? Number(maxChi) : null;

    const result = allQuotes.filter((q) => {
      const isFlagged = flagsMap.has(q.id);
      if (flagFilter === 'unflagged' && isFlagged) return false;
      if (flagFilter === 'flagged' && !isFlagged) return false;

      if (hideUsedInTests) {
        const isSelected = selectedQuoteId === q.id;
        const inCurrentTest = usedInCurrentTestIds?.has(q.id) ?? false;
        const inOtherTests = (usedInTestsByQuoteId?.get(q.id)?.length ?? 0) > 0;
        if (inOtherTests || (inCurrentTest && !isSelected)) {
          return false;
        }
      }

      if (unseenOnly) {
        const finishedCount = finishedByQuotesMap?.get(q.id)?.length ?? 0;
        if (finishedCount > 0) {
          return false;
        }
      }

      const qCat: QuoteCategory = q.category ?? 'general';
      if (categoryFilter === 'kids_pool') {
        if (qCat === 'general') return false;
      } else if (categoryFilter !== 'all' && qCat !== categoryFilter) {
        return false;
      }

      if (tierFilter !== 'all' && q.tier !== tierFilter) {
        return false;
      }

      if (parsedMinLen !== null && !Number.isNaN(parsedMinLen) && q.length < parsedMinLen) {
        return false;
      }
      if (parsedMaxLen !== null && !Number.isNaN(parsedMaxLen) && q.length > parsedMaxLen) {
        return false;
      }

      if (parsedMinChi !== null && !Number.isNaN(parsedMinChi) && q.chi < parsedMinChi) {
        return false;
      }
      if (parsedMaxChi !== null && !Number.isNaN(parsedMaxChi) && q.chi > parsedMaxChi) {
        return false;
      }

      if (minWordFilter === '1' && !q.hasOneLetter) return false;
      if (minWordFilter === '2plus' && q.hasOneLetter) return false;

      if (apostropheFilter === 'yes' && !q.hasApostrophe) return false;
      if (apostropheFilter === 'no' && q.hasApostrophe) return false;

      if (trimmedSearch !== '') {
        if (exactHashId !== null) {
          return q.id === exactHashId;
        }
        if (plainId !== null && q.id === plainId) {
          return true;
        }
        const noteText = flagsMap.get(q.id)?.note?.toLowerCase() ?? '';
        const tagsText = q.tags ? q.tags.join(' ').toLowerCase() : '';
        const matchesText =
          q.quote.toLowerCase().includes(lowerSearch) ||
          q.author.toLowerCase().includes(lowerSearch) ||
          tagsText.includes(lowerSearch) ||
          noteText.includes(lowerSearch);
        if (!matchesText) return false;
      }

      return true;
    });

    const sorted = [...result];
    switch (sortBy) {
      case 'id_asc':
        sorted.sort((a, b) => a.id - b.id);
        break;
      case 'id_desc':
        sorted.sort((a, b) => b.id - a.id);
        break;
      case 'len_asc':
        sorted.sort((a, b) => a.length - b.length || a.id - b.id);
        break;
      case 'len_desc':
        sorted.sort((a, b) => b.length - a.length || a.id - b.id);
        break;
      case 'chi_asc':
        sorted.sort((a, b) => a.chi - b.chi || a.id - b.id);
        break;
      case 'chi_desc':
        sorted.sort((a, b) => b.chi - a.chi || a.id - b.id);
        break;
      case 'unique_desc':
        sorted.sort((a, b) => b.unique - a.unique || a.id - b.id);
        break;
      case 'author_asc':
        sorted.sort((a, b) => a.author.localeCompare(b.author) || a.id - b.id);
        break;
      case 'random':
        sorted.sort(
          (a, b) =>
            deterministicHash(a.id, randomSeed) - deterministicHash(b.id, randomSeed)
        );
        break;
    }

    return sorted;
  }, [
    allQuotes,
    flagsMap,
    flagFilter,
    hideUsedInTests,
    selectedQuoteId,
    usedInCurrentTestIds,
    usedInTestsByQuoteId,
    unseenOnly,
    finishedByQuotesMap,
    categoryFilter,
    tierFilter,
    minLength,
    maxLength,
    minChi,
    maxChi,
    minWordFilter,
    apostropheFilter,
    searchQuery,
    sortBy,
    randomSeed,
  ]);

  // Virtualized scrolling state & measured row heights
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [measuredHeights, setMeasuredHeights] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const [scrollTop, setScrollTop] = useState<number>(0);
  const [viewportHeight, setViewportHeight] = useState<number>(640);
  const pendingJumpIdRef = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const updateViewport = () => {
      setViewportHeight(el.clientHeight || 640);
    };
    updateViewport();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateViewport);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  const rowHeightKey = useCallback(
    (quoteId: number) =>
      `${quoteId}:${editingFlagQuoteId === quoteId ? 'edit' : flagsMap.has(quoteId) ? 'flag' : 'base'}`,
    [editingFlagQuoteId, flagsMap]
  );

  const offsets = useMemo(() => {
    const arr = new Float64Array(filteredQuotes.length + 1);
    let running = 0;
    for (let i = 0; i < filteredQuotes.length; i += 1) {
      arr[i] = running;
      const key = rowHeightKey(filteredQuotes[i].id);
      const h = measuredHeights.get(key) ?? ESTIMATED_ROW_HEIGHT;
      running += h + ROW_GAP_PX;
    }
    arr[filteredQuotes.length] = Math.max(0, running - ROW_GAP_PX);
    return arr;
  }, [filteredQuotes, rowHeightKey, measuredHeights]);

  const totalHeight = offsets[filteredQuotes.length] ?? 0;

  const { startIndex, endIndex } = useMemo(() => {
    if (filteredQuotes.length === 0) {
      return { startIndex: 0, endIndex: -1 };
    }
    const rawStart = findOffsetIndex(offsets, Math.max(0, scrollTop));
    const rawEnd = findOffsetIndex(
      offsets,
      Math.max(0, scrollTop + viewportHeight)
    );
    return {
      startIndex: Math.max(0, rawStart - OVERSCAN_COUNT),
      endIndex: Math.min(filteredQuotes.length - 1, rawEnd + OVERSCAN_COUNT),
    };
  }, [filteredQuotes.length, offsets, scrollTop, viewportHeight]);

  const topSpacerHeight = startIndex > 0 ? offsets[startIndex] : 0;
  const bottomSpacerHeight =
    endIndex >= 0 && endIndex < filteredQuotes.length - 1
      ? Math.max(0, totalHeight - offsets[endIndex + 1])
      : 0;

  const visibleQuotes = useMemo(() => {
    if (endIndex < startIndex) return [];
    return filteredQuotes.slice(startIndex, endIndex + 1);
  }, [filteredQuotes, startIndex, endIndex]);

  const measureRowRef = useCallback(
    (quoteId: number, node: HTMLDivElement | null) => {
      if (!node) return;
      const measured = node.offsetHeight;
      if (measured <= 0) return;
      const key = rowHeightKey(quoteId);
      setMeasuredHeights((prev) => {
        const existing = prev.get(key);
        if (existing !== undefined && Math.abs(existing - measured) < 4) {
          return prev;
        }
        const next = new Map(prev);
        next.set(key, measured);
        return next;
      });
    },
    [rowHeightKey]
  );

  const scrollToQuoteId = useCallback(
    (targetId: number, quotesList: readonly Quote[], currentOffsets: Float64Array) => {
      const idx = quotesList.findIndex((q) => q.id === targetId);
      if (idx < 0) return false;

      const scroller = scrollerRef.current;
      if (scroller) {
        const targetOffset = Math.max(0, currentOffsets[idx] - 48);
        scroller.scrollTop = targetOffset;
        setScrollTop(targetOffset);
        requestAnimationFrame(() => {
          const mounted = scroller.querySelector<HTMLElement>(
            `[data-quote-id="${targetId}"]`
          );
          mounted?.scrollIntoView({ block: 'center' });
        });
      }

      setHighlightedId(targetId);
      setJumpFeedback(null);
      return true;
    },
    [setScrollTop, setHighlightedId, setJumpFeedback]
  );

  // Execute deferred jump after resetting filters
  useEffect(() => {
    if (pendingJumpIdRef.current === null) return;
    const targetId = pendingJumpIdRef.current;
    const found = scrollToQuoteId(targetId, filteredQuotes, offsets);
    if (found) {
      pendingJumpIdRef.current = null;
    }
  }, [filteredQuotes, offsets, scrollToQuoteId]);

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = jumpInput.trim().replace(/^#/, '');
    if (!/^\d+$/.test(cleaned)) {
      setJumpFeedback({ message: 'Enter a numeric quote ID (0–2902).' });
      return;
    }
    const targetId = Number.parseInt(cleaned, 10);
    if (scrollToQuoteId(targetId, filteredQuotes, offsets)) {
      return;
    }

    const existsInDb = allQuotes.some((q) => q.id === targetId);
    if (existsInDb) {
      setJumpFeedback({
        message: `Quote #${targetId} is hidden by current filters.`,
        hiddenQuoteId: targetId,
      });
    } else {
      setJumpFeedback({ message: `Quote #${targetId} does not exist.` });
    }
  };

  const handleResetAndJump = (targetId: number) => {
    pendingJumpIdRef.current = targetId;
    resetAllFiltersToShowEverything();
  };

  const handleQuickFlagClick = async (quoteId: number) => {
    setFlagError(null);
    const existing = flagsMap.get(quoteId);
    if (existing) {
      if (editingFlagQuoteId === quoteId) {
        setEditingFlagQuoteId(null);
      } else {
        setEditingFlagQuoteId(quoteId);
        setDraftFlagNote(existing.note ?? '');
      }
      return;
    }

    // Immediate 1-click flag + open optional note input for fast triage
    setFlagSavingId(quoteId);
    const ok = await saveQuoteFlag(quoteId);
    setFlagSavingId(null);
    if (!ok) {
      setFlagError('Could not save flag to Firestore. Verify teacher permissions.');
      return;
    }
    setEditingFlagQuoteId(quoteId);
    setDraftFlagNote('');
  };

  const handleSaveFlagNote = async (quoteId: number) => {
    setFlagError(null);
    setFlagSavingId(quoteId);
    const ok = await saveQuoteFlag(quoteId, draftFlagNote);
    setFlagSavingId(null);
    if (!ok) {
      setFlagError('Could not update flag note in Firestore.');
      return;
    }
    setEditingFlagQuoteId(null);
  };

  const handleUnflag = async (quoteId: number) => {
    setFlagError(null);
    setFlagSavingId(quoteId);
    const ok = await removeQuoteFlag(quoteId);
    setFlagSavingId(null);
    if (!ok) {
      setFlagError('Could not remove flag in Firestore.');
      return;
    }
    if (editingFlagQuoteId === quoteId) {
      setEditingFlagQuoteId(null);
      setDraftFlagNote('');
    }
  };

  const handleCopyFlaggedMarkdown = async () => {
    const flaggedEntries = Array.from(flagsMap.values()).sort(
      (a, b) => a.quoteId - b.quoteId
    );
    if (flaggedEntries.length === 0) return;

    const lines = flaggedEntries.map((entry) => {
      const q = allQuotes.find((item) => item.id === entry.quoteId);
      if (!q) {
        return `- **${entry.quoteId}**${entry.note ? ` — Note: ${entry.note}` : ''}`;
      }
      const cat = q.category ?? 'general';
      const noteSuffix = entry.note ? ` — **Note:** ${entry.note}` : '';
      return `- **${q.id}** (\`${cat}\`, ${q.length} chars): "${q.quote}" — *${q.author}*${noteSuffix}`;
    });

    const markdown = `### Flagged Quotes (${flaggedEntries.length})\n\n${lines.join('\n')}`;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopiedFlagsDone(true);
      setTimeout(() => setCopiedFlagsDone(false), 2000);
    } catch {
      setFlagError('Clipboard access was blocked by the browser.');
    }
  };

  const isLookupMaxPreset = maxLength.trim() === String(MAX_LOOKUP_LENGTH);

  return (
    <div className="quote-browser-panel">
      {/* 1. Top Search, Jump to #ID, & Sort Bar */}
      <div className="qb-top-controls">
        <div className="qb-search-wrap">
          <input
            type="text"
            className="qb-search-input"
            placeholder="Search quote text, author, tags, or #ID..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
            }}
            aria-label="Search quotes"
          />
          {searchQuery && (
            <button
              type="button"
              className="qb-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <form className="qb-jump-form" onSubmit={handleJumpSubmit}>
          <input
            type="text"
            inputMode="numeric"
            className="qb-jump-input"
            placeholder="Jump #ID"
            value={jumpInput}
            onChange={(e) => {
              setJumpInput(e.target.value);
              if (jumpFeedback) setJumpFeedback(null);
            }}
            aria-label="Jump to quote ID"
          />
          <button type="submit" className="btn-simple qb-jump-btn">
            Go
          </button>
        </form>

        <div className="qb-sort-group">
          <select
            className="qb-select qb-sort-select"
            value={sortBy}
            onChange={(e) => {
              const next = e.target.value as QuoteBrowserSortOption;
              setSortBy(next);
              if (next === 'random') {
                setRandomSeed((s) => s + 1);
              }
              if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
            }}
            aria-label="Sort quotes"
          >
            <option value="id_asc">Sort: ID ↑ (0 → 2902)</option>
            <option value="id_desc">Sort: ID ↓ (2902 → 0)</option>
            <option value="len_asc">Sort: Length ↑ (Shortest)</option>
            <option value="len_desc">Sort: Length ↓ (Longest)</option>
            <option value="chi_asc">Sort: χ² ↑ (Standard Freq)</option>
            <option value="chi_desc">Sort: χ² ↓ (Unusual Freq)</option>
            <option value="unique_desc">Sort: Unique Letters ↓</option>
            <option value="author_asc">Sort: Author (A → Z)</option>
            <option value="random">Sort: Random Shuffle</option>
          </select>

          {sortBy === 'random' && (
            <button
              type="button"
              className="btn-simple qb-reshuffle-btn"
              onClick={() => setRandomSeed((s) => s + 1)}
              title="Shuffle random order again"
            >
              🔀 Shuffle
            </button>
          )}

          <button
            type="button"
            className={`btn-simple qb-toggle-filters-btn ${
              filtersExpanded ? 'active' : ''
            }`}
            onClick={() => setFiltersExpanded((prev) => !prev)}
          >
            🎛️ Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        </div>
      </div>

      {jumpFeedback && (
        <div className="qb-jump-feedback">
          <span>{jumpFeedback.message}</span>
          {jumpFeedback.hiddenQuoteId !== undefined && (
            <button
              type="button"
              className="btn-simple qb-jump-reset-btn"
              onClick={() => handleResetAndJump(jumpFeedback.hiddenQuoteId!)}
            >
              Show All & Jump to #{jumpFeedback.hiddenQuoteId}
            </button>
          )}
        </div>
      )}

      {/* 2. Difficulty & Metadata Filters */}
      {filtersExpanded && (
        <div className="qb-filters-box">
          <div className="qb-filter-field">
            <label className="qb-filter-label" htmlFor="qb-cat-select">
              Category
            </label>
            <select
              id="qb-cat-select"
              className="qb-select"
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(e.target.value as QuoteBrowserCategoryFilter)
              }
            >
              <option value="all">All Categories</option>
              <option value="kids_pool">Kids Pool (All Kid_*)</option>
              <option value="kid_joke">Jokes & Riddles</option>
              <option value="kid_science">Science & Facts</option>
              <option value="kid_book">Kids Books</option>
              <option value="kid_movie">Kids Movies</option>
              <option value="kid_lyric">Songs & Lyrics</option>
              <option value="general">General Quotes</option>
            </select>
          </div>

          <div className="qb-filter-field">
            <label className="qb-filter-label" htmlFor="qb-tier-select">
              Difficulty Tier
            </label>
            <select
              id="qb-tier-select"
              className="qb-select"
              value={tierFilter}
              onChange={(e) =>
                setTierFilter(e.target.value as QuoteBrowserTierFilter)
              }
            >
              <option value="all">All Tiers</option>
              <option value="short_drill">Short Drill</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          <div className="qb-filter-field">
            <span className="qb-filter-label">Quote Length</span>
            <div className="qb-range-row">
              <input
                type="number"
                min={1}
                max={300}
                className="qb-range-input"
                placeholder="Min"
                value={minLength}
                onChange={(e) => setMinLength(e.target.value)}
                aria-label="Minimum length"
              />
              <span className="qb-range-sep">–</span>
              <input
                type="number"
                min={1}
                max={300}
                className="qb-range-input"
                placeholder="Max"
                value={maxLength}
                onChange={(e) => setMaxLength(e.target.value)}
                aria-label="Maximum length"
              />
              <button
                type="button"
                className={`qb-chip-toggle ${isLookupMaxPreset ? 'active' : ''}`}
                onClick={() =>
                  setMaxLength(isLookupMaxPreset ? '' : String(MAX_LOOKUP_LENGTH))
                }
                title="Cap quote length at 75 characters for symbol lookup puzzles"
              >
                ≤{MAX_LOOKUP_LENGTH}
              </button>
            </div>
          </div>

          <div className="qb-filter-field">
            <span className="qb-filter-label">Chi-Squared (χ²)</span>
            <div className="qb-range-row">
              <input
                type="number"
                min={0}
                step="1"
                className="qb-range-input"
                placeholder="Min"
                value={minChi}
                onChange={(e) => setMinChi(e.target.value)}
                aria-label="Minimum chi-squared"
              />
              <span className="qb-range-sep">–</span>
              <input
                type="number"
                min={0}
                step="1"
                className="qb-range-input"
                placeholder="Max"
                value={maxChi}
                onChange={(e) => setMaxChi(e.target.value)}
                aria-label="Maximum chi-squared"
              />
            </div>
          </div>

          <div className="qb-filter-field">
            <label className="qb-filter-label" htmlFor="qb-minword-select">
              Min Word Length
            </label>
            <select
              id="qb-minword-select"
              className="qb-select"
              value={minWordFilter}
              onChange={(e) =>
                setMinWordFilter(e.target.value as QuoteBrowserMinWordFilter)
              }
            >
              <option value="any">Any</option>
              <option value="1">1 Letter (Has A / I)</option>
              <option value="2plus">≥ 2 Letters</option>
            </select>
          </div>

          <div className="qb-filter-field">
            <label className="qb-filter-label" htmlFor="qb-apos-select">
              Apostrophes
            </label>
            <select
              id="qb-apos-select"
              className="qb-select"
              value={apostropheFilter}
              onChange={(e) =>
                setApostropheFilter(e.target.value as QuoteBrowserApostropheFilter)
              }
            >
              <option value="any">Any</option>
              <option value="yes">Has Apostrophe</option>
              <option value="no">No Apostrophe</option>
            </select>
          </div>

          <div className="qb-filter-field">
            <label className="qb-filter-label" htmlFor="qb-flag-select">
              Flag Status
            </label>
            <select
              id="qb-flag-select"
              className="qb-select"
              value={flagFilter}
              onChange={(e) =>
                setFlagFilter(e.target.value as QuoteBrowserFlagFilter)
              }
            >
              <option value="all">All Quotes</option>
              <option value="unflagged">Unflagged Only</option>
              <option value="flagged">🚩 Flagged Only ({flagsMap.size})</option>
            </select>
          </div>

          <div className="qb-filter-field">
            <span className="qb-filter-label">Usage &amp; Freshness</span>
            <div className="qb-toggle-pair">
              <button
                type="button"
                className={`qb-chip-toggle ${hideUsedInTests ? 'active' : ''}`}
                onClick={() => setHideUsedInTests((prev) => !prev)}
                title="Hide quotes already included on practice tests"
              >
                {hideUsedInTests ? '✓ ' : ''}Hide Used
              </button>
              <button
                type="button"
                className={`qb-chip-toggle ${unseenOnly ? 'active' : ''}`}
                onClick={() => setUnseenOnly((prev) => !prev)}
                title="Only show quotes that 0 students have completed"
              >
                {unseenOnly ? '✓ ' : ''}Unseen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Results Count & Quick Filter Strip */}
      <div className="qb-summary-bar">
        <div className="qb-summary-left">
          <span className="qb-count-text">
            Showing <strong>{filteredQuotes.length.toLocaleString()}</strong> of{' '}
            {allQuotes.length.toLocaleString()} quotes
          </span>
          <button
            type="button"
            className={`qb-usage-pill-btn ${hideUsedInTests ? 'active' : ''}`}
            onClick={() => setHideUsedInTests((prev) => !prev)}
            title="Toggle hiding quotes already included in practice tests"
          >
            {hideUsedInTests ? '✓ ' : ''}Hide Used in Tests
          </button>
          <button
            type="button"
            className={`qb-usage-pill-btn ${unseenOnly ? 'active' : ''}`}
            onClick={() => setUnseenOnly((prev) => !prev)}
            title="Toggle showing only quotes that 0 students have completed"
          >
            {unseenOnly ? '✓ ' : ''}Unseen Only
          </button>
          <button
            type="button"
            className={`qb-flagged-pill-btn ${
              flagFilter === 'flagged' ? 'active' : ''
            }`}
            onClick={() =>
              setFlagFilter((prev) => (prev === 'flagged' ? 'all' : 'flagged'))
            }
            title="Toggle showing only flagged quotes"
          >
            🚩 {flagsMap.size} Flagged
          </button>
        </div>

        <div className="qb-summary-right">
          {flagsMap.size > 0 && (
            <button
              type="button"
              className="btn-simple qb-copy-flagged-btn"
              onClick={() => void handleCopyFlaggedMarkdown()}
              title="Copy flagged quotes as Markdown for GitHub Issue #2"
            >
              {copiedFlagsDone
                ? '✓ Copied Markdown!'
                : `📋 Copy Flagged (${flagsMap.size})`}
            </button>
          )}

          {hasNonDefaultFilters && (
            <button
              type="button"
              className="btn-simple qb-reset-btn"
              onClick={handleResetDefaultFilters}
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {usersReadBlocked && (
        <div className="qb-info-banner">
          ℹ️ Publish updated <code>firestore.rules</code> in Firebase Console to
          include solo drill completions in Finished counts (practice test attempts
          are already counted).
        </div>
      )}

      {flagError && <div className="qb-error-banner">⚠️ {flagError}</div>}

      {/* 4. Virtualized Quote List */}
      <div
        ref={scrollerRef}
        className="quote-browser-virtual-scroller"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {filteredQuotes.length === 0 ? (
          <div className="qb-empty-state">
            <p>No quotes match your current filters.</p>
            <button
              type="button"
              className="btn-simple"
              onClick={resetAllFiltersToShowEverything}
            >
              Show All Quotes
            </button>
          </div>
        ) : (
          <div className="qb-virtual-inner">
            {topSpacerHeight > 0 && (
              <div style={{ height: `${topSpacerHeight}px`, flexShrink: 0 }} />
            )}

            {visibleQuotes.map((quote) => {
              const flagEntry = flagsMap.get(quote.id);
              const isFlagged = Boolean(flagEntry);
              const isEditingNote = editingFlagQuoteId === quote.id;
              const isSelected = selectedQuoteId === quote.id;
              const isHighlighted = highlightedId === quote.id;
              const inCurrentTest = usedInCurrentTestIds?.has(quote.id) ?? false;
              const otherTests = usedInTestsByQuoteId?.get(quote.id);
              const finishedStudents = finishedByQuotesMap?.get(quote.id);
              const category: QuoteCategory = quote.category ?? 'general';

              return (
                <div
                  key={quote.id}
                  data-quote-id={quote.id}
                  ref={(el) => measureRowRef(quote.id, el)}
                  className={[
                    'qb-quote-card',
                    isFlagged ? 'qb-card-flagged' : '',
                    isSelected ? 'qb-card-selected' : '',
                    isHighlighted ? 'qb-card-highlighted' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="qb-card-top">
                    <div className="qb-meta-badges">
                      <span className="qb-id-badge">#{quote.id}</span>
                      <span className={`qb-cat-badge qb-cat-${category}`}>
                        {CATEGORY_LABELS[category]}
                      </span>
                      <span className={`qb-tier-badge qb-tier-${quote.tier}`}>
                        {TIER_LABELS[quote.tier]}
                      </span>
                      <span
                        className={`qb-stat-pill ${
                          quote.length > MAX_LOOKUP_LENGTH ? 'qb-stat-long' : ''
                        }`}
                      >
                        {quote.length} chars
                      </span>
                      <span className="qb-stat-pill">
                        MinW: {quote.minWordLength}
                      </span>
                      <span className="qb-stat-pill">
                        χ² {quote.chi.toFixed(1)}
                      </span>
                      <span className="qb-stat-pill">Uniq: {quote.unique}</span>
                      {quote.hasApostrophe && (
                        <span className="qb-stat-pill qb-pill-apos">’ Apos</span>
                      )}
                      {inCurrentTest && !isSelected && (
                        <span className="qb-used-pill">📋 In This Test</span>
                      )}
                      {otherTests && otherTests.length > 0 && (
                        <span
                          className="qb-used-pill"
                          title={`Used in: ${otherTests.join(', ')}`}
                        >
                          📝 Used in Tests
                        </span>
                      )}
                      {finishedStudents && finishedStudents.length > 0 && (
                        <span
                          className="qb-finished-pill"
                          title={`Completed by: ${finishedStudents.join(', ')}`}
                        >
                          ✓ {finishedStudents.length} Finished
                        </span>
                      )}
                    </div>

                    <div className="qb-card-actions">
                      <button
                        type="button"
                        className={`qb-flag-btn ${isFlagged ? 'flagged' : ''}`}
                        disabled={flagSavingId === quote.id}
                        onClick={() => void handleQuickFlagClick(quote.id)}
                        title={
                          isFlagged
                            ? 'Edit flag note or unflag this quote'
                            : 'Flag this quote for database review (1-click)'
                        }
                      >
                        {isFlagged ? '🚩 Flagged' : '🚩 Flag'}
                      </button>

                      {onSelectQuote && (
                        <button
                          type="button"
                          className={`qb-select-quote-btn ${
                            isSelected ? 'selected' : ''
                          }`}
                          onClick={() => onSelectQuote(quote)}
                        >
                          {isSelected ? '✓ Selected' : 'Select ✓'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="qb-quote-text">{quote.quote}</div>

                  <div className="qb-quote-footer">
                    <span className="qb-quote-author">— {quote.author}</span>
                    {quote.tags && quote.tags.length > 0 && (
                      <span className="qb-quote-tags">
                        {quote.tags.slice(0, 4).join(' · ')}
                      </span>
                    )}
                  </div>

                  {isFlagged && !isEditingNote && flagEntry?.note && (
                    <div className="qb-flag-saved-note">
                      <span>🚩 {flagEntry.note}</span>
                      <div className="qb-flag-saved-actions">
                        <button
                          type="button"
                          className="btn-cohort-mini"
                          onClick={() => {
                            setEditingFlagQuoteId(quote.id);
                            setDraftFlagNote(flagEntry.note ?? '');
                          }}
                        >
                          Edit Note
                        </button>
                        <button
                          type="button"
                          className="btn-cohort-danger"
                          disabled={flagSavingId === quote.id}
                          onClick={() => void handleUnflag(quote.id)}
                        >
                          Unflag
                        </button>
                      </div>
                    </div>
                  )}

                  {isEditingNote && (
                    <div className="qb-flag-editor-row">
                      <input
                        type="text"
                        className="qb-flag-note-input"
                        placeholder="Optional note (e.g. typo, awkward phrasing, encoding, attribution)..."
                        maxLength={500}
                        value={draftFlagNote}
                        autoFocus
                        onChange={(e) => setDraftFlagNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleSaveFlagNote(quote.id);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditingFlagQuoteId(null);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn-cohort-mini qb-btn-save-note"
                        disabled={flagSavingId === quote.id}
                        onClick={() => void handleSaveFlagNote(quote.id)}
                      >
                        Save Note
                      </button>
                      <button
                        type="button"
                        className="btn-cohort-danger"
                        disabled={flagSavingId === quote.id}
                        onClick={() => void handleUnflag(quote.id)}
                      >
                        Unflag
                      </button>
                      <button
                        type="button"
                        className="btn-cohort-mini"
                        onClick={() => setEditingFlagQuoteId(null)}
                      >
                        Done
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {bottomSpacerHeight > 0 && (
              <div style={{ height: `${bottomSpacerHeight}px`, flexShrink: 0 }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
