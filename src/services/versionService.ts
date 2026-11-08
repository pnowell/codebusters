import {
  doc,
  getDocFromServer,
  onSnapshot,
  serverTimestamp,
  type FieldValue,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';

const CACHE_BUST_PARAM = '_v';
const CLASSROOM_CONFIG_COLLECTION = 'classroom_config';
const APP_VERSION_DOC_ID = 'app_version';
const MAX_CRITICAL_VERSION = 1_000_000;

export const CRITICAL_VERSION: number =
  typeof __CRITICAL_VERSION__ === 'number' &&
  Number.isSafeInteger(__CRITICAL_VERSION__) &&
  __CRITICAL_VERSION__ >= 0
    ? __CRITICAL_VERSION__
    : 0;

/**
 * Stamps any outgoing Firestore write payload with the client's compiled
 * `criticalVersion` and a server-evaluated `versionWriteAt` timestamp so
 * `firestore.rules` can reject writes from outdated or pre-versioned tabs.
 */
export function withVersionStamp<T extends Record<string, unknown>>(
  payload: T
): T & { criticalVersion: number; versionWriteAt: FieldValue } {
  return {
    ...payload,
    criticalVersion: CRITICAL_VERSION,
    versionWriteAt: serverTimestamp(),
  };
}

/**
 * Parses an untrusted `criticalVersion` value into a bounded non-negative safe integer,
 * returning `null` for malformed values so bad data fails safe without reload loops.
 */
export function parseCriticalVersion(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const floored = Math.floor(raw);
  if (!Number.isSafeInteger(floored) || floored < 0 || floored > MAX_CRITICAL_VERSION) {
    return null;
  }
  return floored;
}

/**
 * Returns `true` strictly when `remoteCriticalVersion` is a valid integer greater
 * than `loadedCriticalVersion`.
 */
export function isCriticalVersionOutdated(
  loadedCriticalVersion: number,
  remoteCriticalVersion: number
): boolean {
  const parsedLoaded = parseCriticalVersion(loadedCriticalVersion);
  const parsedRemote = parseCriticalVersion(remoteCriticalVersion);
  if (parsedLoaded === null || parsedRemote === null) return false;
  return parsedRemote > parsedLoaded;
}

/**
 * Strips any temporary `_v` cache-busting query parameter once the loaded
 * client meets the required `criticalVersion`.
 */
export function cleanupVersionCacheBustParam(): void {
  try {
    const currentUrl = new URL(window.location.href);
    if (!currentUrl.searchParams.has(CACHE_BUST_PARAM)) return;
    currentUrl.searchParams.delete(CACHE_BUST_PARAM);
    const nextRelativeUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
    window.history.replaceState(window.history.state, '', nextRelativeUrl);
  } catch {
    // Ignore URL parsing errors
  }
}

/**
 * Subscribes in real time to `/classroom_config/app_version` in Firestore so
 * bumping `criticalVersion` immediately notifies all open tabs (both signed-in
 * and Guest Mode).
 */
export function subscribeCriticalVersion(
  onUpdate: (remoteCriticalVersion: number) => void
): Unsubscribe {
  if (!db) {
    cleanupVersionCacheBustParam();
    return () => {};
  }

  let disposed = false;
  let activeUnsub: Unsubscribe | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (disposed || !db) return;
    activeUnsub = onSnapshot(
      doc(db, CLASSROOM_CONFIG_COLLECTION, APP_VERSION_DOC_ID),
      (snap) => {
        if (!snap.exists()) {
          onUpdate(0);
          return;
        }
        const raw = snap.data() as Record<string, unknown>;
        const parsed = parseCriticalVersion(raw.criticalVersion);
        if (parsed !== null) {
          onUpdate(parsed);
        }
      },
      () => {
        if (disposed) return;
        activeUnsub = null;
        retryTimer = setTimeout(connect, 5_000);
      }
    );
  };

  connect();

  return () => {
    disposed = true;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
    }
    activeUnsub?.();
  };
}

/**
 * Performs an explicit uncached Firestore check on `/classroom_config/app_version`
 * (used when a backgrounded tab wakes up or regains network connectivity).
 */
export async function fetchRemoteCriticalVersion(): Promise<number | null> {
  if (!db) return null;

  try {
    const snap = await getDocFromServer(
      doc(db, CLASSROOM_CONFIG_COLLECTION, APP_VERSION_DOC_ID)
    );
    if (!snap.exists()) return 0;
    const raw = snap.data() as Record<string, unknown>;
    return parseCriticalVersion(raw.criticalVersion);
  } catch {
    return null;
  }
}

/**
 * Refreshes the HTTP document cache for the current route and reloads the app
 * with a cache-busting parameter (cleaned up automatically after boot) so CDN
 * and school proxy caches immediately serve the updated bundle.
 */
export async function reloadForCriticalVersion(
  requiredCriticalVersion: number
): Promise<void> {
  const safeVersion = parseCriticalVersion(requiredCriticalVersion);

  try {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete(CACHE_BUST_PARAM);
    if (cleanUrl.origin === window.location.origin) {
      await fetch(cleanUrl.toString(), { cache: 'reload' });
    }
  } catch {
    // Proceed with navigation reload even if pre-fetch fails
  }

  if (safeVersion !== null) {
    const bustUrl = new URL(window.location.href);
    if (bustUrl.origin === window.location.origin) {
      bustUrl.searchParams.set(CACHE_BUST_PARAM, `${safeVersion}-${Date.now()}`);
      window.location.replace(bustUrl.toString());
      return;
    }
  }

  window.location.reload();
}
