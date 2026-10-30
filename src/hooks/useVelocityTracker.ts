import { useState, useEffect, useRef, useCallback } from 'react';
import { loadDrillScore, saveDrillScore } from '../services/storage';
import type { DrillId, DrillScore } from '../types';

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

export function useVelocityTracker(drillId: DrillId) {
  const [scores, setScores] = useState<DrillScore>(() => loadDrillScore(drillId));
  const [current60s, setCurrent60s] = useState<number>(0);
  const [sessionBest60s, setSessionBest60s] = useState<number>(0);
  const [cadence, setCadence] = useState<number>(0);
  const [streak, setStreak] = useState<number>(0);
  const [newRecordAlert, setNewRecordAlert] = useState<boolean>(false);

  const correctTimestampsRef = useRef<number[]>([]);
  const lastCorrectTimeRef = useRef<number | null>(null);
  const recordAlertTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (recordAlertTimerRef.current !== null) {
        window.clearTimeout(recordAlertTimerRef.current);
      }
    };
  }, []);

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
    const newStreak = streak + 1;
    setStreak(newStreak);

    // Record timestamp for 60s Blitz
    correctTimestampsRef.current.push(now);
    const updated60s = correctTimestampsRef.current.filter((t) => now - t <= 60000).length;
    setCurrent60s(updated60s);
    setSessionBest60s((prev) => Math.max(prev, updated60s));

    // High Score checks
    if (updated60s > scores.best60s) {
      const updated = saveDrillScore(drillId, { best60s: updated60s });
      setScores((prev) => ({ ...prev, best60s: updated.best60s }));
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
      const updated = saveDrillScore(drillId, { bestStreak: newStreak });
      setScores((prev) => ({ ...prev, bestStreak: updated.bestStreak }));
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
  };
}
