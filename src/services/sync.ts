import { doc, getDoc, onSnapshot, setDoc, serverTimestamp, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import {
  loadSettings,
  saveSettings,
  loadCompletedQuoteIds,
  saveCompletedQuoteIds,
  loadAllOffsetsProgress,
  saveAllOffsetsProgress,
  loadOffsetsModeScores,
  saveOffsetsModeScore,
  loadCipherPracticeHistory,
  saveCipherPracticeHistory,
  registerSyncDispatcher,
  withoutSyncDispatch,
  type OffsetsProgress,
  type OffsetsProgressByMode,
  type OffsetsScoresByMode,
} from './storage';
import type { UserProfile, UserSettings, PublicProfile } from '../types';
import { upsertPublicProfile, normalizePublicProfile } from './profileService';

let activeSyncUnsubscribe: Unsubscribe | null = null;
let currentSyncedUid: string | null = null;
const syncListeners: Set<() => void> = new Set();

let pendingCloudUpdates: Partial<UserProfile> = {};
let cloudDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function sanitizeProgress(raw: unknown): OffsetsProgress {
  if (!raw || typeof raw !== 'object') return {};
  const clean: OffsetsProgress = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v && typeof v === 'object') {
      const item = v as { streak?: number; attempts?: number; correct?: number };
      clean[k] = {
        streak: typeof item.streak === 'number' ? item.streak : 0,
        attempts: typeof item.attempts === 'number' ? item.attempts : 0,
        correct: typeof item.correct === 'number' ? item.correct : 0,
      };
    }
  }
  return clean;
}

function normalizeOffsetsProgress(raw: unknown): OffsetsProgressByMode {
  if (!raw || typeof raw !== 'object') {
    return { letterToNum: {}, numToLetter: {} };
  }
  const obj = raw as Record<string, unknown>;
  if ('letterToNum' in obj || 'numToLetter' in obj) {
    return {
      letterToNum: sanitizeProgress(obj.letterToNum),
      numToLetter: sanitizeProgress(obj.numToLetter),
    };
  }
  return {
    letterToNum: sanitizeProgress(obj),
    numToLetter: {},
  };
}

function mergeLetterStats(localP: OffsetsProgress, cloudP: OffsetsProgress): OffsetsProgress {
  const cleanLocal = sanitizeProgress(localP);
  const cleanCloud = sanitizeProgress(cloudP);
  const merged: OffsetsProgress = { ...cleanCloud };

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

import { updateLeaderboardScore } from './leaderboard';

// Automatically wire local storage changes to debounced Firestore cloud updates
registerSyncDispatcher((type, data) => {
  if (!currentSyncedUid) return;
  switch (type) {
    case 'settings': {
      const s = data as UserSettings;
      pushCloudUpdate({ displayName: s.studentName, unlockedCiphers: s.unlockedCiphers });
      upsertPublicProfile(currentSyncedUid, { displayName: s.studentName });
      break;
    }
    case 'completedQuotes':
      pushCloudUpdate({ completedQuotes: data as number[] });
      break;
    case 'offsetsProgress':
      pushCloudUpdate({ offsetsProgress: data as OffsetsProgressByMode });
      break;
    case 'offsetsScores': {
      const scores = data as OffsetsScoresByMode;
      const currentSettings = loadSettings();
      if (scores.letterToNum && (scores.letterToNum.best60s > 0 || scores.letterToNum.bestStreak > 0)) {
        updateLeaderboardScore(
          currentSyncedUid,
          currentSettings.studentName,
          'letterToNum',
          scores.letterToNum.best60s,
          scores.letterToNum.bestStreak
        );
      }
      if (scores.numToLetter && (scores.numToLetter.best60s > 0 || scores.numToLetter.bestStreak > 0)) {
        updateLeaderboardScore(
          currentSyncedUid,
          currentSettings.studentName,
          'numToLetter',
          scores.numToLetter.best60s,
          scores.numToLetter.bestStreak
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
  const localOffsetsProgressByMode = loadAllOffsetsProgress();
  const localLetterToNum = loadOffsetsModeScores('letterToNum');
  const localNumToLetter = loadOffsetsModeScores('numToLetter');
  const localPracticeHistory = loadCipherPracticeHistory();

  // Smart Merge:
  // 1. Unlocked Ciphers: Union of local and cloud
  const cloudUnlocked = cloudData.unlockedCiphers ?? [];
  const mergedUnlocked = Array.from(new Set([...localSettings.unlockedCiphers, ...cloudUnlocked]));

  // 2. Completed Quotes: Union of stable IDs
  const cloudCompleted = cloudData.completedQuotes ?? [];
  const mergedCompleted = Array.from(new Set([...localCompleted, ...cloudCompleted]));

  // 3. Offsets Scores: Max scores across Local and Cloud Profile
  const profileL2N = profileData.offsetsScores?.letterToNum ?? { best60s: 0, bestStreak: 0 };
  const profileN2L = profileData.offsetsScores?.numToLetter ?? { best60s: 0, bestStreak: 0 };

  const mergedOffsetsScores: OffsetsScoresByMode = {
    letterToNum: {
      best60s: Math.max(localLetterToNum.best60s, profileL2N.best60s),
      bestStreak: Math.max(localLetterToNum.bestStreak, profileL2N.bestStreak),
    },
    numToLetter: {
      best60s: Math.max(localNumToLetter.best60s, profileN2L.best60s),
      bestStreak: Math.max(localNumToLetter.bestStreak, profileN2L.bestStreak),
    },
  };

  // 4. Offsets Progress: Merge per-letter stats per mode
  const cloudOffsetsProgressByMode = normalizeOffsetsProgress(cloudData.offsetsProgress);

  const mergedProgress: OffsetsProgressByMode = {
    letterToNum: mergeLetterStats(localOffsetsProgressByMode.letterToNum, cloudOffsetsProgressByMode.letterToNum),
    numToLetter: mergeLetterStats(localOffsetsProgressByMode.numToLetter, cloudOffsetsProgressByMode.numToLetter),
  };

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
    cloudData.displayName ||
    (localSettings.studentName !== 'Decoder' ? localSettings.studentName : (defaultName || 'Decoder'));

  // Update local storage with merged state (suppress sync broadcast to prevent loop)
  const updatedLocalSettings: UserSettings = {
    studentName: finalName,
    unlockedCiphers: mergedUnlocked,
  };

  withoutSyncDispatch(() => {
    saveSettings(updatedLocalSettings);
    saveAllOffsetsProgress(mergedProgress);
    saveOffsetsModeScore('letterToNum', mergedOffsetsScores.letterToNum);
    saveOffsetsModeScore('numToLetter', mergedOffsetsScores.numToLetter);
  });

  // Sync to Cloud User (private)
  await setDoc(
    userDocRef,
    {
      uid,
      email,
      displayName: finalName,
      unlockedCiphers: mergedUnlocked,
      completedQuotes: mergedCompleted,
      offsetsProgress: mergedProgress,
      practiceHistory: mergedHistory,
      lastActiveAt: serverTimestamp(),
    },
    { merge: true }
  );

  // Sync to Public Profile (public roster & leaderboards)
  const profilePayload: Partial<PublicProfile> = {
    displayName: finalName,
  };
  const hasScores =
    (mergedOffsetsScores.letterToNum && (mergedOffsetsScores.letterToNum.best60s > 0 || mergedOffsetsScores.letterToNum.bestStreak > 0)) ||
    (mergedOffsetsScores.numToLetter && (mergedOffsetsScores.numToLetter.best60s > 0 || mergedOffsetsScores.numToLetter.bestStreak > 0));

  if (hasScores) {
    profilePayload.offsetsScores = mergedOffsetsScores;
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
  const localL2N = loadOffsetsModeScores('letterToNum');
  const localN2L = loadOffsetsModeScores('numToLetter');
  if (localL2N.best60s > 0 || localL2N.bestStreak > 0) {
    updateLeaderboardScore(uid, localSettings.studentName, 'letterToNum', localL2N.best60s, localL2N.bestStreak).then(res => {
      if (res && (res.score > localL2N.best60s || res.bestStreak > localL2N.bestStreak)) {
        withoutSyncDispatch(() => {
          saveOffsetsModeScore('letterToNum', { best60s: res.score, bestStreak: res.bestStreak });
        });
        notifySyncListeners();
      }
    });
  }
  if (localN2L.best60s > 0 || localN2L.bestStreak > 0) {
    updateLeaderboardScore(uid, localSettings.studentName, 'numToLetter', localN2L.best60s, localN2L.bestStreak).then(res => {
      if (res && (res.score > localN2L.best60s || res.bestStreak > localN2L.bestStreak)) {
        withoutSyncDispatch(() => {
          saveOffsetsModeScore('numToLetter', { best60s: res.score, bestStreak: res.bestStreak });
        });
        notifySyncListeners();
      }
    });
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
      // Sync settings down to localStorage if actually changed
      if (data.displayName || data.unlockedCiphers) {
        const current = loadSettings();
        const targetName = data.displayName ?? current.studentName;
        const cloudCiphers = data.unlockedCiphers ?? [];
        const mergedCiphers = Array.from(new Set([...current.unlockedCiphers, ...cloudCiphers]));

        if (
          current.studentName !== targetName ||
          current.unlockedCiphers.length !== mergedCiphers.length
        ) {
          saveSettings({
            studentName: targetName,
            unlockedCiphers: mergedCiphers,
          });
          hasChanged = true;
        }
      }

      if (data.offsetsProgress) {
        const remoteProgress = normalizeOffsetsProgress(data.offsetsProgress);
        const currentProgress = loadAllOffsetsProgress();
        const mergedProgress: OffsetsProgressByMode = {
          letterToNum: mergeLetterStats(currentProgress.letterToNum, remoteProgress.letterToNum),
          numToLetter: mergeLetterStats(currentProgress.numToLetter, remoteProgress.numToLetter),
        };
        if (JSON.stringify(currentProgress) !== JSON.stringify(mergedProgress)) {
          saveAllOffsetsProgress(mergedProgress);
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
