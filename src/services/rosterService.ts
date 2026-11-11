import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { withVersionStamp } from './versionService';

export interface StudentRosterEntry {
  docId: string;
  displayName: string;
  maskedEmailHint: string;
  betaTester: boolean;
}

/**
 * Masks an email address (e.g. `noah.smith@gmail.com` -> `n***@gmail.com`) so full
 * PII is never surfaced in UI labels even when disambiguating duplicate student names.
 */
export function maskEmailForDisambiguation(rawEmail: string): string {
  const trimmed = rawEmail.trim().toLowerCase();
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 0) {
    return '***';
  }
  const firstChar = trimmed[0];
  const domain = trimmed.slice(atIdx + 1);
  return domain ? `${firstChar}***@${domain}` : `${firstChar}***`;
}

/**
 * Teacher API: Fetches active student entries from `/allowed_users` for managing
 * classroom groups such as Beta Testers. Server-side RBAC (`isTeacher()`) is
 * enforced in `firestore.rules`.
 */
export async function fetchStudentRoster(): Promise<{
  entries: StudentRosterEntry[];
  error: string | null;
}> {
  if (!db) {
    return { entries: [], error: null };
  }

  try {
    const snap = await getDocs(collection(db, 'allowed_users'));
    const entries: StudentRosterEntry[] = [];

    snap.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      if (data.active === false || data.role === 'teacher') {
        return;
      }

      const docId = docSnap.id;
      if (!docId || docId.length > 254) {
        return;
      }

      const rawName =
        typeof data.displayName === 'string' ? data.displayName.trim() : '';
      const rawEmail =
        typeof data.email === 'string' && data.email.trim()
          ? data.email
          : docId;

      entries.push({
        docId,
        displayName: rawName || 'Decoder',
        maskedEmailHint: maskEmailForDisambiguation(rawEmail),
        betaTester: data.betaTester === true,
      });
    });

    entries.sort((a, b) => {
      const byName = a.displayName.localeCompare(b.displayName);
      return byName !== 0 ? byName : a.docId.localeCompare(b.docId);
    });

    return { entries, error: null };
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown';
    console.warn('[RosterService] Failed to fetch student roster:', code);
    return {
      entries: [],
      error: 'Could not load student roster. Check your connection.',
    };
  }
}

/**
 * Teacher API: Persists `betaTester` membership changes onto `/allowed_users/{docId}`
 * strictly for student documents whose membership changed.
 */
export async function saveStudentBetaTesters(
  roster: readonly StudentRosterEntry[],
  selectedDocIds: ReadonlySet<string>
): Promise<boolean> {
  if (!db) return false;

  const changed = roster.filter(
    (entry) => entry.betaTester !== selectedDocIds.has(entry.docId)
  );
  if (changed.length === 0) {
    return true;
  }

  try {
    await Promise.all(
      changed.map((entry) =>
        updateDoc(
          doc(db!, 'allowed_users', entry.docId),
          withVersionStamp({
            betaTester: selectedDocIds.has(entry.docId),
          })
        )
      )
    );
    return true;
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown';
    console.warn('[RosterService] Failed to update beta testers:', code);
    return false;
  }
}
