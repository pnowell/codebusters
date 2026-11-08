import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { withVersionStamp } from './versionService';
import { GENERAL_PRACTICE_DRILLS, type CipherType } from '../data/drills';
import type { GeneralPracticeCiphers } from '../types';

const CACHE_KEY = 'davinci_general_practice_ciphers';
const CLASSROOM_CONFIG_COLLECTION = 'classroom_config';
const GENERAL_PRACTICE_DOC_ID = 'general_practice';

/**
 * Builds the default global boolean map where all implemented non-offset ciphers are enabled.
 */
export function createDefaultGeneralPracticeCiphers(): GeneralPracticeCiphers {
  const defaults: GeneralPracticeCiphers = {};
  for (const drill of GENERAL_PRACTICE_DRILLS) {
    defaults[drill.id] = true;
  }
  return defaults;
}

/**
 * Strictly validates an untrusted object against the allow-list of implemented
 * General Practice ciphers (`GENERAL_PRACTICE_DRILLS`) and boolean values.
 */
export function sanitizeGeneralPracticeCiphers(raw: unknown): GeneralPracticeCiphers {
  const next = createDefaultGeneralPracticeCiphers();
  if (!raw || typeof raw !== 'object') {
    return next;
  }

  const record = raw as Record<string, unknown>;
  for (const drill of GENERAL_PRACTICE_DRILLS) {
    const val = record[drill.id];
    if (typeof val === 'boolean') {
      next[drill.id] = val;
    }
  }
  return next;
}

/**
 * Converts the global boolean map into the active `CipherType[]` list consumed by
 * `useWorkoutCircuit` and `workoutWeights` (`'offsets'` is always included).
 */
export function generalPracticeCiphersToList(
  flags: GeneralPracticeCiphers
): CipherType[] {
  const active: CipherType[] = ['offsets'];
  for (const drill of GENERAL_PRACTICE_DRILLS) {
    if (flags[drill.id] !== false) {
      active.push(drill.id);
    }
  }
  return active;
}

function loadCachedCiphers(): GeneralPracticeCiphers {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return createDefaultGeneralPracticeCiphers();
    return sanitizeGeneralPracticeCiphers(JSON.parse(raw));
  } catch {
    return createDefaultGeneralPracticeCiphers();
  }
}

function persistCachedCiphers(ciphers: GeneralPracticeCiphers): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(ciphers));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

let cachedCiphers: GeneralPracticeCiphers = loadCachedCiphers();

/**
 * Returns a copy of the latest cached General Practice cipher booleans.
 */
export function getGeneralPracticeCiphers(): GeneralPracticeCiphers {
  return { ...cachedCiphers };
}

/**
 * Resets the in-memory classroom config cache to defaults on sign-out.
 */
export function resetClassroomConfigCache(): void {
  cachedCiphers = createDefaultGeneralPracticeCiphers();
}

/**
 * Subscribes to `/classroom_config/general_practice` in Firestore so all students
 * and teachers receive real-time updates to the global General Practice cipher booleans.
 */
export function subscribeGeneralPracticeCiphers(
  onUpdate?: (ciphers: GeneralPracticeCiphers) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!db) {
    onUpdate?.({ ...cachedCiphers });
    return () => {};
  }

  return onSnapshot(
    doc(db, CLASSROOM_CONFIG_COLLECTION, GENERAL_PRACTICE_DOC_ID),
    (snap) => {
      if (snap.exists()) {
        const rawData = snap.data() as Record<string, unknown>;
        cachedCiphers = sanitizeGeneralPracticeCiphers(rawData.ciphers);
      } else {
        cachedCiphers = createDefaultGeneralPracticeCiphers();
      }
      persistCachedCiphers(cachedCiphers);
      onUpdate?.({ ...cachedCiphers });
    },
    (err) => {
      console.warn('[ClassroomConfig] Error subscribing to general_practice config');
      onUpdate?.({ ...cachedCiphers });
      onError?.(err);
    }
  );
}

/**
 * Teacher API: Saves the global General Practice cipher booleans to
 * `/classroom_config/general_practice`. Server-side RBAC is enforced in `firestore.rules`.
 */
export async function saveGeneralPracticeCiphers(
  ciphers: GeneralPracticeCiphers
): Promise<boolean> {
  const sanitized = sanitizeGeneralPracticeCiphers(ciphers);
  cachedCiphers = sanitized;
  persistCachedCiphers(sanitized);

  if (!db) return false;

  try {
    await setDoc(
      doc(db, CLASSROOM_CONFIG_COLLECTION, GENERAL_PRACTICE_DOC_ID),
      withVersionStamp({
        ciphers: sanitized,
        updatedAt: serverTimestamp(),
      })
    );
    return true;
  } catch {
    console.warn(
      '[ClassroomConfig] Failed to save general_practice config (check Firestore rules if permission-denied)'
    );
    return false;
  }
}
