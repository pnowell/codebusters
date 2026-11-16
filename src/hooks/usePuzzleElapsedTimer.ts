import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createIdleAwareTimerState,
  freezeIdleAwareTimer,
  getIdleAwareElapsedMs,
  IDLE_TIMEOUT_MS,
  isDocumentCurrentlyVisible,
  isTimerPausedOrIdle,
  recordIdleTimerActivity,
  subscribeWindowActivity,
  updateIdleTimerVisibility,
  type IdleAwareTimerState,
} from '../utils/activeTimer';

export type ActiveTimerState = IdleAwareTimerState;

export interface PuzzleElapsedTimerOptions {
  initialElapsedMs?: number;
  initialFrozen?: boolean;
  idleTimeoutMs?: number;
  onFlushElapsedMs?: (elapsedMs: number) => void;
}

export {
  createIdleAwareTimerState as createActiveTimerState,
  freezeIdleAwareTimer as freezeActiveTimer,
  getIdleAwareElapsedMs as getActiveElapsedMs,
  recordIdleTimerActivity,
  updateIdleTimerVisibility as updateTimerVisibility,
};

/**
 * Tracks active solve time on a cipher puzzle:
 * - Starts immediately when the puzzle loads (or resumes from `initialElapsedMs` on reload)
 * - Pauses immediately while `document.visibilityState === 'hidden'`
 * - Pauses after 60s of foreground inactivity (`IDLE_TIMEOUT_MS`) and resumes on user interaction
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
  const idleTimeoutMs = options?.idleTimeoutMs ?? IDLE_TIMEOUT_MS;

  const timerRef = useRef<IdleAwareTimerState>({
    accumulatedMs: initialMs,
    segmentStartMs: null,
    lastActivityMs: 0,
    isVisible: true,
    frozen: initialFrozen,
  });
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(() =>
    Math.floor(initialMs / 1000)
  );
  const [isIdlePaused, setIsIdlePaused] = useState<boolean>(initialFrozen);
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
        lastActivityMs: 0,
        isVisible: false,
        frozen: true,
      };
      return;
    }

    const nowInit = Date.now();
    const visibleInit = isDocumentCurrentlyVisible();
    if (!timerRef.current.frozen && timerRef.current.segmentStartMs === null) {
      timerRef.current = {
        ...timerRef.current,
        segmentStartMs: visibleInit ? nowInit : null,
        lastActivityMs: nowInit,
        isVisible: visibleInit,
      };
    }

    const syncClock = (shouldFlush = false) => {
      const now = Date.now();
      const ms = getIdleAwareElapsedMs(timerRef.current, now, idleTimeoutMs);
      const paused = isTimerPausedOrIdle(timerRef.current, now, idleTimeoutMs);
      setElapsedSeconds(Math.floor(ms / 1000));
      setIsIdlePaused(paused);
      if (shouldFlush) {
        onFlushRef.current?.(ms);
      }
    };

    const handleVisibilityChange = () => {
      timerRef.current = updateIdleTimerVisibility(
        timerRef.current,
        isDocumentCurrentlyVisible(),
        Date.now(),
        idleTimeoutMs
      );
      syncClock(true);
    };

    const handleActivity = () => {
      const prevPaused = isTimerPausedOrIdle(
        timerRef.current,
        Date.now(),
        idleTimeoutMs
      );
      timerRef.current = recordIdleTimerActivity(
        timerRef.current,
        Date.now(),
        idleTimeoutMs
      );
      if (prevPaused && !timerRef.current.frozen) {
        syncClock(false);
      }
    };

    const handlePageHide = () => {
      if (!timerRef.current.frozen) {
        const ms = getIdleAwareElapsedMs(
          timerRef.current,
          Date.now(),
          idleTimeoutMs
        );
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

    const unsubActivity = subscribeWindowActivity(handleActivity);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.clearInterval(intervalId);
      unsubActivity();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [enabled, idleTimeoutMs]);

  const getElapsedMs = useCallback((): number => {
    return getIdleAwareElapsedMs(timerRef.current, Date.now(), idleTimeoutMs);
  }, [idleTimeoutMs]);

  const freezeTimer = useCallback((): number => {
    const next = freezeIdleAwareTimer(
      timerRef.current,
      Date.now(),
      idleTimeoutMs
    );
    timerRef.current = next;
    setSolvedElapsedMs(next.accumulatedMs);
    setElapsedSeconds(Math.floor(next.accumulatedMs / 1000));
    setIsIdlePaused(true);
    return next.accumulatedMs;
  }, [idleTimeoutMs]);

  const resetTimer = useCallback(
    (seedMs = 0, frozen = false) => {
      const now = Date.now();
      const visible = enabled && isDocumentCurrentlyVisible();
      timerRef.current = createIdleAwareTimerState(
        now,
        visible,
        seedMs,
        frozen
      );
      setSolvedElapsedMs(frozen ? Math.max(0, Math.trunc(seedMs)) : null);
      setElapsedSeconds(Math.floor(Math.max(0, Math.trunc(seedMs)) / 1000));
      setIsIdlePaused(frozen || !visible);
    },
    [enabled]
  );

  return {
    elapsedSeconds,
    isIdlePaused,
    solvedElapsedMs,
    getElapsedMs,
    freezeTimer,
    resetTimer,
  };
}
