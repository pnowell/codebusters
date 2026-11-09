export const DRILLS = [
  {
    id: 'offsets',
    name: 'Letter Offsets',
    shortTitle: 'Letter Offsets',
    menuLabel: 'Letter Offsets',
    kind: 'offsets',
    implemented: true,
    defaultEnabled: true,
    hasFlashcardDrill: true,
    hasQuoteWorkspace: false,
  },
  {
    id: 'atbash',
    name: 'Atbash Cipher',
    shortTitle: 'Atbash',
    menuLabel: 'Atbash',
    kind: 'lookup',
    implemented: true,
    defaultEnabled: true,
    hasFlashcardDrill: true,
    hasQuoteWorkspace: true,
  },
  {
    id: 'pigpen',
    name: 'Pigpen / Masonic Cipher',
    shortTitle: 'Pigpen',
    menuLabel: 'Pigpen',
    kind: 'lookup',
    implemented: true,
    defaultEnabled: true,
    hasFlashcardDrill: true,
    hasQuoteWorkspace: true,
  },
  {
    id: 'galactic',
    name: 'Standard Galactic Alphabet',
    shortTitle: 'Galactic',
    menuLabel: 'Standard Galactic Alphabet',
    kind: 'lookup',
    implemented: true,
    defaultEnabled: true,
    hasFlashcardDrill: true,
    hasQuoteWorkspace: true,
  },
  {
    id: 'tap',
    name: 'Tap Code Cipher',
    shortTitle: 'Tap Code',
    menuLabel: 'Tap Code',
    kind: 'lookup',
    implemented: false,
    defaultEnabled: false,
    hasFlashcardDrill: true,
    hasQuoteWorkspace: true,
  },
  {
    id: 'knights',
    name: 'Knights Templar Cipher',
    shortTitle: 'Knights',
    menuLabel: 'Knights Templar',
    kind: 'lookup',
    implemented: false,
    defaultEnabled: false,
    hasFlashcardDrill: true,
    hasQuoteWorkspace: true,
  },
  {
    id: 'caesar',
    name: 'Caesar Cipher (±3)',
    shortTitle: 'Caesar',
    menuLabel: 'Caesar (±3)',
    kind: 'analysis',
    implemented: false,
    defaultEnabled: false,
    hasFlashcardDrill: false,
    hasQuoteWorkspace: true,
  },
  {
    id: 'vigenere',
    name: 'Vigenère Cipher',
    shortTitle: 'Vigenère',
    menuLabel: 'Vigenère',
    kind: 'analysis',
    implemented: false,
    defaultEnabled: false,
    hasFlashcardDrill: false,
    hasQuoteWorkspace: true,
  },
  {
    id: 'aristocrat',
    name: 'Aristocrat Cryptanalysis',
    shortTitle: 'Aristocrat',
    menuLabel: 'Aristocrat',
    kind: 'analysis',
    implemented: false,
    defaultEnabled: false,
    hasFlashcardDrill: false,
    hasQuoteWorkspace: true,
  },
] as const;

export type CipherType = (typeof DRILLS)[number]['id'];
export type LookupCipherType = Extract<(typeof DRILLS)[number], { kind: 'lookup'; implemented: true }>['id'];

export const DRILL_IDS: readonly CipherType[] = DRILLS.map(d => d.id);
export const IMPLEMENTED_DRILLS = DRILLS.filter(d => d.implemented);
export const COMING_SOON_DRILLS = DRILLS.filter(d => !d.implemented);
export const GENERAL_PRACTICE_DRILLS = IMPLEMENTED_DRILLS.filter(d => d.id !== 'offsets');

const LOOKUP_CIPHER_IDS: readonly string[] = DRILLS
  .filter(d => d.kind === 'lookup' && d.implemented)
  .map(d => d.id);

export const isCipherType = (s: string | null | undefined): s is CipherType =>
  !!s && (DRILL_IDS as readonly string[]).includes(s);
export const isLookupCipher = (id: CipherType | null): id is LookupCipherType =>
  !!id && LOOKUP_CIPHER_IDS.includes(id);
export const getDrill = (id: CipherType) => DRILLS.find(d => d.id === id)!;

/**
 * Returns whether an implemented cipher is enabled for students (and Guest Mode)
 * given the global teacher-configured flags. Letter Offsets is always enabled.
 * Newly implemented ciphers with `defaultEnabled: false` stay hidden until explicitly checked.
 */
export function isCipherEnabledForStudent(
  id: CipherType,
  flags: Partial<Record<CipherType, boolean>>
): boolean {
  const drill = getDrill(id);
  if (!drill.implemented) return false;
  if (id === 'offsets') return true;
  const configured = flags[id];
  return typeof configured === 'boolean' ? configured : drill.defaultEnabled;
}

/**
 * Returns whether a user with the given role can access a specific drill or cipher workspace.
 * Teachers can access all implemented features regardless of student visibility checkboxes.
 */
export function isCipherAccessible(
  id: CipherType,
  section: 'memorize' | 'cipher',
  flags: Partial<Record<CipherType, boolean>>,
  isTeacher: boolean
): boolean {
  const drill = getDrill(id);
  if (!drill.implemented) return false;
  if (section === 'memorize' && !drill.hasFlashcardDrill) return false;
  if (section === 'cipher' && !drill.hasQuoteWorkspace) return false;
  return isTeacher || isCipherEnabledForStudent(id, flags);
}

export type CipherBucket = 'speed' | 'analysis';

export function getCipherBucket(id: CipherType): CipherBucket | null {
  const drill = getDrill(id);
  if (drill.kind === 'offsets') return null;
  return drill.kind === 'analysis' ? 'analysis' : 'speed';
}

/**
 * Tunable wrong-answer lockout timing for flashcard speed drills
 * (Offsets, Atbash, Pigpen, Galactic).
 *
 * Random guessing math (1/26 hit rate per card):
 *   Expected 60s hits ≈ 60_000 / (25 * wrongAnswerLockoutMs)
 *   At 1500ms lockout: ~1.6 expected hits per 60s.
 */
export const DRILL_LOCKOUT_CONFIG = {
  /** Mandatory delay (ms) on a wrong answer while showing the mistake and disabling input. */
  wrongAnswerLockoutMs: 1500,
} as const;
