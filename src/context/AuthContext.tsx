import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
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
  resetClientSessionState,
  startCloudSync,
  stopCloudSync,
} from '../services/sync';
import { resetQuoteFlagsCache } from '../services/quoteFlagService';
import { resetQuoteCompletionsCache } from '../services/quoteCompletionService';
import { resetClassroomConfigCache } from '../services/classroomConfigService';
import { AuthContext } from './authContextDef';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [allowedUser, setAllowedUser] = useState<AllowedUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(() => isFirebaseConfigured());
  const [error, setError] = useState<string | null>(null);
  const [rejectedEmail, setRejectedEmail] = useState<string | null>(null);

  const isConfigured = useMemo(() => isFirebaseConfigured(), []);
  const sessionSeqRef = useRef<number>(0);
  const inFlightInitRef = useRef<{ uid: string; promise: Promise<void> } | null>(null);

  const activateSession = useCallback(
    async (currentUser: User | null, currentAllowed: AllowedUser | null) => {
      const seq = ++sessionSeqRef.current;

      if (currentUser && currentAllowed) {
        try {
          if (inFlightInitRef.current?.uid === currentUser.uid) {
            await inFlightInitRef.current.promise;
          } else {
            const initPromise = mergeAndInitializeCloudUser(
              currentUser.uid,
              currentUser.email ?? '',
              currentAllowed.displayName,
              currentAllowed.role
            );
            inFlightInitRef.current = { uid: currentUser.uid, promise: initPromise };
            try {
              await initPromise;
            } finally {
              if (inFlightInitRef.current?.promise === initPromise) {
                inFlightInitRef.current = null;
              }
            }
          }

          if (seq !== sessionSeqRef.current) return;
          startCloudSync(currentUser.uid);
        } catch {
          console.error('[AuthContext] Cloud merge failed');
          if (seq !== sessionSeqRef.current) return;
        }

        setUser(currentUser);
        setAllowedUser(currentAllowed);
        setIsLoading(false);
      } else {
        inFlightInitRef.current = null;
        stopCloudSync();
        resetQuoteFlagsCache();
        resetQuoteCompletionsCache();
        resetClassroomConfigCache();
        setUser(currentUser);
        setAllowedUser(currentAllowed);
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!isConfigured) {
      return;
    }

    const unsubscribe = subscribeToAuthState((currentUser, currentAllowed) => {
      void activateSession(currentUser, currentAllowed);
    });

    return () => {
      sessionSeqRef.current += 1;
      unsubscribe();
      stopCloudSync();
    };
  }, [activateSession, isConfigured]);

  const signIn = async () => {
    setError(null);
    setRejectedEmail(null);
    setIsLoading(true);

    const res = await signInWithGoogle();
    if (!res.allowed) {
      setIsLoading(false);
      if (res.error === 'ACCOUNT_NOT_ON_ALLOWLIST') {
        setError('ACCOUNT_NOT_ON_ALLOWLIST');
        setRejectedEmail(res.rejectedEmail ?? null);
      } else if (res.error) {
        setError(res.error);
      }
      return;
    }

    if (res.user && res.allowedUser) {
      await activateSession(res.user, res.allowedUser);
    } else {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    sessionSeqRef.current += 1;
    inFlightInitRef.current = null;
    setIsLoading(true);
    resetClientSessionState();
    resetQuoteFlagsCache();
    resetQuoteCompletionsCache();
    resetClassroomConfigCache();
    await signOutUser();
    setUser(null);
    setAllowedUser(null);
    setError(null);
    setRejectedEmail(null);
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
