import { useCallback, useEffect, useRef, useState } from 'react';

export interface ActiveTimerState {
  accumulatedMs: number;
  segmentStartMs: number | null;
  frozen: boolean;
}

export function createActiveTimerState(
  nowMs: number,
  isVisible: boolean
): ActiveTimerState {
  return {
    accumulatedMs: 0,
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
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * Tracks active solve time on a cipher puzzle:
 * - Starts immediately when the puzzle loads (provided the tab is visible)
 * - Pauses while `document.visibilityState === 'hidden'` and resumes when visible
 * - Freezes permanently when `freezeTimer()` is called on submission
 * - Resets to `0:00` when `resetTimer()` is called for a new quote
 */
export function usePuzzleElapsedTimer(enabled: boolean) {
  const timerRef = useRef<ActiveTimerState>({
    accumulatedMs: 0,
    segmentStartMs: null,
    frozen: false,
  });
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [solvedElapsedMs, setSolvedElapsedMs] = useState<number | null>(null);

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

    const syncClock = () => {
      const ms = getActiveElapsedMs(timerRef.current, Date.now());
      setElapsedSeconds(Math.floor(ms / 1000));
    };

    const handleVisibilityChange = () => {
      timerRef.current = updateTimerVisibility(
        timerRef.current,
        isDocumentVisible(),
        Date.now()
      );
      syncClock();
    };

    const intervalId = window.setInterval(() => {
      if (!timerRef.current.frozen && timerRef.current.segmentStartMs !== null) {
        syncClock();
      }
    }, 250);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled]);

  const freezeTimer = useCallback((): number => {
    const next = freezeActiveTimer(timerRef.current, Date.now());
    timerRef.current = next;
    setSolvedElapsedMs(next.accumulatedMs);
    setElapsedSeconds(Math.floor(next.accumulatedMs / 1000));
    return next.accumulatedMs;
  }, []);

  const resetTimer = useCallback(() => {
    timerRef.current = createActiveTimerState(
      Date.now(),
      enabled && isDocumentVisible()
    );
    setSolvedElapsedMs(null);
    setElapsedSeconds(0);
  }, [enabled]);

  return {
    elapsedSeconds,
    solvedElapsedMs,
    freezeTimer,
    resetTimer,
  };
}
