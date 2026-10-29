import {
  collection,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { PublicProfile, DrillId, DrillScore } from '../types';
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
 * Normalizes a public profile document from Firestore, recovering any scores
 * stored under new drillScores or legacy offsetsScores maps, and ensuring clean data structures.
 */
export function normalizePublicProfile(raw: Record<string, unknown>, uid: string): PublicProfile {
  const cleanDrillScores: Partial<Record<DrillId, DrillScore>> = {};

  // 1. Read existing drillScores map if present
  if (raw.drillScores && typeof raw.drillScores === 'object') {
    for (const [k, v] of Object.entries(raw.drillScores as Record<string, unknown>)) {
      if (v && typeof v === 'object') {
        const item = v as { best60s?: number; bestStreak?: number };
        cleanDrillScores[k as DrillId] = {
          best60s: typeof item.best60s === 'number' ? item.best60s : 0,
          bestStreak: typeof item.bestStreak === 'number' ? item.bestStreak : 0,
        };
      }
    }
  }

  // 2. Seamlessly migrate legacy offsetsScores (including literal dot notation if present)
  const legacyScores = (raw.offsetsScores as Record<string, { best60s?: number; bestStreak?: number }>) || {};
  const dotL2N = raw['offsetsScores.letterToNum'] as { best60s?: number; bestStreak?: number } | undefined;
  const dotN2L = raw['offsetsScores.numToLetter'] as { best60s?: number; bestStreak?: number } | undefined;

  const legacyL2NBest60s = Math.max(legacyScores.letterToNum?.best60s ?? 0, dotL2N?.best60s ?? 0);
  const legacyL2NStreak = Math.max(legacyScores.letterToNum?.bestStreak ?? 0, dotL2N?.bestStreak ?? 0);
  if (legacyL2NBest60s > 0 || legacyL2NStreak > 0) {
    const cur = cleanDrillScores.offsetsLetterToNum || { best60s: 0, bestStreak: 0 };
    cleanDrillScores.offsetsLetterToNum = {
      best60s: Math.max(cur.best60s, legacyL2NBest60s),
      bestStreak: Math.max(cur.bestStreak, legacyL2NStreak),
    };
  }

  const legacyN2LBest60s = Math.max(legacyScores.numToLetter?.best60s ?? 0, dotN2L?.best60s ?? 0);
  const legacyN2LStreak = Math.max(legacyScores.numToLetter?.bestStreak ?? 0, dotN2L?.bestStreak ?? 0);
  if (legacyN2LBest60s > 0 || legacyN2LStreak > 0) {
    const cur = cleanDrillScores.offsetsNumToLetter || { best60s: 0, bestStreak: 0 };
    cleanDrillScores.offsetsNumToLetter = {
      best60s: Math.max(cur.best60s, legacyN2LBest60s),
      bestStreak: Math.max(cur.bestStreak, legacyN2LStreak),
    };
  }

  return {
    uid,
    displayName: (raw.displayName as string) || 'Decoder',
    role: (raw.role as 'student' | 'teacher') || 'student',
    drillScores: Object.keys(cleanDrillScores).length > 0 ? cleanDrillScores : undefined,
    updatedAt: raw.updatedAt,
  };
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
        const raw = docSnap.data() as Record<string, unknown>;
        const profile = normalizePublicProfile(raw, docSnap.id);
        profilesCache.set(docSnap.id, profile);
        list.push(profile);

        // Auto-heal any legacy offsetsScores fields in Firestore
        if (
          raw.offsetsScores !== undefined ||
          raw['offsetsScores.letterToNum'] !== undefined ||
          raw['offsetsScores.numToLetter'] !== undefined
        ) {
          const docRef = docSnap.ref;
          const healPayload: Record<string, unknown> = {
            offsetsScores: deleteField(),
            'offsetsScores.letterToNum': deleteField(),
            'offsetsScores.numToLetter': deleteField(),
          };
          if (profile.drillScores) {
            healPayload.drillScores = profile.drillScores;
          }
          setDoc(docRef, healPayload, { merge: true }).catch((err) => {
            console.warn('[ProfileService] Auto-heal legacy drill scores error:', err);
          });
        }
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
 * Upserts a student or teacher public profile in `/profiles/{uid}`
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
      drillScores: profile.drillScores || existing?.drillScores,
    };

    profilesCache.set(uid, merged);

    const payload: Record<string, unknown> = {
      ...profile,
      uid,
      updatedAt: serverTimestamp(),
    };

    if (profile.drillScores) {
      payload.offsetsScores = deleteField();
      payload['offsetsScores.letterToNum'] = deleteField();
      payload['offsetsScores.numToLetter'] = deleteField();
    }

    await setDoc(docRef, payload, { merge: true });
  } catch (err) {
    console.warn(`[ProfileService] Failed to upsert profile for ${uid}:`, err);
  }
}

/**
 * Updates a student's personal best drill scores in `/profiles/{uid}`.
 * Enforces Math.max high-water mark so scores never downgrade.
 */
export async function upsertPublicProfileScore(
  uid: string,
  drill: DrillId | OffsetsMode,
  score: number,
  bestStreak: number,
  displayName?: string
): Promise<{ score: number; bestStreak: number } | null> {
  if (!db || !uid) return null;
  if (score <= 0 && bestStreak <= 0) return null;

  const drillId: DrillId =
    drill === 'letterToNum' ? 'offsetsLetterToNum' : drill === 'numToLetter' ? 'offsetsNumToLetter' : drill;

  try {
    const docRef = doc(db, 'profiles', uid);
    let existing = profilesCache.get(uid);

    if (!existing) {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        existing = normalizePublicProfile(snap.data() as Record<string, unknown>, uid);
        profilesCache.set(uid, existing);
      }
    }

    const currentScore = existing?.drillScores?.[drillId];
    const targetScore = Math.max(currentScore?.best60s ?? 0, score);
    const targetStreak = Math.max(currentScore?.bestStreak ?? 0, bestStreak);
    const targetName = displayName || existing?.displayName || 'Decoder';

    // If already >= target and name is the same, no need to rewrite
    if (
      currentScore &&
      currentScore.best60s === targetScore &&
      currentScore.bestStreak === targetStreak &&
      existing?.displayName === targetName
    ) {
      return { score: targetScore, bestStreak: targetStreak };
    }

    const updatedDrillScores = {
      ...(existing?.drillScores || {}),
      [drillId]: {
        best60s: targetScore,
        bestStreak: targetStreak,
      },
    };

    const updatedProfile: PublicProfile = {
      uid,
      displayName: targetName,
      role: existing?.role || 'student',
      drillScores: updatedDrillScores,
    };

    profilesCache.set(uid, updatedProfile);

    await setDoc(
      docRef,
      {
        uid,
        displayName: targetName,
        drillScores: updatedDrillScores,
        updatedAt: serverTimestamp(),
        offsetsScores: deleteField(),
        'offsetsScores.letterToNum': deleteField(),
        'offsetsScores.numToLetter': deleteField(),
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
    const profile = normalizePublicProfile(snap.data() as Record<string, unknown>, uid);
    profilesCache.set(uid, profile);
    return profile;
  } catch (err) {
    console.warn(`[ProfileService] Failed to fetch profile for ${uid}:`, err);
    return null;
  }
}
