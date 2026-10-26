export const DRILLS = [
  { id: 'offsets',    name: 'Letter Offsets',             shortTitle: 'Letter Offsets', kind: 'offsets', implemented: true  },
  { id: 'atbash',     name: 'Atbash Cipher',              shortTitle: 'Atbash',         kind: 'lookup',  implemented: true  },
  { id: 'pigpen',     name: 'Pigpen / Masonic Cipher',    shortTitle: 'Pigpen',         kind: 'lookup',  implemented: true  },
  { id: 'galactic',   name: 'Standard Galactic Alphabet', shortTitle: 'Galactic',       kind: 'lookup',  implemented: true  },
  { id: 'caesar',     name: 'Caesar Cipher (±3)',         shortTitle: 'Caesar',         kind: 'lookup',  implemented: false },
  { id: 'tap',        name: 'Tap Code Cipher',            shortTitle: 'Tap Code',       kind: 'lookup',  implemented: false },
  { id: 'knights',    name: 'Knights Templar Cipher',     shortTitle: 'Knights',        kind: 'lookup',  implemented: false },
  { id: 'vigenere',   name: 'Vigenère Cipher',            shortTitle: 'Vigenère',       kind: 'lookup',  implemented: false },
  { id: 'aristocrat', name: 'Aristocrat Cryptanalysis',   shortTitle: 'Aristocrat',     kind: 'lookup',  implemented: false },
] as const;

export type CipherType = (typeof DRILLS)[number]['id'];
export type LookupCipherType = Extract<(typeof DRILLS)[number], { kind: 'lookup'; implemented: true }>['id'];

export const DRILL_IDS: readonly CipherType[] = DRILLS.map(d => d.id);
export const IMPLEMENTED_DRILLS = DRILLS.filter(d => d.implemented);
export const COMING_SOON_DRILLS = DRILLS.filter(d => !d.implemented);
export const DEFAULT_UNLOCKED: CipherType[] = IMPLEMENTED_DRILLS.map(d => d.id);

export const isCipherType = (s: string | null | undefined): s is CipherType =>
  !!s && (DRILL_IDS as readonly string[]).includes(s);
export const isLookupCipher = (id: CipherType | null): id is LookupCipherType =>
  id === 'atbash' || id === 'pigpen' || id === 'galactic';
export const getDrill = (id: CipherType) => DRILLS.find(d => d.id === id)!;

export type CipherBucket = 'speed' | 'analysis';

export function getCipherBucket(id: CipherType): CipherBucket | null {
  if (id === 'offsets') return null;
  if (id === 'caesar' || id === 'vigenere' || id === 'aristocrat') {
    return 'analysis';
  }
  return 'speed';
}
