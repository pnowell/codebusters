import { useState, useEffect, useCallback } from 'react';

export const WARMUP_TARGET_SECONDS = 120;

export function useWarmupTimer(isActive: boolean) {
  const [elapsedWarmup, setElapsedWarmup] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const interval = window.setInterval(() => {
      setElapsedWarmup((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isActive]);

  const skipWarmup = useCallback(() => {
    setElapsedWarmup(WARMUP_TARGET_SECONDS);
  }, []);

  return { elapsedWarmup, skipWarmup };
}
