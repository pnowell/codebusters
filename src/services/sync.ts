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
import type { UserProfile, UserSettings } from '../types';

let activeSyncUnsubscribe: Unsubscribe | null = null;
let currentSyncedUid: string | null = null;
const syncListeners: Set<() => void> = new Set();

let pendingCloudUpdates: Partial<UserProfile> = {};
let cloudDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeOffsetsProgress(raw: unknown): OffsetsProgressByMode {
  if (!raw || typeof raw !== 'object') {
    return { letterToNum: {}, numToLetter: {} };
  }
  const obj = raw as Record<string, unknown>;
  if ('letterToNum' in obj || 'numToLetter' in obj) {
    return {
      letterToNum: (obj.letterToNum as OffsetsProgress) || {},
      numToLetter: (obj.numToLetter as OffsetsProgress) || {},
    };
  }
  return {
    letterToNum: obj as OffsetsProgress,
    numToLetter: {},
  };
}

// Automatically wire local storage changes to debounced Firestore cloud updates
registerSyncDispatcher((type, data) => {
  if (!currentSyncedUid) return;
  switch (type) {
    case 'settings': {
      const s = data as UserSettings;
      pushCloudUpdate({ displayName: s.studentName, unlockedCiphers: s.unlockedCiphers });
      break;
    }
    case 'completedQuotes':
      pushCloudUpdate({ completedQuotes: data as number[] });
      break;
    case 'offsetsProgress':
      pushCloudUpdate({ offsetsProgress: data as OffsetsProgressByMode });
      break;
    case 'offsetsScores': {
      pushCloudUpdate({ offsetsScores: data as OffsetsScoresByMode });
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
  const snap = await getDoc(userDocRef);
  const cloudData = (snap.exists() ? snap.data() : {}) as Partial<UserProfile>;

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

  // 3. Offsets Scores: Max scores
  const cloudLetterToNum = cloudData.offsetsScores?.letterToNum ?? { best60s: 0, bestStreak: 0 };
  const cloudNumToLetter = cloudData.offsetsScores?.numToLetter ?? { best60s: 0, bestStreak: 0 };

  const mergedOffsetsScores: OffsetsScoresByMode = {
    letterToNum: {
      best60s: Math.max(localLetterToNum.best60s, cloudLetterToNum.best60s),
      bestStreak: Math.max(localLetterToNum.bestStreak, cloudLetterToNum.bestStreak),
    },
    numToLetter: {
      best60s: Math.max(localNumToLetter.best60s, cloudNumToLetter.best60s),
      bestStreak: Math.max(localNumToLetter.bestStreak, cloudNumToLetter.bestStreak),
    },
  };

  // 4. Offsets Progress: Merge per-letter stats per mode
  const cloudOffsetsProgressByMode = normalizeOffsetsProgress(cloudData.offsetsProgress);

  const mergeLetterStats = (localP: OffsetsProgress, cloudP: OffsetsProgress): OffsetsProgress => {
    const merged: OffsetsProgress = { ...cloudP };
    for (const [char, localStat] of Object.entries(localP)) {
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
  };

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

  // 6. Name: Cloud customized name or local name
  const finalName = cloudData.displayName || (localSettings.studentName !== 'Decoder' ? localSettings.studentName : (defaultName || 'Decoder'));

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

  // Sync to Cloud
  await setDoc(
    userDocRef,
    {
      uid,
      email,
      displayName: finalName,
      unlockedCiphers: mergedUnlocked,
      completedQuotes: mergedCompleted,
      offsetsScores: mergedOffsetsScores,
      offsetsProgress: mergedProgress,
      practiceHistory: mergedHistory,
      lastActiveAt: serverTimestamp(),
    },
    { merge: true }
  );

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
      // Sync settings down to localStorage if actually changed
      if (data.displayName || data.unlockedCiphers) {
        const current = loadSettings();
        const targetName = data.displayName ?? current.studentName;
        const targetCiphers = data.unlockedCiphers ?? current.unlockedCiphers;

        if (
          current.studentName !== targetName ||
          current.unlockedCiphers.join(',') !== targetCiphers.join(',')
        ) {
          saveSettings({
            studentName: targetName,
            unlockedCiphers: targetCiphers,
          });
          hasChanged = true;
        }
      }

      if (data.offsetsProgress) {
        const remoteProgress = normalizeOffsetsProgress(data.offsetsProgress);
        const currentProgress = loadAllOffsetsProgress();
        if (JSON.stringify(currentProgress) !== JSON.stringify(remoteProgress)) {
          saveAllOffsetsProgress(remoteProgress);
          hasChanged = true;
        }
      }

      if (data.offsetsScores) {
        if (data.offsetsScores.letterToNum) {
          const cur = loadOffsetsModeScores('letterToNum');
          if (
            cur.best60s !== data.offsetsScores.letterToNum.best60s ||
            cur.bestStreak !== data.offsetsScores.letterToNum.bestStreak
          ) {
            saveOffsetsModeScore('letterToNum', data.offsetsScores.letterToNum);
            hasChanged = true;
          }
        }
        if (data.offsetsScores.numToLetter) {
          const cur = loadOffsetsModeScores('numToLetter');
          if (
            cur.best60s !== data.offsetsScores.numToLetter.best60s ||
            cur.bestStreak !== data.offsetsScores.numToLetter.bestStreak
          ) {
            saveOffsetsModeScore('numToLetter', data.offsetsScores.numToLetter);
            hasChanged = true;
          }
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
        if (JSON.stringify(current) !== JSON.stringify(data.practiceHistory)) {
          saveCipherPracticeHistory(data.practiceHistory as Record<string, { count: number; lastPracticed: number }>);
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
