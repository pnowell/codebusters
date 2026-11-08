import { doc, getDoc, onSnapshot, setDoc, updateDoc, serverTimestamp, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import {
  loadSettings,
  saveSettings,
  loadCompletedQuoteIds,
  saveCompletedQuoteIds,
  loadAllDrillProgress,
  saveAllDrillProgress,
  loadAllDrillScores,
  replaceAllDrillScores,
  loadAllDrillHistory,
  saveAllDrillHistory,
  sanitizeDrillHistoryRecord,
  MAX_RECENT_DRILL_SESSIONS,
  loadCipherPracticeHistory,
  saveCipherPracticeHistory,
  loadQuoteBrowserPrefsMap,
  saveQuoteBrowserPrefsMap,
  sanitizeQuoteBrowserPrefsMap,
  registerSyncDispatcher,
  withoutSyncDispatch,
  sanitizeProgressDict,
  clearAllLocalUserData,
  getLocalOwnerUid,
  setLocalOwnerUid,
  type DrillProgressRecord,
  type DrillScoresRecord,
  type DrillHistoryRecord,
} from './storage';
import type {
  UserProfile,
  UserSettings,
  PublicProfile,
  DrillId,
  DrillScore,
  DrillProgress,
  DrillSessionSample,
  QuoteBrowserPrefsMap,
} from '../types';
import {
  upsertPublicProfile,
  normalizePublicProfile,
  clearProfilesCache,
} from './profileService';
import { updateLeaderboardScore } from './leaderboard';
import { withVersionStamp } from './versionService';

let activeSyncUnsubscribe: Unsubscribe | null = null;
let currentSyncedUid: string | null = null;
const syncListeners: Set<() => void> = new Set();

let pendingCloudUpdates: Partial<UserProfile> = {};
let cloudDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function mergeLetterStats(localP: DrillProgress, cloudP: DrillProgress): DrillProgress {
  const cleanLocal = sanitizeProgressDict(localP);
  const cleanCloud = sanitizeProgressDict(cloudP);
  const merged: DrillProgress = { ...cleanCloud };

  for (const [char, localStat] of Object.entries(cleanLocal)) {
    const cloudStat = merged[char];
    if (!cloudStat) {
      merged[char] = localStat;
    } else {
      merged[char] = {
        attempts: Math.max(localStat.attempts, cloudStat.attempts),
        correct: Math.max(localStat.correct, cloudStat.correct),
        streak: Math.max(localStat.streak, cloudStat.streak),
      };
    }
  }
  return merged;
}

function mergeAllDrillProgress(
  localAll: DrillProgressRecord,
  cloudAll: DrillProgressRecord
): DrillProgressRecord {
  const allKeys = new Set([...Object.keys(localAll), ...Object.keys(cloudAll)]) as Set<DrillId>;
  const merged: DrillProgressRecord = {};
  for (const key of allKeys) {
    merged[key] = mergeLetterStats(localAll[key] || {}, cloudAll[key] || {});
  }
  return merged;
}

function mergeAllDrillHistory(
  localAll: DrillHistoryRecord,
  cloudAll: DrillHistoryRecord
): DrillHistoryRecord {
  const allKeys = new Set([...Object.keys(localAll), ...Object.keys(cloudAll)]) as Set<DrillId>;
  const merged: DrillHistoryRecord = {};

  for (const key of allKeys) {
    const localEntry = localAll[key] || { recentSessions: [], lastPracticed: 0 };
    const cloudEntry = cloudAll[key] || { recentSessions: [], lastPracticed: 0 };

    const byTimestamp = new Map<number, DrillSessionSample>();
    for (const s of cloudEntry.recentSessions) {
      byTimestamp.set(s.timestamp, s);
    }
    for (const s of localEntry.recentSessions) {
      const existing = byTimestamp.get(s.timestamp);
      if (!existing || s.score60s > existing.score60s) {
        byTimestamp.set(s.timestamp, s);
      }
    }

    const combinedSessions = Array.from(byTimestamp.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-MAX_RECENT_DRILL_SESSIONS);

    const latestSessionTs =
      combinedSessions.length > 0 ? combinedSessions[combinedSessions.length - 1].timestamp : 0;
    const lastPracticed = Math.max(
      localEntry.lastPracticed,
      cloudEntry.lastPracticed,
      latestSessionTs
    );

    if (lastPracticed > 0 || combinedSessions.length > 0) {
      merged[key] = {
        recentSessions: combinedSessions,
        lastPracticed,
      };
    }
  }

  return merged;
}

function normalizeCloudDrillProgress(data: Partial<UserProfile>): DrillProgressRecord {
  const result: DrillProgressRecord = {};
  if (data.drillProgress && typeof data.drillProgress === 'object') {
    for (const [k, v] of Object.entries(data.drillProgress as Record<string, unknown>)) {
      result[k as DrillId] = sanitizeProgressDict(v);
    }
  }
  return result;
}

// Automatically wire local storage changes to debounced Firestore cloud updates
registerSyncDispatcher((type, data) => {
  if (!currentSyncedUid) return;
  switch (type) {
    case 'completedQuotes':
      pushCloudUpdate({ completedQuotes: data as number[] });
      break;
    case 'drillProgress':
      pushCloudUpdate({ drillProgress: data as DrillProgressRecord });
      break;
    case 'drillScores': {
      const payload = data as { drillId: DrillId; score: DrillScore; allScores: DrillScoresRecord };
      const currentSettings = loadSettings();
      if (payload.score && (payload.score.best60s > 0 || payload.score.bestStreak > 0)) {
        updateLeaderboardScore(
          currentSyncedUid,
          currentSettings.studentName,
          payload.drillId,
          payload.score.best60s,
          payload.score.bestStreak
        );
      }
      break;
    }
    case 'drillHistory':
      pushCloudUpdate({ drillHistory: data as DrillHistoryRecord });
      break;
    case 'practiceHistory':
      pushCloudUpdate({ practiceHistory: data as Record<string, { count: number; lastPracticed: number }> });
      break;
    case 'quoteBrowserPrefs':
      pushCloudUpdate({ quoteBrowserPrefs: data as QuoteBrowserPrefsMap });
      break;
  }
});

export const subscribeToSyncUpdates = (callback: () => void): (() => void) => {
  syncListeners.add(callback);
  return () => syncListeners.delete(callback);
};

const notifySyncListeners = () => {
  syncListeners.forEach(fn => {
    try {
      fn();
    } catch (e) {
      console.error('[Sync] Listener error:', e);
    }
  });
};

/**
 * Stamps `/users/{uid}` with the client's `criticalVersion` first (so `firestore.rules`
 * grants read access), then merges private drill history into `/users/{uid}` while
 * treating `/profiles/{uid}.drillScores` as authoritative over `localStorage`.
 */
export async function mergeAndInitializeCloudUser(
  uid: string,
  email: string,
  defaultName?: string,
  role: PublicProfile['role'] = 'student'
): Promise<void> {
  if (!db) return;

  // Defense-in-depth: if localStorage still holds data from a different signed-in account,
  // wipe it before reading so one user's stats/name can never merge into another user's profile.
  const previousOwnerUid = getLocalOwnerUid();
  if (previousOwnerUid && previousOwnerUid !== uid) {
    withoutSyncDispatch(() => {
      clearAllLocalUserData();
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const userDocRef = doc(db, 'users', uid);
  const profileDocRef = doc(db, 'profiles', uid);

  // Stamp /users/{uid}.criticalVersion BEFORE any read so firestore.rules hasValidReadVersion()
  // succeeds for this session (and rejects outdated clients immediately).
  await setDoc(
    userDocRef,
    withVersionStamp({
      uid,
      email: normalizedEmail,
    }),
    { merge: true }
  );

  const [snap, profileSnap] = await Promise.all([
    getDoc(userDocRef).catch((err) => {
      console.warn('[Sync] Failed to read user doc:', err);
      return null;
    }),
    getDoc(profileDocRef).catch((err) => {
      console.warn('[Sync] Failed to read profile doc (check Firestore rules if permission-denied):', err);
      return null;
    }),
  ]);

  const cloudData = (snap && snap.exists() ? snap.data() : {}) as Partial<UserProfile>;
  const profileExists = Boolean(profileSnap && profileSnap.exists());
  const rawProfileData =
    profileSnap && profileSnap.exists()
      ? (profileSnap.data() as Record<string, unknown>)
      : null;
  const profileData = (rawProfileData
    ? normalizePublicProfile(rawProfileData, uid)
    : {}) as Partial<PublicProfile>;

  const localCompleted = loadCompletedQuoteIds();
  const localDrillProgress = loadAllDrillProgress();
  const localDrillScores = loadAllDrillScores();
  const localDrillHistory = loadAllDrillHistory();
  const localPracticeHistory = loadCipherPracticeHistory();
  const localQuoteBrowserPrefs = loadQuoteBrowserPrefsMap();

  // Smart Merge:
  // 1. Completed Quotes: Union of stable IDs
  const cloudCompleted = cloudData.completedQuotes ?? [];
  const mergedCompleted = Array.from(new Set([...localCompleted, ...cloudCompleted]));

  // 2. Drill Scores: Once /profiles/{uid} exists in Firestore (or localStorage already belonged
  //    to this cloud account), /profiles/{uid}.drillScores is strictly authoritative so manual
  //    resets/edits in the Firestore Web Console are never overwritten by localStorage.
  //    Local scores only seed /profiles/{uid} when upgrading an anonymous Guest Mode session
  //    to a brand-new cloud profile for the very first time.
  const shouldSeedScoresFromGuest =
    profileSnap !== null && !profileExists && !previousOwnerUid;
  const authoritativeScores: DrillScoresRecord | null =
    profileSnap === null
      ? null
      : profileExists
        ? (profileData.drillScores ?? {})
        : shouldSeedScoresFromGuest
          ? localDrillScores
          : {};

  // 3. Drill Progress: Merge per-card stats per drill
  const cloudDrillProgress = normalizeCloudDrillProgress(cloudData);
  const mergedProgress = mergeAllDrillProgress(localDrillProgress, cloudDrillProgress);

  // 4. Drill History: Merge rolling recent 60s sessions & lastPracticed timestamps
  const cloudDrillHistory = sanitizeDrillHistoryRecord(cloudData.drillHistory);
  const mergedDrillHistory = mergeAllDrillHistory(localDrillHistory, cloudDrillHistory);

  // 5. Practice History: Combine counts
  const cloudHistory = cloudData.practiceHistory ?? {};
  const mergedHistory: Record<string, { count: number; lastPracticed: number }> = { ...cloudHistory };
  for (const [cipher, stat] of Object.entries(localPracticeHistory)) {
    const existing = mergedHistory[cipher];
    if (!existing) {
      mergedHistory[cipher] = stat;
    } else {
      mergedHistory[cipher] = {
        count: Math.max(stat.count, existing.count),
        lastPracticed: Math.max(stat.lastPracticed, existing.lastPracticed),
      };
    }
  }

  // 5b. Quote Browser Filter Preferences: Cloud fallback + local overrides
  const cloudQuoteBrowserPrefs = sanitizeQuoteBrowserPrefsMap(cloudData.quoteBrowserPrefs);
  const mergedQuoteBrowserPrefs: QuoteBrowserPrefsMap = {
    ...cloudQuoteBrowserPrefs,
    ...localQuoteBrowserPrefs,
  };
  const hasQuoteBrowserPrefs = Object.keys(mergedQuoteBrowserPrefs).length > 0;

  // 6. Name: Existing /profiles/{uid} displayName -> seed from /allowed_users displayName on first login -> 'Decoder'
  const existingProfileName =
    rawProfileData &&
    typeof rawProfileData.displayName === 'string' &&
    rawProfileData.displayName.trim().length > 0
      ? rawProfileData.displayName.trim()
      : undefined;
  const cleanDefaultName =
    defaultName && defaultName.trim().length > 0
      ? defaultName.trim()
      : undefined;
  const finalName = existingProfileName || cleanDefaultName || 'Decoder';

  // Update local storage with merged state (suppress sync broadcast to prevent loop)
  const updatedLocalSettings: UserSettings = {
    studentName: finalName,
  };

  withoutSyncDispatch(() => {
    setLocalOwnerUid(uid);
    saveSettings(updatedLocalSettings);
    saveCompletedQuoteIds(mergedCompleted);
    saveCipherPracticeHistory(mergedHistory);
    saveAllDrillProgress(mergedProgress);
    saveAllDrillHistory(mergedDrillHistory);
    if (hasQuoteBrowserPrefs) {
      saveQuoteBrowserPrefsMap(mergedQuoteBrowserPrefs);
    }
    if (authoritativeScores !== null) {
      replaceAllDrillScores(authoritativeScores);
    }
  });

  // Sync to Cloud User (private)
  await setDoc(
    userDocRef,
    withVersionStamp({
      uid,
      email: normalizedEmail,
      completedQuotes: mergedCompleted,
      drillProgress: mergedProgress,
      drillHistory: mergedDrillHistory,
      practiceHistory: mergedHistory,
      ...(hasQuoteBrowserPrefs ? { quoteBrowserPrefs: mergedQuoteBrowserPrefs } : {}),
      lastActiveAt: serverTimestamp(),
    }),
    { merge: true }
  );

  // Sync to Public Profile (public roster & leaderboards)
  // Seed displayName & role only when creating /profiles/{uid} (or if displayName was missing),
  // and seed drillScores ONLY when creating a brand-new profile from Guest Mode.
  const profilePayload: Partial<PublicProfile> = {};
  if (profileSnap !== null && !existingProfileName) {
    profilePayload.displayName = finalName;
    profilePayload.role = role;
  }
  if (shouldSeedScoresFromGuest && authoritativeScores) {
    const hasGuestScores = Object.values(authoritativeScores).some(
      (s) => s && (s.best60s > 0 || s.bestStreak > 0)
    );
    if (hasGuestScores) {
      profilePayload.drillScores = authoritativeScores;
    }
  }

  if (Object.keys(profilePayload).length > 0) {
    await upsertPublicProfile(uid, profilePayload);
  }

  notifySyncListeners();
}

/**
 * Starts real-time synchronization between Firestore and local storage for the logged-in user
 */
export function startCloudSync(uid: string): void {
  if (!db || currentSyncedUid === uid) return;

  stopCloudSync();
  currentSyncedUid = uid;

  const userDocRef = doc(db, 'users', uid);
  activeSyncUnsubscribe = onSnapshot(userDocRef, (snap) => {
    // 1. Ignore local writes echoing back to prevent infinite loop
    if (snap.metadata.hasPendingWrites) return;
    if (!snap.exists()) return;

    const data = snap.data() as Partial<UserProfile>;
    let hasChanged = false;

    // 2. Suppress outbound sync while applying inbound remote updates
    withoutSyncDispatch(() => {
      if (data.drillProgress) {
        const remoteProgress = normalizeCloudDrillProgress(data);
        const currentProgress = loadAllDrillProgress();
        if (JSON.stringify(currentProgress) !== JSON.stringify(remoteProgress)) {
          saveAllDrillProgress(remoteProgress);
          hasChanged = true;
        }
      }

      if (data.drillHistory) {
        const remoteHistory = sanitizeDrillHistoryRecord(data.drillHistory);
        const currentHistory = loadAllDrillHistory();
        const mergedHistory = mergeAllDrillHistory(currentHistory, remoteHistory);
        if (JSON.stringify(currentHistory) !== JSON.stringify(mergedHistory)) {
          saveAllDrillHistory(mergedHistory);
          hasChanged = true;
        }
      }

      if (data.completedQuotes && Array.isArray(data.completedQuotes)) {
        const current = loadCompletedQuoteIds();
        const hasNew = data.completedQuotes.some(id => !current.includes(id));
        if (hasNew) {
          saveCompletedQuoteIds(data.completedQuotes);
          hasChanged = true;
        }
      }

      if (data.practiceHistory) {
        const current = loadCipherPracticeHistory();
        let historyChanged = false;
        const mergedHistory: Record<string, { count: number; lastPracticed: number }> = { ...current };
        for (const [cipher, stat] of Object.entries(data.practiceHistory)) {
          const existing = mergedHistory[cipher];
          if (!existing) {
            mergedHistory[cipher] = stat;
            historyChanged = true;
          } else {
            const count = Math.max(existing.count, stat.count);
            const lastPracticed = Math.max(existing.lastPracticed, stat.lastPracticed);
            if (count !== existing.count || lastPracticed !== existing.lastPracticed) {
              mergedHistory[cipher] = { count, lastPracticed };
              historyChanged = true;
            }
          }
        }
        if (historyChanged) {
          saveCipherPracticeHistory(mergedHistory);
          hasChanged = true;
        }
      }

      if (data.quoteBrowserPrefs) {
        const remotePrefs = sanitizeQuoteBrowserPrefsMap(data.quoteBrowserPrefs);
        const currentPrefs = loadQuoteBrowserPrefsMap();
        if (JSON.stringify(currentPrefs) !== JSON.stringify(remotePrefs)) {
          saveQuoteBrowserPrefsMap(remotePrefs);
          hasChanged = true;
        }
      }
    });

    if (hasChanged) {
      notifySyncListeners();
    }
  });
}

/**
 * Stops cloud synchronization and clears pending debounced writes
 */
export function stopCloudSync(): void {
  if (activeSyncUnsubscribe) {
    activeSyncUnsubscribe();
    activeSyncUnsubscribe = null;
  }
  if (cloudDebounceTimer) {
    clearTimeout(cloudDebounceTimer);
    cloudDebounceTimer = null;
  }
  pendingCloudUpdates = {};
  currentSyncedUid = null;
}

/**
 * Stops cloud sync, clears cached profiles and all `davinci_*` localStorage data,
 * and notifies listeners so UI state resets cleanly on logout.
 */
export function resetClientSessionState(): void {
  stopCloudSync();
  clearProfilesCache();
  withoutSyncDispatch(() => {
    clearAllLocalUserData();
  });
  notifySyncListeners();
}

/**
 * Pushes updated user data to cloud with 400ms debounce to prevent high-frequency write loops
 */
function pushCloudUpdate(partial: Partial<UserProfile>): void {
  if (!db || !currentSyncedUid) return;

  pendingCloudUpdates = { ...pendingCloudUpdates, ...partial };

  if (cloudDebounceTimer) {
    clearTimeout(cloudDebounceTimer);
  }

  cloudDebounceTimer = setTimeout(async () => {
    if (!db || !currentSyncedUid) return;
    const toWrite = { ...pendingCloudUpdates };
    pendingCloudUpdates = {};
    cloudDebounceTimer = null;

    try {
      const userDocRef = doc(db, 'users', currentSyncedUid);
      const stampedPayload = withVersionStamp({
        ...toWrite,
        lastActiveAt: serverTimestamp(),
      });
      if (toWrite.drillProgress) {
        try {
          await updateDoc(userDocRef, stampedPayload);
        } catch {
          await setDoc(userDocRef, stampedPayload, { merge: true });
        }
      } else {
        await setDoc(userDocRef, stampedPayload, { merge: true });
      }
    } catch (err) {
      console.warn('[Sync] Failed to push update to cloud:', err);
    }
  }, 400);
}
