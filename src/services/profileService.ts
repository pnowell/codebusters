import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { PublicProfile } from '../types';
import type { OffsetsMode } from './storage';

// In-memory cache of public profiles for instant, synchronous UI name lookups
const profilesCache = new Map<string, PublicProfile>();
const profileListeners = new Set<(profiles: PublicProfile[]) => void>();

/**
 * Formats an array of names into a human-friendly English list (e.g., "Alice", "Alice & Bob", "Alice, Bob & Charlie")
 */
export function formatNamesList(names: string[]): string {
  if (names.length === 0) return 'Decoder';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/**
 * Gets a display name for a single UID from the in-memory cache
 */
export function getCachedDisplayName(uid: string, fallback: string = 'Decoder'): string {
  if (!uid) return fallback;
  return profilesCache.get(uid)?.displayName || fallback;
}

/**
 * Gets a formatted display name for multiple student UIDs (or single UID)
 */
export function getDisplayNamesForUids(uids: string[] | undefined, fallback: string = 'Decoder'): string {
  if (!uids || uids.length === 0) return fallback;
  const names = uids.map(uid => getCachedDisplayName(uid, fallback));
  return formatNamesList(names);
}

/**
 * Subscribes to real-time changes across all team public profiles in `/profiles`
 */
export function subscribeTeamProfiles(
  onUpdate: (profiles: PublicProfile[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  profileListeners.add(onUpdate);

  // If we already have cached profiles, emit immediately
  if (profilesCache.size > 0) {
    onUpdate(Array.from(profilesCache.values()));
  }

  if (!db) {
    return () => {
      profileListeners.delete(onUpdate);
    };
  }

  const colRef = collection(db, 'profiles');

  const unsubscribeFirestore = onSnapshot(
    colRef,
    (snap) => {
      const list: PublicProfile[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as PublicProfile;
        const profile: PublicProfile = {
          ...data,
          uid: docSnap.id,
          displayName: data.displayName || 'Decoder',
          role: data.role || 'student',
        };
        profilesCache.set(docSnap.id, profile);
        list.push(profile);
      });

      profileListeners.forEach((listener) => {
        try {
          listener(list);
        } catch (e) {
          console.warn('[ProfileService] Listener error:', e);
        }
      });
    },
    (err) => {
      console.warn('[ProfileService] Error querying profiles:', err);
      onError?.(err);
    }
  );

  return () => {
    profileListeners.delete(onUpdate);
    if (profileListeners.size === 0) {
      unsubscribeFirestore();
    }
  };
}

/**
 * Upserts a student or coach public profile in `/profiles/{uid}`
 */
export async function upsertPublicProfile(
  uid: string,
  profile: Partial<PublicProfile>
): Promise<void> {
  if (!db || !uid) return;

  try {
    const docRef = doc(db, 'profiles', uid);
    const existing = profilesCache.get(uid);

    const merged: PublicProfile = {
      uid,
      displayName: profile.displayName || existing?.displayName || 'Decoder',
      role: profile.role || existing?.role || 'student',
      offsetsScores: profile.offsetsScores || existing?.offsetsScores,
    };

    profilesCache.set(uid, merged);

    await setDoc(
      docRef,
      {
        ...profile,
        uid,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn(`[ProfileService] Failed to upsert profile for ${uid}:`, err);
  }
}

/**
 * Updates a student's personal best offset scores in `/profiles/{uid}`.
 * Enforces Math.max high-water mark so scores never downgrade.
 */
export async function upsertPublicProfileScore(
  uid: string,
  mode: OffsetsMode,
  score: number,
  bestStreak: number,
  displayName?: string
): Promise<{ score: number; bestStreak: number } | null> {
  if (!db || !uid) return null;
  if (score <= 0 && bestStreak <= 0) return null;

  try {
    const docRef = doc(db, 'profiles', uid);
    let existing = profilesCache.get(uid);

    if (!existing) {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        existing = snap.data() as PublicProfile;
        profilesCache.set(uid, existing);
      }
    }

    const currentModeScore = existing?.offsetsScores?.[mode];
    const targetScore = Math.max(currentModeScore?.best60s ?? 0, score);
    const targetStreak = Math.max(currentModeScore?.bestStreak ?? 0, bestStreak);
    const targetName = displayName || existing?.displayName || 'Decoder';

    // If already >= target and name is the same, no need to rewrite
    if (
      currentModeScore &&
      currentModeScore.best60s === targetScore &&
      currentModeScore.bestStreak === targetStreak &&
      existing?.displayName === targetName
    ) {
      return { score: targetScore, bestStreak: targetStreak };
    }

    const updatedOffsetsScores = {
      ...(existing?.offsetsScores || {}),
      [mode]: {
        best60s: targetScore,
        bestStreak: targetStreak,
      },
    };

    const updatedProfile: PublicProfile = {
      uid,
      displayName: targetName,
      role: existing?.role || 'student',
      offsetsScores: updatedOffsetsScores,
    };

    profilesCache.set(uid, updatedProfile);

    await setDoc(
      docRef,
      {
        uid,
        displayName: targetName,
        [`offsetsScores.${mode}`]: {
          best60s: targetScore,
          bestStreak: targetStreak,
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return { score: targetScore, bestStreak: targetStreak };
  } catch (err) {
    console.warn(`[ProfileService] Failed to update score for ${uid}:`, err);
    return null;
  }
}

/**
 * Fetches a single public profile by UID (checks cache first)
 */
export async function fetchPublicProfile(uid: string): Promise<PublicProfile | null> {
  if (!uid) return null;
  const cached = profilesCache.get(uid);
  if (cached) return cached;

  if (!db) return null;
  try {
    const docRef = doc(db, 'profiles', uid);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    const profile = snap.data() as PublicProfile;
    profilesCache.set(uid, profile);
    return profile;
  } catch (err) {
    console.warn(`[ProfileService] Failed to fetch profile for ${uid}:`, err);
    return null;
  }
}
