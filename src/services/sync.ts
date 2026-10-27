import { doc, getDoc, onSnapshot, setDoc, serverTimestamp, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import {
  loadSettings,
  saveSettings,
  loadCompletedQuoteIds,
  loadOffsetsProgress,
  saveOffsetsProgress,
  loadOffsetsModeScores,
  saveOffsetsModeScore,
  loadCipherPracticeHistory,
  registerSyncDispatcher,
  type OffsetsProgress,
  type OffsetsScoresByMode,
} from './storage';
import type { UserProfile, UserSettings } from '../types';

let activeSyncUnsubscribe: Unsubscribe | null = null;
let currentSyncedUid: string | null = null;
const syncListeners: Set<() => void> = new Set();

// Automatically wire local storage changes to Firestore cloud updates
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
      pushCloudUpdate({ offsetsProgress: data as OffsetsProgress });
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
  const localOffsetsProgress = loadOffsetsProgress();
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

  // 4. Offsets Progress: Merge per-letter stats
  const cloudProgress = (cloudData.offsetsProgress ?? {}) as OffsetsProgress;
  const mergedProgress: OffsetsProgress = { ...cloudProgress };
  for (const [char, localStat] of Object.entries(localOffsetsProgress)) {
    const cloudStat = mergedProgress[char];
    if (!cloudStat) {
      mergedProgress[char] = localStat;
    } else {
      mergedProgress[char] = {
        attempts: Math.max(localStat.attempts, cloudStat.attempts),
        correct: Math.max(localStat.correct, cloudStat.correct),
        streak: Math.max(localStat.streak, cloudStat.streak),
      };
    }
  }

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

  // Update local storage with merged state
  const updatedLocalSettings: UserSettings = {
    studentName: finalName,
    unlockedCiphers: mergedUnlocked,
  };
  saveSettings(updatedLocalSettings);
  saveOffsetsProgress(mergedProgress);
  saveOffsetsModeScore('letterToNum', mergedOffsetsScores.letterToNum);
  saveOffsetsModeScore('numToLetter', mergedOffsetsScores.numToLetter);

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
    if (!snap.exists()) return;
    const data = snap.data() as Partial<UserProfile>;

    // Sync settings down to localStorage if changed
    if (data.displayName || data.unlockedCiphers) {
      const current = loadSettings();
      const newSettings: UserSettings = {
        studentName: data.displayName ?? current.studentName,
        unlockedCiphers: data.unlockedCiphers ?? current.unlockedCiphers,
      };
      saveSettings(newSettings);
    }

    if (data.offsetsProgress) {
      saveOffsetsProgress(data.offsetsProgress as OffsetsProgress);
    }

    if (data.offsetsScores) {
      if (data.offsetsScores.letterToNum) {
        saveOffsetsModeScore('letterToNum', data.offsetsScores.letterToNum);
      }
      if (data.offsetsScores.numToLetter) {
        saveOffsetsModeScore('numToLetter', data.offsetsScores.numToLetter);
      }
    }

    notifySyncListeners();
  });
}

/**
 * Stops cloud synchronization
 */
export function stopCloudSync(): void {
  if (activeSyncUnsubscribe) {
    activeSyncUnsubscribe();
    activeSyncUnsubscribe = null;
  }
  currentSyncedUid = null;
}

/**
 * Pushes updated user data to cloud if currently signed in
 */
export async function pushCloudUpdate(partial: Partial<UserProfile>): Promise<void> {
  if (!db || !currentSyncedUid) return;
  try {
    const userDocRef = doc(db, 'users', currentSyncedUid);
    await setDoc(userDocRef, { ...partial, lastActiveAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    console.warn('[Sync] Failed to push update to cloud:', err);
  }
}
