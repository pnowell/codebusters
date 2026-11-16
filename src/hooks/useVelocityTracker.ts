import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  loadDrillScore,
  recordDrillSession,
  saveDrillScore,
  subscribeToDrillScoreChanges,
} from '../services/storage';
import { logDrillSessionEvent } from '../services/eventLogger';
import {
  createIdleAwareTimerState,
  getIdleAwareElapsedMs,
  isDocumentCurrentlyVisible,
  recordIdleTimerActivity,
  subscribeWindowActivity,
  updateIdleTimerVisibility,
  type IdleAwareTimerState,
} from '../utils/activeTimer';
import type { DrillId } from '../types';

export interface HeatTierInfo {
  tier: 'idle' | 'cruise' | 'fast' | 'overdrive' | 'onfire';
  label: string;
  icon: string;
}

export function getHeatTier(cpm: number): HeatTierInfo {
  if (cpm >= 36) return { tier: 'onfire', label: 'ON FIRE!', icon: '🔥🔥🔥' };
  if (cpm >= 26) return { tier: 'overdrive', label: 'OVERDRIVE', icon: '🔥' };
  if (cpm >= 16) return { tier: 'fast', label: 'FAST', icon: '⚡⚡' };
  if (cpm > 0) return { tier: 'cruise', label: 'CRUISE', icon: '⚡' };
  return { tier: 'idle', label: 'IDLE', icon: '⏱️' };
}

export function useVelocityTracker(
  drillId: DrillId,
  source: 'standalone' | 'general_practice' = 'standalone'
) {
  const [scoreRevision, setScoreRevision] = useState<number>(0);

  useEffect(() => {
    return subscribeToDrillScoreChanges(() => {
      setScoreRevision((prev) => prev + 1);
    });
  }, []);

  const scores = useMemo(() => {
    void scoreRevision;
    return loadDrillScore(drillId);
  }, [drillId, scoreRevision]);

  const [current60s, setCurrent60s] = useState<number>(0);
  const [sessionBest60s, setSessionBest60s] = useState<number>(0);
  const [cadence, setCadence] = useState<number>(0);
  const [streak, setStreak] = useState<number>(0);
  const [newRecordAlert, setNewRecordAlert] = useState<boolean>(false);

  const correctTimestampsRef = useRef<number[]>([]);
  const lastCorrectTimeRef = useRef<number | null>(null);
  const recordAlertTimerRef = useRef<number | null>(null);
  const activeTimerRef = useRef<IdleAwareTimerState>({
    accumulatedMs: 0,
    segmentStartMs: null,
    lastActivityMs: 0,
    isVisible: true,
    frozen: false,
  });
  const attemptsRef = useRef<number>(0);
  const correctCountRef = useRef<number>(0);
  const sessionBest60sRef = useRef<number>(0);
  const flushedRef = useRef<boolean>(false);

  const flushSession = useCallback(
    (forceActivity = false, keepalive = false) => {
      if (flushedRef.current) return;
      flushedRef.current = true;
      const now = Date.now();
      const elapsedMs = getIdleAwareElapsedMs(activeTimerRef.current, now);
      const totalAnswered = attemptsRef.current;
      const totalCorrect = correctCountRef.current;
      const best60s = sessionBest60sRef.current;

      recordDrillSession(drillId, {
        sessionBest60s: best60s,
        elapsedMs,
        attempts: totalAnswered,
        forceActivity,
      });

      if (totalAnswered >= 1) {
        logDrillSessionEvent(
          {
            drillId,
            sessionDurationSec: elapsedMs / 1000,
            sessionBest60sScore: best60s,
            totalAnswered,
            totalCorrect,
            source,
          },
          { keepalive }
        );
      }
    },
    [drillId, source]
  );

  useEffect(() => {
    const now = Date.now();
    activeTimerRef.current = createIdleAwareTimerState(
      now,
      isDocumentCurrentlyVisible(),
      0,
      false
    );
    attemptsRef.current = 0;
    correctCountRef.current = 0;
    sessionBest60sRef.current = 0;
    flushedRef.current = false;

    const handleVisibilityChange = () => {
      activeTimerRef.current = updateIdleTimerVisibility(
        activeTimerRef.current,
        isDocumentCurrentlyVisible(),
        Date.now()
      );
    };

    const handleActivity = () => {
      activeTimerRef.current = recordIdleTimerActivity(
        activeTimerRef.current,
        Date.now()
      );
    };

    const handlePageHide = () => {
      flushSession(false, true);
    };

    const unsubActivity = subscribeWindowActivity(handleActivity);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      unsubActivity();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      flushSession(false, false);
      if (recordAlertTimerRef.current !== null) {
        window.clearTimeout(recordAlertTimerRef.current);
      }
    };
  }, [flushSession]);

  // Live 150ms interval: Prune 60s timestamps and smoothly decay cadence after 3.5s hold
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();

      // Prune timestamps older than 60s
      const filtered = correctTimestampsRef.current.filter((t) => now - t <= 60000);
      correctTimestampsRef.current = filtered;
      setCurrent60s((prev) => (prev === filtered.length ? prev : filtered.length));

      // Hold cadence steady for 3.5s, then decay smoothly (~3 CPM per second)
      if (lastCorrectTimeRef.current !== null) {
        const timeSinceLast = (now - lastCorrectTimeRef.current) / 1000;
        if (timeSinceLast > 3.5) {
          setCadence((prev) => {
            if (prev <= 0.5) return 0;
            const decayed = prev * 0.97 - 0.25;
            return Math.max(0, Math.round(decayed * 10) / 10);
          });
        }
      }
    }, 150);

    return () => window.clearInterval(interval);
  }, []);

  const recordHit = useCallback(() => {
    const now = Date.now();
    activeTimerRef.current = recordIdleTimerActivity(activeTimerRef.current, now);
    attemptsRef.current += 1;
    correctCountRef.current += 1;
    const newStreak = streak + 1;
    setStreak(newStreak);

    // Record timestamp for 60s Blitz
    correctTimestampsRef.current.push(now);
    const updated60s = correctTimestampsRef.current.filter((t) => now - t <= 60000).length;
    setCurrent60s(updated60s);
    sessionBest60sRef.current = Math.max(sessionBest60sRef.current, updated60s);
    setSessionBest60s((prev) => Math.max(prev, updated60s));

    // High Score checks
    if (updated60s > scores.best60s) {
      saveDrillScore(drillId, { best60s: updated60s });
      setNewRecordAlert(true);
      if (recordAlertTimerRef.current !== null) {
        window.clearTimeout(recordAlertTimerRef.current);
      }
      recordAlertTimerRef.current = window.setTimeout(() => {
        recordAlertTimerRef.current = null;
        setNewRecordAlert(false);
      }, 2000);
    }

    if (newStreak > scores.bestStreak) {
      saveDrillScore(drillId, { bestStreak: newStreak });
    }

    // Calculate instantaneous cadence (CPM) with responsive blend
    if (lastCorrectTimeRef.current !== null) {
      const dt = Math.max(0.6, (now - lastCorrectTimeRef.current) / 1000);
      const instantRate = Math.min(65, Math.round(60 / dt));
      setCadence((prev) =>
        prev === 0 ? instantRate : Math.round(0.6 * instantRate + 0.4 * prev)
      );
    } else {
      setCadence(22);
    }
    lastCorrectTimeRef.current = now;
  }, [drillId, scores.best60s, scores.bestStreak, streak]);

  const recordMiss = useCallback(() => {
    const now = Date.now();
    activeTimerRef.current = recordIdleTimerActivity(activeTimerRef.current, now);
    attemptsRef.current += 1;
    setStreak(0);
  }, []);

  const heat = getHeatTier(cadence);
  const barPercent = Math.min(100, Math.round((cadence / 45) * 100));

  return {
    scores,
    current60s,
    sessionBest60s,
    cadence,
    streak,
    newRecordAlert,
    heat,
    barPercent,
    recordHit,
    recordMiss,
    flushSession,
  };
}
