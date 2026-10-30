import { doc, getDoc, onSnapshot, setDoc, serverTimestamp, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import {
  loadSettings,
  saveSettings,
  loadCompletedQuoteIds,
  saveCompletedQuoteIds,
  loadAllDrillProgress,
  saveAllDrillProgress,
  loadAllDrillScores,
  saveDrillScore,
  loadCipherPracticeHistory,
  saveCipherPracticeHistory,
  registerSyncDispatcher,
  withoutSyncDispatch,
  sanitizeProgressDict,
  type DrillProgressRecord,
  type DrillScoresRecord,
} from './storage';
import type { UserProfile, UserSettings, PublicProfile, DrillId, DrillScore, DrillProgress } from '../types';
import { upsertPublicProfile, normalizePublicProfile } from './profileService';
import { updateLeaderboardScore } from './leaderboard';

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
    case 'settings': {
      const s = data as UserSettings;
      pushCloudUpdate({ unlockedCiphers: s.unlockedCiphers });
      upsertPublicProfile(currentSyncedUid, { displayName: s.studentName });
      break;
    }
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
    case 'practiceHistory':
      pushCloudUpdate({ practiceHistory: data as Record<string, { count: number; lastPracticed: number }> });
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
 * Merges local storage data into the user's cloud Firestore document on sign-in
 */
export async function mergeAndInitializeCloudUser(uid: string, email: string, defaultName?: string): Promise<void> {
  if (!db) return;

  const userDocRef = doc(db, 'users', uid);
  const profileDocRef = doc(db, 'profiles', uid);

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
  const profileData = (profileSnap && profileSnap.exists()
    ? normalizePublicProfile(profileSnap.data() as Record<string, unknown>, uid)
    : {}) as Partial<PublicProfile>;

  const localSettings = loadSettings();
  const localCompleted = loadCompletedQuoteIds();
  const localDrillProgress = loadAllDrillProgress();
  const localDrillScores = loadAllDrillScores();
  const localPracticeHistory = loadCipherPracticeHistory();

  // Smart Merge:
  // 1. Unlocked Ciphers: Union of local and cloud
  const cloudUnlocked = cloudData.unlockedCiphers ?? [];
  const mergedUnlocked = Array.from(new Set([...localSettings.unlockedCiphers, ...cloudUnlocked]));

  // 2. Completed Quotes: Union of stable IDs
  const cloudCompleted = cloudData.completedQuotes ?? [];
  const mergedCompleted = Array.from(new Set([...localCompleted, ...cloudCompleted]));

  // 3. Drill Scores: Max scores across Local and Cloud Profile
  const profileScores = profileData.drillScores ?? {};
  const allScoreDrillIds = new Set([
    ...Object.keys(localDrillScores),
    ...Object.keys(profileScores),
  ]) as Set<DrillId>;

  const mergedDrillScores: DrillScoresRecord = {};
  for (const id of allScoreDrillIds) {
    const localS = localDrillScores[id] || { best60s: 0, bestStreak: 0 };
    const profS = profileScores[id] || { best60s: 0, bestStreak: 0 };
    mergedDrillScores[id] = {
      best60s: Math.max(localS.best60s, profS.best60s),
      bestStreak: Math.max(localS.bestStreak, profS.bestStreak),
    };
  }

  // 4. Drill Progress: Merge per-card stats per drill
  // Note: Letter arithmetic drills (letterAddition / letterSubtraction) do not track card-by-card progress
  const cloudDrillProgress = normalizeCloudDrillProgress(cloudData);
  const mergedProgress = mergeAllDrillProgress(localDrillProgress, cloudDrillProgress);

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

  // 6. Name: Profile customized name or local name
  const finalName =
    profileData.displayName ||
    (localSettings.studentName !== 'Decoder' ? localSettings.studentName : (defaultName || 'Decoder'));

  // Update local storage with merged state (suppress sync broadcast to prevent loop)
  const updatedLocalSettings: UserSettings = {
    studentName: finalName,
    unlockedCiphers: mergedUnlocked,
  };

  withoutSyncDispatch(() => {
    saveSettings(updatedLocalSettings);
    saveAllDrillProgress(mergedProgress);
    for (const [id, score] of Object.entries(mergedDrillScores)) {
      if (score) {
        saveDrillScore(id as DrillId, score);
      }
    }
  });

  // Sync to Cloud User (private)
  await setDoc(
    userDocRef,
    {
      uid,
      email,
      unlockedCiphers: mergedUnlocked,
      completedQuotes: mergedCompleted,
      drillProgress: mergedProgress,
      practiceHistory: mergedHistory,
      lastActiveAt: serverTimestamp(),
    },
    { merge: true }
  );

  // Sync to Public Profile (public roster & leaderboards)
  const profilePayload: Partial<PublicProfile> = {
    displayName: finalName,
  };
  const hasScores = Object.values(mergedDrillScores).some(
    (s) => s && (s.best60s > 0 || s.bestStreak > 0)
  );

  if (hasScores) {
    profilePayload.drillScores = mergedDrillScores;
  }

  await upsertPublicProfile(uid, profilePayload);

  notifySyncListeners();
}

/**
 * Starts real-time synchronization between Firestore and local storage for the logged-in user
 */
export function startCloudSync(uid: string): void {
  if (!db || currentSyncedUid === uid) return;

  stopCloudSync();
  currentSyncedUid = uid;

  // Immediately publish local scores to leaderboard (updateLeaderboardScore enforces Math.max)
  // and sync down any higher scores that may already exist on the leaderboard
  const localSettings = loadSettings();
  const allScores = loadAllDrillScores();
  for (const [drillIdKey, score] of Object.entries(allScores)) {
    const drillId = drillIdKey as DrillId;
    if (score && (score.best60s > 0 || score.bestStreak > 0)) {
      updateLeaderboardScore(uid, localSettings.studentName, drillId, score.best60s, score.bestStreak).then(res => {
        if (res && (res.score > score.best60s || res.bestStreak > score.bestStreak)) {
          withoutSyncDispatch(() => {
            saveDrillScore(drillId, { best60s: res.score, bestStreak: res.bestStreak });
          });
          notifySyncListeners();
        }
      });
    }
  }

  const userDocRef = doc(db, 'users', uid);
  activeSyncUnsubscribe = onSnapshot(userDocRef, (snap) => {
    // 1. Ignore local writes echoing back to prevent infinite loop
    if (snap.metadata.hasPendingWrites) return;
    if (!snap.exists()) return;

    const data = snap.data() as Partial<UserProfile>;
    let hasChanged = false;

    // 2. Suppress outbound sync while applying inbound remote updates
    withoutSyncDispatch(() => {
      // Sync unlocked ciphers down to localStorage if actually changed
      if (data.unlockedCiphers) {
        const current = loadSettings();
        const cloudCiphers = data.unlockedCiphers ?? [];
        const mergedCiphers = Array.from(new Set([...current.unlockedCiphers, ...cloudCiphers]));

        if (current.unlockedCiphers.length !== mergedCiphers.length) {
          saveSettings({
            ...current,
            unlockedCiphers: mergedCiphers,
          });
          hasChanged = true;
        }
      }

      if (data.drillProgress) {
        const remoteProgress = normalizeCloudDrillProgress(data);
        const currentProgress = loadAllDrillProgress();
        const mergedProgress = mergeAllDrillProgress(currentProgress, remoteProgress);
        if (JSON.stringify(currentProgress) !== JSON.stringify(mergedProgress)) {
          saveAllDrillProgress(mergedProgress);
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
 * Pushes updated user data to cloud with 400ms debounce to prevent high-frequency write loops
 */
export function pushCloudUpdate(partial: Partial<UserProfile>): void {
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
      await setDoc(userDocRef, { ...toWrite, lastActiveAt: serverTimestamp() }, { merge: true });
    } catch (err) {
      console.warn('[Sync] Failed to push update to cloud:', err);
    }
  }, 400);
}
