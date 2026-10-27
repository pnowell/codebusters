import { createContext } from 'react';
import type { User } from 'firebase/auth';
import type { AllowedUser } from '../types';

export interface AuthContextValue {
  user: User | null;
  allowedUser: AllowedUser | null;
  isAllowed: boolean;
  isLoading: boolean;
  isConfigured: boolean;
  error: string | null;
  rejectedEmail: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
