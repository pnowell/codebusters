export const IDLE_TIMEOUT_MS = 60_000;

export interface IdleAwareTimerState {
  accumulatedMs: number;
  segmentStartMs: number | null;
  lastActivityMs: number;
  isVisible: boolean;
  frozen: boolean;
}

export function isDocumentCurrentlyVisible(): boolean {
  return (
    typeof document === 'undefined' || document.visibilityState !== 'hidden'
  );
}

export function createIdleAwareTimerState(
  nowMs: number,
  isVisible: boolean,
  initialElapsedMs = 0,
  initialFrozen = false
): IdleAwareTimerState {
  const safeInitial = Math.max(0, Math.trunc(initialElapsedMs));
  if (initialFrozen) {
    return {
      accumulatedMs: safeInitial,
      segmentStartMs: null,
      lastActivityMs: nowMs,
      isVisible,
      frozen: true,
    };
  }
  return {
    accumulatedMs: safeInitial,
    segmentStartMs: isVisible ? nowMs : null,
    lastActivityMs: nowMs,
    isVisible,
    frozen: false,
  };
}

export function getIdleAwareElapsedMs(
  state: IdleAwareTimerState,
  nowMs: number,
  idleTimeoutMs = IDLE_TIMEOUT_MS
): number {
  if (state.frozen || !state.isVisible || state.segmentStartMs === null) {
    return state.accumulatedMs;
  }
  const effectiveEndMs = Math.min(nowMs, state.lastActivityMs + idleTimeoutMs);
  return state.accumulatedMs + Math.max(0, effectiveEndMs - state.segmentStartMs);
}

export function isTimerPausedOrIdle(
  state: IdleAwareTimerState,
  nowMs: number,
  idleTimeoutMs = IDLE_TIMEOUT_MS
): boolean {
  if (state.frozen || !state.isVisible || state.segmentStartMs === null) {
    return true;
  }
  return nowMs >= state.lastActivityMs + idleTimeoutMs;
}

export function recordIdleTimerActivity(
  state: IdleAwareTimerState,
  nowMs: number,
  idleTimeoutMs = IDLE_TIMEOUT_MS
): IdleAwareTimerState {
  if (state.frozen || !state.isVisible) {
    return state;
  }
  if (
    state.segmentStartMs === null ||
    nowMs > state.lastActivityMs + idleTimeoutMs
  ) {
    const banked = getIdleAwareElapsedMs(state, nowMs, idleTimeoutMs);
    return {
      ...state,
      accumulatedMs: banked,
      segmentStartMs: nowMs,
      lastActivityMs: nowMs,
    };
  }
  return {
    ...state,
    lastActivityMs: Math.max(state.lastActivityMs, nowMs),
  };
}

export function updateIdleTimerVisibility(
  state: IdleAwareTimerState,
  isVisible: boolean,
  nowMs: number,
  idleTimeoutMs = IDLE_TIMEOUT_MS
): IdleAwareTimerState {
  if (state.frozen) return state;
  if (!isVisible) {
    if (!state.isVisible && state.segmentStartMs === null) return state;
    return {
      ...state,
      accumulatedMs: getIdleAwareElapsedMs(state, nowMs, idleTimeoutMs),
      segmentStartMs: null,
      isVisible: false,
    };
  }
  if (state.isVisible && state.segmentStartMs !== null) return state;
  return {
    ...state,
    segmentStartMs: nowMs,
    lastActivityMs: nowMs,
    isVisible: true,
  };
}

export function freezeIdleAwareTimer(
  state: IdleAwareTimerState,
  nowMs: number,
  idleTimeoutMs = IDLE_TIMEOUT_MS
): IdleAwareTimerState {
  if (state.frozen) return state;
  return {
    ...state,
    accumulatedMs: getIdleAwareElapsedMs(state, nowMs, idleTimeoutMs),
    segmentStartMs: null,
    frozen: true,
  };
}

/**
 * Subscribes to passive window/document user interaction events to reset foreground idle state.
 * `pointermove` is throttled to at most once per second to avoid unnecessary handler work.
 */
export function subscribeWindowActivity(onActivity: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let lastMoveMs = 0;
  const handleImmediate = () => {
    onActivity();
  };
  const handlePointerMove = () => {
    const now = Date.now();
    if (now - lastMoveMs >= 1000) {
      lastMoveMs = now;
      onActivity();
    }
  };

  window.addEventListener('keydown', handleImmediate, { passive: true });
  window.addEventListener('pointerdown', handleImmediate, { passive: true });
  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  window.addEventListener('touchstart', handleImmediate, { passive: true });
  window.addEventListener('wheel', handleImmediate, { passive: true });
  document.addEventListener('scroll', handleImmediate, {
    passive: true,
    capture: true,
  });

  return () => {
    window.removeEventListener('keydown', handleImmediate);
    window.removeEventListener('pointerdown', handleImmediate);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('touchstart', handleImmediate);
    window.removeEventListener('wheel', handleImmediate);
    document.removeEventListener('scroll', handleImmediate, true);
  };
}
