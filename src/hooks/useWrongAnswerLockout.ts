import { useState, useRef, useCallback, useEffect } from 'react';
import { DRILL_LOCKOUT_CONFIG } from '../data/drills';

export interface WrongLockoutState {
  wrongAnswer: string;
  correctAnswer: string;
}

export function useWrongAnswerLockout() {
  const [wrongState, setWrongState] = useState<WrongLockoutState | null>(null);
  const [lockoutId, setLockoutId] = useState<number>(0);
  const [shakeCycle, setShakeCycle] = useState<number>(0);

  const isLockedRef = useRef<boolean>(false);
  const timerRef = useRef<number | null>(null);
  const unlockAtRef = useRef<number>(0);
  const onUnlockRef = useRef<(() => void) | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
      isLockedRef.current = false;
    };
  }, [clearTimer]);

  const completeUnlock = useCallback(() => {
    clearTimer();
    isLockedRef.current = false;
    setWrongState(null);
    const callback = onUnlockRef.current;
    onUnlockRef.current = null;
    callback?.();
  }, [clearTimer]);

  const triggerWrongLockout = useCallback(
    (wrongAnswer: string, correctAnswer: string, onUnlock: () => void) => {
      const duration = DRILL_LOCKOUT_CONFIG.wrongAnswerLockoutMs;

      clearTimer();
      isLockedRef.current = true;
      unlockAtRef.current = performance.now() + duration;
      onUnlockRef.current = onUnlock;

      setWrongState({ wrongAnswer, correctAnswer });
      setLockoutId((prev) => prev + 1);
      setShakeCycle((prev) => prev + 1);
      timerRef.current = window.setTimeout(
        completeUnlock,
        Math.max(0, Math.ceil(duration))
      );
    },
    [clearTimer, completeUnlock]
  );

  /**
   * Called when the user attempts to type or submit while locked out.
   * Re-triggers the input box shake without resetting or extending the lockout timer.
   */
  const registerBlockedInput = useCallback((): boolean => {
    if (!isLockedRef.current) return false;

    if (performance.now() >= unlockAtRef.current) {
      completeUnlock();
      return true;
    }

    setShakeCycle((prev) => prev + 1);
    return true;
  }, [completeUnlock]);

  const clearWrongLockout = useCallback(() => {
    clearTimer();
    isLockedRef.current = false;
    onUnlockRef.current = null;
    setWrongState(null);
  }, [clearTimer]);

  return {
    wrongAnswer: wrongState?.wrongAnswer ?? null,
    correctAnswer: wrongState?.correctAnswer ?? null,
    isWrong: wrongState !== null,
    isLockedRef,
    lockoutDurationMs: DRILL_LOCKOUT_CONFIG.wrongAnswerLockoutMs,
    lockoutId,
    shakeCycle,
    triggerWrongLockout,
    registerBlockedInput,
    clearWrongLockout,
  };
}
