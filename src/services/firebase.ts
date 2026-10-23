/**
 * Firebase Client Service for DaVinci Decoders
 *
 * HOW FIREBASE SECURITY & QUOTA PROTECTION WORKS:
 * 1. The firebaseConfig below (apiKey, projectId) is designed to be public client configuration.
 * 2. To prevent other people / forks from abusing your quota, open Google Cloud Console:
 *    -> APIs & Services -> Credentials -> Select your "Browser key (auto created by Firebase)"
 *    -> Under "Application restrictions", choose "Websites"
 *    -> Add website restrictions:
 *         https://pnowell.github.io/*
 *         http://localhost:*
 *         http://127.0.0.1:*
 *    This ensures Google's servers strictly reject any requests originating from other websites or forks!
 * 3. Under Firebase Console -> Authentication -> Settings -> Authorized Domains:
 *    Verify only `pnowell.github.io` and `localhost` are authorized.
 * 4. Firebase Security Rules ensure only authenticated users/students can write to game rooms.
 */

export interface FirebaseRoomState {
  roomId: string;
  cipher: string;
  quoteId: number;
  players: { [id: string]: { name: string; progress: number } };
  sharedGuesses: { [cipherChar: string]: string };
}

// Check if Firebase credentials have been supplied
export const isFirebaseConfigured = (): boolean => {
  // Can be populated via Vite env variables: import.meta.env.VITE_FIREBASE_API_KEY
  return false;
};

// Mock / Local Room Coordinator for pairing without server
export class LocalPairCoordinator {
  static createRoomCode(cipher: string, quoteId: number): string {
    const prefix = cipher.substring(0, 3).toUpperCase();
    const seed = (quoteId + 100).toString(36).toUpperCase();
    return `${prefix}-${seed}`;
  }

  static decodeRoomCode(code: string): { cipherPrefix: string; quoteId: number } | null {
    const parts = code.trim().split('-');
    if (parts.length !== 2) return null;
    const quoteId = parseInt(parts[1], 36) - 100;
    return { cipherPrefix: parts[0], quoteId };
  }
}
