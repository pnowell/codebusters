import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
  type Unsubscribe,
} from 'firebase/auth';
import { deleteField, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider, isFirebaseConfigured } from './firebase';
import type { AllowedUser } from '../types';
import { upsertPublicProfile } from './profileService';

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
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Looks up an email in the Firestore `/allowed_users/{normalizedEmail}` collection
 */
export async function checkAllowlist(email: string): Promise<AllowedUser | null> {
  if (!db) return null;
  const normalized = normalizeEmail(email);
  try {
    const docRef = doc(db, 'allowed_users', normalized);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;

    const data = snap.data();
    if (data.active === false) return null;

    return {
      email: normalized,
      displayName: data.displayName || 'Decoder',
      role: data.role === 'teacher' ? 'teacher' : 'student',
      addedAt: data.addedAt,
      active: true,
    };
  } catch (err) {
    console.error('[Auth] Error querying allowlist:', err);
    return null;
  }
}

/**
 * Signs in via Google OAuth popup and verifies whether the email is on the team allowlist
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

    const allowed = await checkAllowlist(user.email);
    if (!allowed) {
      const email = user.email;
      await signOut(auth);
      return {
        allowed: false,
        rejectedEmail: email,
        error: 'ACCOUNT_NOT_ON_ALLOWLIST',
      };
    }

    // Touch user profile / lastActive in Firestore
    if (db) {
      const userRef = doc(db, 'users', user.uid);
      const displayName = allowed.displayName || user.displayName || 'Decoder';
      await setDoc(
        userRef,
        {
          uid: user.uid,
          email: normalizeEmail(user.email),
          lastActiveAt: serverTimestamp(),
          displayName: deleteField(),
          role: deleteField(),
          offsetsScores: deleteField(),
        },
        { merge: true }
      );

      await upsertPublicProfile(user.uid, {
        displayName,
        role: allowed.role,
      });
    }

    return {
      allowed: true,
      user,
      allowedUser: allowed,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
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
 * Subscribes to Firebase Auth state changes and verifies allowlist status
 */
export function subscribeToAuthState(
  callback: (user: User | null, allowedUser: AllowedUser | null) => void
): Unsubscribe {
  if (!auth) {
    callback(null, null);
    return () => {};
  }

  return onAuthStateChanged(auth, async (user) => {
    if (!user || !user.email) {
      callback(null, null);
      return;
    }

    const allowed = await checkAllowlist(user.email);
    if (!allowed) {
      // If user was signed in but removed from allowlist, log out
      await signOut(auth!);
      callback(null, null);
      return;
    }

    callback(user, allowed);
  });
}
