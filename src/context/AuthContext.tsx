import React, { useEffect, useState, useMemo } from 'react';
import type { User } from 'firebase/auth';
import type { AllowedUser } from '../types';
import { isFirebaseConfigured } from '../services/firebase';
import {
  signInWithGoogle,
  signOutUser,
  subscribeToAuthState,
} from '../services/auth';
import {
  mergeAndInitializeCloudUser,
  startCloudSync,
  stopCloudSync,
} from '../services/sync';
import { AuthContext } from './authContextDef';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [allowedUser, setAllowedUser] = useState<AllowedUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(() => isFirebaseConfigured());
  const [error, setError] = useState<string | null>(null);
  const [rejectedEmail, setRejectedEmail] = useState<string | null>(null);

  const isConfigured = useMemo(() => isFirebaseConfigured(), []);

  useEffect(() => {
    if (!isConfigured) {
      return;
    }

    const unsubscribe = subscribeToAuthState(async (currentUser, currentAllowed) => {
      setUser(currentUser);
      setAllowedUser(currentAllowed);
      setIsLoading(false);

      if (currentUser && currentAllowed) {
        try {
          await mergeAndInitializeCloudUser(
            currentUser.uid,
            currentUser.email ?? '',
            currentAllowed.displayName,
            currentAllowed.role
          );
          startCloudSync(currentUser.uid);
        } catch (e) {
          console.error('[AuthContext] Cloud merge error:', e);
        }
      } else {
        stopCloudSync();
      }
    });

    return () => {
      unsubscribe();
      stopCloudSync();
    };
  }, [isConfigured]);

  const signIn = async () => {
    setError(null);
    setRejectedEmail(null);
    setIsLoading(true);

    const res = await signInWithGoogle();
    setIsLoading(false);

    if (!res.allowed) {
      if (res.error === 'ACCOUNT_NOT_ON_ALLOWLIST') {
        setError('ACCOUNT_NOT_ON_ALLOWLIST');
        setRejectedEmail(res.rejectedEmail ?? null);
      } else if (res.error) {
        setError(res.error);
      }
    }
  };

  const signOut = async () => {
    setIsLoading(true);
    await signOutUser();
    setUser(null);
    setAllowedUser(null);
    setError(null);
    setRejectedEmail(null);
    stopCloudSync();
    setIsLoading(false);
  };

  const clearError = () => {
    setError(null);
    setRejectedEmail(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        allowedUser,
        isAllowed: Boolean(user && allowedUser),
        isLoading,
        isConfigured,
        error,
        rejectedEmail,
        signIn,
        signOut,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
