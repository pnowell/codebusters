import { useState, useEffect, useCallback, useRef } from 'react';
import {
  CRITICAL_VERSION,
  cleanupVersionCacheBustParam,
  fetchRemoteCriticalVersion,
  isCriticalVersionOutdated,
  subscribeCriticalVersion,
} from '../services/versionService';

const MIN_WAKE_CHECK_GAP_MS = 5_000;

/**
 * Subscribes in real time to `/classroom_config/app_version` (and re-verifies
 * when waking from background sleep or regaining network connectivity) to ensure
 * the loaded client meets the required `criticalVersion` sentinel.
 *
 * Returns the required `criticalVersion` number when outdated, or `null` when current.
 */
export function useRequiredVersion(): number | null {
  const [requiredCriticalVersion, setRequiredCriticalVersion] = useState<number | null>(
    null
  );
  const inFlightRef = useRef<boolean>(false);
  const lastCheckAtRef = useRef<number>(0);

  const applyRemoteVersion = useCallback((remoteVersion: number) => {
    if (isCriticalVersionOutdated(CRITICAL_VERSION, remoteVersion)) {
      setRequiredCriticalVersion((prev) =>
        prev !== null ? Math.max(prev, remoteVersion) : remoteVersion
      );
    } else {
      cleanupVersionCacheBustParam();
    }
  }, []);

  // Real-time Firestore listener on /classroom_config/app_version
  useEffect(() => {
    return subscribeCriticalVersion(applyRemoteVersion);
  }, [applyRemoteVersion]);

  // Re-verify directly from server when waking a suspended tab or regaining connectivity
  useEffect(() => {
    const runWakeCheck = async (force = false) => {
      if (inFlightRef.current) return;

      const now = Date.now();
      if (!force && now - lastCheckAtRef.current < MIN_WAKE_CHECK_GAP_MS) {
        return;
      }

      inFlightRef.current = true;
      lastCheckAtRef.current = now;
      try {
        const remoteVersion = await fetchRemoteCriticalVersion();
        if (remoteVersion === null) return;
        applyRemoteVersion(remoteVersion);
      } finally {
        inFlightRef.current = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runWakeCheck();
      }
    };
    const handleOnline = () => {
      void runWakeCheck(true);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [applyRemoteVersion]);

  return requiredCriticalVersion;
}
