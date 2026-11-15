import { useCallback, useEffect, useRef, useState } from 'react';

export interface ActiveTimerState {
  accumulatedMs: number;
  segmentStartMs: number | null;
  frozen: boolean;
}

export interface PuzzleElapsedTimerOptions {
  initialElapsedMs?: number;
  initialFrozen?: boolean;
  onFlushElapsedMs?: (elapsedMs: number) => void;
}

export function createActiveTimerState(
  nowMs: number,
  isVisible: boolean,
  initialElapsedMs = 0,
  initialFrozen = false
): ActiveTimerState {
  const safeInitial = Math.max(0, Math.trunc(initialElapsedMs));
  if (initialFrozen) {
    return {
      accumulatedMs: safeInitial,
      segmentStartMs: null,
      frozen: true,
    };
  }
  return {
    accumulatedMs: safeInitial,
    segmentStartMs: isVisible ? nowMs : null,
    frozen: false,
  };
}

export function getActiveElapsedMs(
  state: ActiveTimerState,
  nowMs: number
): number {
  if (state.frozen || state.segmentStartMs === null) {
    return state.accumulatedMs;
  }
  return state.accumulatedMs + Math.max(0, nowMs - state.segmentStartMs);
}

export function updateTimerVisibility(
  state: ActiveTimerState,
  isVisible: boolean,
  nowMs: number
): ActiveTimerState {
  if (state.frozen) return state;
  if (!isVisible) {
    if (state.segmentStartMs === null) return state;
    return {
      accumulatedMs:
        state.accumulatedMs + Math.max(0, nowMs - state.segmentStartMs),
      segmentStartMs: null,
      frozen: false,
    };
  }
  if (state.segmentStartMs !== null) return state;
  return {
    ...state,
    segmentStartMs: nowMs,
  };
}

export function freezeActiveTimer(
  state: ActiveTimerState,
  nowMs: number
): ActiveTimerState {
  if (state.frozen) return state;
  return {
    accumulatedMs: getActiveElapsedMs(state, nowMs),
    segmentStartMs: null,
    frozen: true,
  };
}

function isDocumentVisible(): boolean {
  return (
    typeof document === 'undefined' || document.visibilityState !== 'hidden'
  );
}

/**
 * Tracks active solve time on a cipher puzzle:
 * - Starts immediately when the puzzle loads (or resumes from `initialElapsedMs` on reload)
 * - Pauses while `document.visibilityState === 'hidden'` and resumes when visible
 * - Periodically flushes elapsed milliseconds via `onFlushElapsedMs` (and on `visibilitychange` / `pagehide`)
 * - Freezes permanently when `freezeTimer()` is called on submission
 * - Resets to `0:00` when `resetTimer()` is called for a new quote
 */
export function usePuzzleElapsedTimer(
  enabled: boolean,
  options?: PuzzleElapsedTimerOptions
) {
  const initialMs = Math.max(0, Math.trunc(options?.initialElapsedMs ?? 0));
  const initialFrozen = Boolean(options?.initialFrozen);

  const timerRef = useRef<ActiveTimerState>({
    accumulatedMs: initialMs,
    segmentStartMs: null,
    frozen: initialFrozen,
  });
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(() =>
    Math.floor(initialMs / 1000)
  );
  const [solvedElapsedMs, setSolvedElapsedMs] = useState<number | null>(() =>
    initialFrozen ? initialMs : null
  );

  const onFlushRef = useRef(options?.onFlushElapsedMs);
  useEffect(() => {
    onFlushRef.current = options?.onFlushElapsedMs;
  }, [options?.onFlushElapsedMs]);

  useEffect(() => {
    if (!enabled) {
      timerRef.current = {
        accumulatedMs: 0,
        segmentStartMs: null,
        frozen: true,
      };
      return;
    }

    if (
      !timerRef.current.frozen &&
      timerRef.current.segmentStartMs === null &&
      isDocumentVisible()
    ) {
      timerRef.current = {
        ...timerRef.current,
        segmentStartMs: Date.now(),
      };
    }

    const syncClock = (shouldFlush = false) => {
      const ms = getActiveElapsedMs(timerRef.current, Date.now());
      setElapsedSeconds(Math.floor(ms / 1000));
      if (shouldFlush) {
        onFlushRef.current?.(ms);
      }
    };

    const handleVisibilityChange = () => {
      timerRef.current = updateTimerVisibility(
        timerRef.current,
        isDocumentVisible(),
        Date.now()
      );
      syncClock(true);
    };

    const handlePageHide = () => {
      if (!timerRef.current.frozen) {
        const ms = getActiveElapsedMs(timerRef.current, Date.now());
        onFlushRef.current?.(ms);
      }
    };

    let tickCount = 0;
    const intervalId = window.setInterval(() => {
      if (!timerRef.current.frozen && timerRef.current.segmentStartMs !== null) {
        tickCount = (tickCount + 1) % 4;
        syncClock(tickCount === 0);
      }
    }, 250);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [enabled]);

  const getElapsedMs = useCallback((): number => {
    return getActiveElapsedMs(timerRef.current, Date.now());
  }, []);

  const freezeTimer = useCallback((): number => {
    const next = freezeActiveTimer(timerRef.current, Date.now());
    timerRef.current = next;
    setSolvedElapsedMs(next.accumulatedMs);
    setElapsedSeconds(Math.floor(next.accumulatedMs / 1000));
    return next.accumulatedMs;
  }, []);

  const resetTimer = useCallback(
    (seedMs = 0, frozen = false) => {
      timerRef.current = createActiveTimerState(
        Date.now(),
        enabled && isDocumentVisible(),
        seedMs,
        frozen
      );
      setSolvedElapsedMs(frozen ? Math.max(0, Math.trunc(seedMs)) : null);
      setElapsedSeconds(Math.floor(Math.max(0, Math.trunc(seedMs)) / 1000));
    },
    [enabled]
  );

  return {
    elapsedSeconds,
    solvedElapsedMs,
    getElapsedMs,
    freezeTimer,
    resetTimer,
  };
}
