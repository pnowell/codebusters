import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
  type Unsubscribe,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth, db, googleProvider, isFirebaseConfigured } from './firebase';
import type { AllowedUser } from '../types';

export interface AuthResult {
  allowed: boolean;
  user?: User;
  allowedUser?: AllowedUser;
  error?: string;
  rejectedEmail?: string;
}

/**
 * Normalizes email address to lower case for case-insensitive Firestore allowlist keys
 */
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

function parseAllowlistDoc(
  normalizedEmail: string,
  data: Record<string, unknown>
): AllowedUser | null {
  if (data.active === false) return null;
  const rawName = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  return {
    email: normalizedEmail,
    displayName: rawName || 'Decoder',
    role: data.role === 'teacher' ? 'teacher' : 'student',
    betaTester: data.betaTester === true,
    addedAt: data.addedAt,
    active: true,
  };
}

type AllowlistLookupResult =
  | { status: 'allowed'; allowedUser: AllowedUser }
  | { status: 'denied' }
  | { status: 'error' };

/**
 * Looks up an email in the Firestore `/allowed_users/{normalizedEmail}` collection
 */
async function checkAllowlist(email: string): Promise<AllowlistLookupResult> {
  if (!db) return { status: 'error' };
  const normalized = normalizeEmail(email);
  try {
    const docRef = doc(db, 'allowed_users', normalized);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return { status: 'denied' };

    const parsed = parseAllowlistDoc(normalized, snap.data() as Record<string, unknown>);
    if (!parsed) return { status: 'denied' };

    return {
      status: 'allowed',
      allowedUser: parsed,
    };
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown';
    console.error('[Auth] Error querying allowlist:', code);
    return { status: 'error' };
  }
}

/**
 * Signs in via Google OAuth popup and verifies whether the email is on the team allowlist.
 * Profile and user document initialization/merging is handled by `mergeAndInitializeCloudUser`
 * via the `onAuthStateChanged` listener so existing custom nicknames are preserved.
 */
export async function signInWithGoogle(): Promise<AuthResult> {
  if (!isFirebaseConfigured() || !auth || !googleProvider) {
    return {
      allowed: false,
      error: 'Firebase is not configured. Please set up your .env credentials.',
    };
  }

  try {
    const credential = await signInWithPopup(auth, googleProvider);
    const user = credential.user;
    if (!user.email) {
      await signOut(auth);
      return { allowed: false, error: 'Google account does not have an associated email.' };
    }

    const lookup = await checkAllowlist(user.email);
    if (lookup.status === 'denied') {
      const email = user.email;
      await signOut(auth);
      return {
        allowed: false,
        rejectedEmail: email,
        error: 'ACCOUNT_NOT_ON_ALLOWLIST',
      };
    }
    if (lookup.status === 'error') {
      return {
        allowed: false,
        error: 'firestore/unavailable (Could not reach Firestore to verify roster — check your internet/DNS connection)',
      };
    }

    return {
      allowed: true,
      user,
      allowedUser: lookup.allowedUser,
    };
  } catch (err: unknown) {
    const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
    const code = typeof errObj?.code === 'string' ? errObj.code : '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return { allowed: false };
    }

    let detail = '';
    const customData =
      errObj?.customData && typeof errObj.customData === 'object'
        ? (errObj.customData as Record<string, unknown>)
        : null;
    const target =
      customData?.target && typeof customData.target === 'object'
        ? (customData.target as { tagName?: string; src?: string })
        : null;
    if (target?.tagName === 'SCRIPT' && target.src) {
      const cleanSrc = target.src.split('?')[0];
      detail = `SCRIPT_BLOCKED:${cleanSrc}`;
    } else if (typeof errObj?.message === 'string' && !errObj.message.endsWith(`(${code}).`)) {
      detail = errObj.message;
    } else if (customData?.originalError) {
      detail = String(customData?.originalError);
    }

    const errorMsg = detail ? `${code || 'auth/error'} (${detail})` : code || String(err);
    console.warn('[Auth] Google sign-in error:', errorMsg);
    return {
      allowed: false,
      error: errorMsg,
    };
  }
}

/**
 * Signs out the current user
 */
export async function signOutUser(): Promise<void> {
  if (auth) {
    await signOut(auth);
  }
}

/**
 * Subscribes to Firebase Auth state changes and live `/allowed_users/{normalizedEmail}` updates
 * so role, active status, and beta-tester membership update in real time.
 */
export function subscribeToAuthState(
  callback: (user: User | null, allowedUser: AllowedUser | null) => void
): Unsubscribe {
  if (!auth) {
    callback(null, null);
    return () => {};
  }

  let allowlistUnsub: Unsubscribe | null = null;

  const clearAllowlistListener = () => {
    if (allowlistUnsub) {
      allowlistUnsub();
      allowlistUnsub = null;
    }
  };

  const authUnsub = onAuthStateChanged(auth, (user) => {
    clearAllowlistListener();

    if (!user || !user.email || !db) {
      callback(null, null);
      return;
    }

    const normalized = normalizeEmail(user.email);
    const docRef = doc(db, 'allowed_users', normalized);

    allowlistUnsub = onSnapshot(
      docRef,
      (snap) => {
        if (!snap.exists()) {
          clearAllowlistListener();
          void signOut(auth!).finally(() => {
            callback(null, null);
          });
          return;
        }

        const parsed = parseAllowlistDoc(
          normalized,
          snap.data() as Record<string, unknown>
        );
        if (!parsed) {
          clearAllowlistListener();
          void signOut(auth!).finally(() => {
            callback(null, null);
          });
          return;
        }

        callback(user, parsed);
      },
      (err) => {
        const code =
          err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
            ? err.code
            : 'unknown';
        console.error('[Auth] Error listening to allowlist doc:', code);
        // Fail closed while offline without wiping the persisted Firebase Auth session
        callback(null, null);
      }
    );
  });

  return () => {
    clearAllowlistListener();
    authUnsub();
  };
}
