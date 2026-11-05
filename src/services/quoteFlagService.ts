import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { QuoteFlag } from '../types';

const MAX_FLAG_NOTE_LENGTH = 500;

let cachedFlagsMap = new Map<number, QuoteFlag>();
let cachedFlaggedIds = new Set<number>();

/**
 * Returns the live in-memory set of flagged quote IDs (used by random quote pickers).
 */
export function getFlaggedQuoteIds(): ReadonlySet<number> {
  return cachedFlaggedIds;
}

/**
 * Returns the live in-memory map of flagged quotes keyed by quoteId.
 */
export function getQuoteFlagsMap(): ReadonlyMap<number, QuoteFlag> {
  return cachedFlagsMap;
}

/**
 * Clears the in-memory quote flags cache on sign-out.
 */
export function resetQuoteFlagsCache(): void {
  cachedFlagsMap = new Map<number, QuoteFlag>();
  cachedFlaggedIds = new Set<number>();
}

/**
 * Subscribes to `/quote_flags` in Firestore and keeps the in-memory cache synchronized.
 */
export function subscribeQuoteFlags(
  onUpdate?: (flags: ReadonlyMap<number, QuoteFlag>) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!db) {
    onUpdate?.(cachedFlagsMap);
    return () => {};
  }

  return onSnapshot(
    collection(db, 'quote_flags'),
    (snap) => {
      const nextMap = new Map<number, QuoteFlag>();
      const nextSet = new Set<number>();

      snap.forEach((docSnap) => {
        const raw = docSnap.data() as Record<string, unknown>;
        const parsedId =
          typeof raw.quoteId === 'number' && Number.isInteger(raw.quoteId)
            ? raw.quoteId
            : Number.parseInt(docSnap.id, 10);

        if (!Number.isNaN(parsedId) && parsedId >= 0) {
          const note =
            typeof raw.note === 'string' && raw.note.trim().length > 0
              ? raw.note.trim().slice(0, MAX_FLAG_NOTE_LENGTH)
              : undefined;
          nextMap.set(parsedId, {
            quoteId: parsedId,
            ...(note ? { note } : {}),
            updatedAt: raw.updatedAt,
          });
          nextSet.add(parsedId);
        }
      });

      cachedFlagsMap = nextMap;
      cachedFlaggedIds = nextSet;
      onUpdate?.(cachedFlagsMap);
    },
    (err) => {
      console.warn('[QuoteFlags] Error subscribing to quote_flags');
      onError?.(err);
    }
  );
}

/**
 * Teacher API: Creates or updates a flag (and optional note) on `/quote_flags/{quoteId}`.
 * Stores zero PII (only quoteId, sanitized note, and updatedAt).
 */
export async function saveQuoteFlag(quoteId: number, note?: string): Promise<boolean> {
  if (!db || !Number.isInteger(quoteId) || quoteId < 0) return false;
  try {
    const cleanNote =
      typeof note === 'string' && note.trim().length > 0
        ? note.trim().slice(0, MAX_FLAG_NOTE_LENGTH)
        : undefined;

    const payload: Record<string, unknown> = {
      quoteId,
      updatedAt: serverTimestamp(),
    };
    if (cleanNote !== undefined) {
      payload.note = cleanNote;
    }

    await setDoc(doc(db, 'quote_flags', String(quoteId)), payload);
    return true;
  } catch {
    console.warn('[QuoteFlags] Failed to save quote flag');
    return false;
  }
}

/**
 * Teacher API: Removes `/quote_flags/{quoteId}`.
 */
export async function removeQuoteFlag(quoteId: number): Promise<boolean> {
  if (!db || !Number.isInteger(quoteId) || quoteId < 0) return false;
  try {
    await deleteDoc(doc(db, 'quote_flags', String(quoteId)));
    return true;
  } catch {
    console.warn('[QuoteFlags] Failed to remove quote flag');
    return false;
  }
}
