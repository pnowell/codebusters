import type {
  AristocratAssistMode,
  AristocratCornerTuple,
  AristocratDifficulty,
  AristocratEditAction,
  AristocratWorkspaceState,
  Quote,
} from '../types';
import { isLetter, letterToOffset } from './ciphers';

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const ALPHABET_LETTERS: readonly string[] = ALPHABET.split('');

/**
 * Official English letter frequencies (%) from Page 2 of the
 * 2026–2027 SoCal DaVinci Decoders Official Resource Sheet (sorted descending).
 */
export interface EnglishLetterFrequency {
  readonly letter: string;
  readonly percent: number;
}

export const ENGLISH_LETTER_FREQUENCIES: readonly EnglishLetterFrequency[] = [
  { letter: 'E', percent: 12.51 },
  { letter: 'T', percent: 9.25 },
  { letter: 'A', percent: 8.04 },
  { letter: 'O', percent: 7.6 },
  { letter: 'I', percent: 7.26 },
  { letter: 'N', percent: 7.09 },
  { letter: 'S', percent: 6.54 },
  { letter: 'R', percent: 6.12 },
  { letter: 'H', percent: 5.49 },
  { letter: 'L', percent: 4.14 },
  { letter: 'D', percent: 3.99 },
  { letter: 'C', percent: 3.06 },
  { letter: 'U', percent: 2.71 },
  { letter: 'M', percent: 2.53 },
  { letter: 'F', percent: 2.3 },
  { letter: 'P', percent: 2.0 },
  { letter: 'G', percent: 1.96 },
  { letter: 'W', percent: 1.92 },
  { letter: 'Y', percent: 1.73 },
  { letter: 'B', percent: 1.54 },
  { letter: 'V', percent: 0.99 },
  { letter: 'K', percent: 0.67 },
  { letter: 'X', percent: 0.19 },
  { letter: 'J', percent: 0.16 },
  { letter: 'Q', percent: 0.11 },
  { letter: 'Z', percent: 0.09 },
];

/**
 * Trims and uppercases a candidate 26-letter Aristocrat substitution alphabet.
 */
export function sanitizeAristocratAlphabet(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase();
}

/**
 * Validates that `raw` is a strict 26-letter uppercase derangement of `A–Z`
 * (every letter appears once and NO letter maps to itself: `alpha[i] !== ALPHABET[i]`).
 */
export function isValidAristocratAlphabet(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length !== 26) return false;
  const seen = new Set<string>();
  for (let i = 0; i < 26; i += 1) {
    const ch = raw[i];
    if (!isLetter(ch) || ch !== ch.toUpperCase()) return false;
    if (ch === ALPHABET[i]) return false;
    if (seen.has(ch)) return false;
    seen.add(ch);
  }
  return seen.size === 26;
}

function createMulberry32(seed: number): () => number {
  let state = (Math.trunc(seed) ^ 0x9e3779b9) >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a uniformly distributed random 26-letter derangement (`cipher[i] !== ALPHABET[i]`).
 */
export function generateAristocratAlphabet(
  rng: () => number = Math.random,
  excludeAlphabet?: string
): string {
  const cleanExclude = sanitizeAristocratAlphabet(excludeAlphabet);

  for (let attempt = 0; attempt < 500; attempt += 1) {
    const arr = [...ALPHABET_LETTERS];
    for (let i = 25; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }

    let isDerangement = true;
    for (let i = 0; i < 26; i += 1) {
      if (arr[i] === ALPHABET[i]) {
        isDerangement = false;
        break;
      }
    }

    if (isDerangement) {
      const candidate = arr.join('');
      if (!cleanExclude || candidate !== cleanExclude || attempt > 40) {
        return candidate;
      }
    }
  }

  // Deterministic fallback derangement (shift by +1) if custom RNG is degenerate
  return 'BCDEFGHIJKLMNOPQRSTUVWXYZA';
}

/**
 * Deterministically generates a valid 26-letter derangement from an integer seed.
 */
export function deterministicAristocratAlphabet(seed: number): string {
  const rng = createMulberry32(Math.trunc(seed) * 2654435761 + 1013904223);
  return generateAristocratAlphabet(rng);
}

/**
 * Encrypts a single plaintext character using a 26-letter Aristocrat substitution alphabet.
 * Non-alphabetic characters are returned unchanged.
 */
export function aristocratEncryptChar(
  plainChar: string,
  alphabet?: string
): string {
  const upper = plainChar.toUpperCase();
  const idx = letterToOffset(upper);
  if (idx === -1) return plainChar;
  const validAlpha = isValidAristocratAlphabet(alphabet)
    ? alphabet
    : 'BCDEFGHIJKLMNOPQRSTUVWXYZA';
  return validAlpha[idx];
}

/**
 * Encrypts an entire plaintext string into Aristocrat ciphertext (preserving spaces and punctuation).
 */
export function aristocratEncryptText(
  plaintext: string,
  alphabet?: string
): string {
  const validAlpha = isValidAristocratAlphabet(alphabet)
    ? alphabet
    : 'BCDEFGHIJKLMNOPQRSTUVWXYZA';
  return plaintext
    .toUpperCase()
    .split('')
    .map((ch) => aristocratEncryptChar(ch, validAlpha))
    .join('');
}

/**
 * Counts occurrences of each ciphertext letter `A–Z` in `ciphertext`.
 */
export function computeCiphertextFrequencies(
  ciphertext: string
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ch of ALPHABET_LETTERS) {
    counts[ch] = 0;
  }
  for (let i = 0; i < ciphertext.length; i += 1) {
    const ch = ciphertext[i].toUpperCase();
    if (counts[ch] !== undefined) {
      counts[ch] += 1;
    }
  }
  return counts;
}

export interface AristocratMappingAnalysis {
  /** Ciphertext letters mapped to themselves (`J -> J`, illegal in Division A) */
  selfMappedCiphers: ReadonlySet<string>;
  /** Plaintext letters assigned to 2+ distinct ciphertext letters (`plain -> [cipher1, cipher2, ...]`) */
  duplicatePlainOwners: ReadonlyMap<string, readonly string[]>;
  /** All ciphertext letters involved in either a self-map or duplicate plaintext collision */
  conflictingCiphers: ReadonlySet<string>;
  /** Plaintext letters currently committed as Center guesses */
  usedPlainLetters: ReadonlySet<string>;
  /** Maps each committed plaintext letter to the ciphertext letter(s) claiming it */
  plainOwners: ReadonlyMap<string, readonly string[]>;
}

/**
 * Analyzes Replacement Table center mappings for illegal self-mappings,
 * duplicate plaintext collisions, and used plaintext letters.
 */
export function computeAristocratAnalysis(
  replacements: Partial<Record<string, string>> | undefined
): AristocratMappingAnalysis {
  const selfMapped = new Set<string>();
  const ownersMap = new Map<string, string[]>();
  const usedPlain = new Set<string>();

  if (replacements) {
    for (const cipherChar of ALPHABET_LETTERS) {
      const rawPlain = replacements[cipherChar];
      if (!rawPlain) continue;
      const plainChar = rawPlain.slice(-1).toUpperCase();
      if (!isLetter(plainChar)) continue;

      usedPlain.add(plainChar);
      if (plainChar === cipherChar) {
        selfMapped.add(cipherChar);
      }
      const existing = ownersMap.get(plainChar);
      if (existing) {
        existing.push(cipherChar);
      } else {
        ownersMap.set(plainChar, [cipherChar]);
      }
    }
  }

  const duplicatePlain = new Map<string, readonly string[]>();
  const conflicting = new Set<string>(selfMapped);

  for (const [plainChar, owners] of ownersMap.entries()) {
    if (owners.length > 1) {
      duplicatePlain.set(plainChar, owners);
      for (const c of owners) {
        conflicting.add(c);
      }
    }
  }

  return {
    selfMappedCiphers: selfMapped,
    duplicatePlainOwners: duplicatePlain,
    conflictingCiphers: conflicting,
    usedPlainLetters: usedPlain,
    plainOwners: ownersMap,
  };
}

/**
 * Normalizes a 4-corner tuple (`[TL, TR, BL, BR]`) and returns `undefined` if all 4 slots are blank.
 */
export function normalizeCornerTuple(
  tuple: readonly string[] | undefined
): AristocratCornerTuple | undefined {
  if (!Array.isArray(tuple)) return undefined;
  const cleaned: AristocratCornerTuple = ['', '', '', ''];
  let hasAny = false;
  for (let i = 0; i < 4; i += 1) {
    const raw = tuple[i];
    const ch =
      typeof raw === 'string' && raw.length > 0
        ? raw.slice(-1).toUpperCase()
        : '';
    if (isLetter(ch)) {
      cleaned[i] = ch;
      hasAny = true;
    }
  }
  return hasAny ? cleaned : undefined;
}

/**
 * Encodes a 4-corner tuple into a 4-char Firestore-safe string (e.g. `"OP.R"`),
 * or `""` when all 4 corners are empty.
 */
export function serializeCornerTuple(
  tuple: readonly string[] | undefined
): string {
  const norm = normalizeCornerTuple(tuple);
  if (!norm) return '';
  return norm.map((ch) => (ch ? ch : '.')).join('');
}

/**
 * Decodes a 4-char serialized corner string (e.g. `"OP.R"`) back into an `AristocratCornerTuple`.
 */
export function deserializeCornerTuple(
  raw: unknown
): AristocratCornerTuple | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const slots: [string, string, string, string] = ['', '', '', ''];
  let hasAny = false;
  for (let i = 0; i < Math.min(4, raw.length); i += 1) {
    const ch = raw[i].toUpperCase();
    if (isLetter(ch)) {
      slots[i] = ch;
      hasAny = true;
    }
  }
  return hasAny ? slots : undefined;
}

/**
 * Derives Replacement Table center guesses from `userInputs` and `cipherChars`
 * when hydrating legacy or tile-synced workspace state.
 */
export function deriveReplacementsFromInputs(
  userInputs: readonly string[],
  cipherChars: readonly string[],
  explicitReplacements?: Partial<Record<string, string>>
): Partial<Record<string, string>> {
  const derived: Partial<Record<string, string>> = {};
  for (let i = 0; i < cipherChars.length; i += 1) {
    const cCh = cipherChars[i];
    if (!isLetter(cCh)) continue;
    const uCh = (userInputs[i] ?? '').slice(-1).toUpperCase();
    if (isLetter(uCh) && !derived[cCh]) {
      derived[cCh] = uCh;
    }
  }
  if (explicitReplacements) {
    for (const cCh of ALPHABET_LETTERS) {
      const val = explicitReplacements[cCh];
      if (typeof val === 'string') {
        const upper = val.slice(-1).toUpperCase();
        if (isLetter(upper)) {
          derived[cCh] = upper;
        } else if (val === '') {
          delete derived[cCh];
        }
      }
    }
  }
  return derived;
}

/**
 * Mode-aware reducer for all Aristocrat workspace edits.
 * V1 ships `'linked'` mode (updating both `replacements` and matching `userInputs` tiles simultaneously),
 * while keeping the action boundary clean for future `'assisted_paper'` / `'strict_paper'` modes.
 */
export function applyAristocratEdit(
  state: AristocratWorkspaceState,
  action: AristocratEditAction,
  cipherChars: readonly string[],
  assistMode: AristocratAssistMode = 'linked'
): AristocratWorkspaceState {
  switch (action.kind) {
    case 'setCenterByCipher': {
      const cipherChar = action.cipherLetter.toUpperCase();
      if (!isLetter(cipherChar)) return state;
      const rawPlain = action.plainLetter.slice(-1).toUpperCase();
      const cleanPlain = isLetter(rawPlain) ? rawPlain : '';

      const nextReplacements: Partial<Record<string, string>> = {
        ...state.replacements,
      };
      if (cleanPlain) {
        nextReplacements[cipherChar] = cleanPlain;
      } else {
        delete nextReplacements[cipherChar];
      }

      if (assistMode === 'linked') {
        const nextInputs = cipherChars.map((cCh, idx) => {
          if (!isLetter(cCh)) return state.userInputs[idx] ?? cCh;
          if (cCh === cipherChar) return cleanPlain;
          return state.userInputs[idx] ?? '';
        });
        return {
          ...state,
          userInputs: nextInputs,
          replacements: nextReplacements,
        };
      }

      return {
        ...state,
        replacements: nextReplacements,
      };
    }

    case 'setCenterByTile': {
      const { index } = action;
      if (index < 0 || index >= cipherChars.length) return state;
      const cipherChar = cipherChars[index];
      if (!isLetter(cipherChar)) return state;

      if (assistMode === 'linked') {
        return applyAristocratEdit(
          state,
          {
            kind: 'setCenterByCipher',
            cipherLetter: cipherChar,
            plainLetter: action.plainLetter,
          },
          cipherChars,
          assistMode
        );
      }

      const rawPlain = action.plainLetter.slice(-1).toUpperCase();
      const cleanPlain = isLetter(rawPlain) ? rawPlain : '';
      const nextInputs = [...state.userInputs];
      nextInputs[index] = cleanPlain;
      return {
        ...state,
        userInputs: nextInputs,
      };
    }

    case 'setCorner': {
      const cipherChar = action.cipherLetter.toUpperCase();
      if (!isLetter(cipherChar)) return state;
      const rawPlain = action.plainLetter.slice(-1).toUpperCase();
      const cleanPlain = isLetter(rawPlain) ? rawPlain : '';
      const prevTuple = state.corners[cipherChar] ?? ['', '', '', ''];
      const nextTuple: AristocratCornerTuple = [...prevTuple] as AristocratCornerTuple;
      nextTuple[action.cornerIndex] = cleanPlain;

      const normalized = normalizeCornerTuple(nextTuple);
      const nextCorners: Partial<Record<string, AristocratCornerTuple>> = {
        ...state.corners,
      };
      if (normalized) {
        nextCorners[cipherChar] = normalized;
      } else {
        delete nextCorners[cipherChar];
      }
      return {
        ...state,
        corners: nextCorners,
      };
    }

    case 'clearCornersForLetter': {
      const cipherChar = action.cipherLetter.toUpperCase();
      if (!state.corners[cipherChar]) return state;
      const nextCorners = { ...state.corners };
      delete nextCorners[cipherChar];
      return {
        ...state,
        corners: nextCorners,
      };
    }

    case 'clearAllCorners': {
      if (Object.keys(state.corners).length === 0) return state;
      return {
        ...state,
        corners: {},
      };
    }
  }
}

function extractCleanAlphaWords(quoteText: string): {
  allWords: string[];
  firstPureWord: string | null;
  lastPureWord: string | null;
} {
  const rawTokens = quoteText
    .toUpperCase()
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const stripOuterPunct = (tok: string) =>
    tok.replace(/^[^A-Z0-9']+/, '').replace(/[^A-Z0-9']+$/, '');

  const cleanedTokens = rawTokens.map(stripOuterPunct).filter((t) => t.length > 0);
  const firstCandidate = cleanedTokens[0] ?? '';
  const lastCandidate = cleanedTokens[cleanedTokens.length - 1] ?? '';

  const isPureAlpha = (s: string) => /^[A-Z]+$/.test(s);
  const pureWords = cleanedTokens.filter(isPureAlpha);

  return {
    allWords: pureWords,
    firstPureWord: isPureAlpha(firstCandidate) ? firstCandidate : null,
    lastPureWord: isPureAlpha(lastCandidate) ? lastCandidate : null,
  };
}

/**
 * Generates candidate starter hints for an Aristocrat puzzle:
 * - `'easy'`: Word-level hints ("Ends with the word <2–3 letter word>", "Starts with the word <2–5 letter word>", "Contains the word <3–5 letter word>")
 * - `'medium'`: Single-letter hints ("Starts with the letter <L>", "Ciphertext <C> maps to <P>" for high-frequency letters)
 * - `'hard'`: Empty array (no hints)
 */
export function buildAristocratHintCandidates(
  quote: Quote,
  alphabet: string,
  difficulty: AristocratDifficulty
): string[] {
  if (difficulty === 'hard') return [];

  if (difficulty === 'easy') {
    const { allWords, firstPureWord, lastPureWord } = extractCleanAlphaWords(
      quote.quote
    );
    const candidates: string[] = [];
    const seen = new Set<string>();

    const pushUnique = (hint: string) => {
      if (!seen.has(hint)) {
        seen.add(hint);
        candidates.push(hint);
      }
    };

    if (lastPureWord && lastPureWord.length >= 2 && lastPureWord.length <= 3) {
      pushUnique(`The quote ends with the word ${lastPureWord}.`);
    }

    if (firstPureWord && firstPureWord.length >= 2 && firstPureWord.length <= 5) {
      pushUnique(`The quote starts with the word ${firstPureWord}.`);
    }

    // Informative 3..5 letter words sorted by unique letter count descending (4-5 letters preferred)
    const interiorWords = Array.from(
      new Set(allWords.filter((w) => w.length >= 3 && w.length <= 5))
    ).sort((a, b) => {
      const uniqA = new Set(a).size;
      const uniqB = new Set(b).size;
      if (uniqB !== uniqA) return uniqB - uniqA;
      return b.length - a.length;
    });

    for (const w of interiorWords.slice(0, 5)) {
      pushUnique(`The quote contains the word ${w}.`);
    }

    if (candidates.length === 0) {
      const fallbackWord =
        allWords.find((w) => w.length >= 2 && w.length <= 6) ?? allWords[0];
      if (fallbackWord) {
        pushUnique(`The quote contains the word ${fallbackWord}.`);
      }
    }

    return candidates;
  }

  // Medium: single-letter hints ("Starts with the letter X" or "<frequent cipher> maps to <plain>")
  const upperQuote = quote.quote.toUpperCase();
  const firstPlain = upperQuote.split('').find(isLetter);
  const ciphertext = aristocratEncryptText(upperQuote, alphabet);
  const freqs = computeCiphertextFrequencies(ciphertext);

  // Invert alphabet: cipher -> plain
  const cipherToPlain: Record<string, string> = {};
  const validAlpha = isValidAristocratAlphabet(alphabet)
    ? alphabet
    : 'BCDEFGHIJKLMNOPQRSTUVWXYZA';
  for (let i = 0; i < 26; i += 1) {
    cipherToPlain[validAlpha[i]] = ALPHABET[i];
  }

  const topCiphers = [...ALPHABET_LETTERS]
    .filter((c) => freqs[c] > 0)
    .sort((a, b) => freqs[b] - freqs[a] || a.localeCompare(b))
    .slice(0, 3);

  const candidates: string[] = [];
  if (firstPlain) {
    candidates.push(`The quote starts with the letter ${firstPlain}.`);
  }
  for (const cCh of topCiphers) {
    const pCh = cipherToPlain[cCh];
    if (pCh) {
      candidates.push(`Ciphertext ${cCh} maps to ${pCh}.`);
    }
  }

  return candidates;
}

/**
 * Picks a deterministic starter hint for `(quote, alphabet, difficulty)`.
 * Incrementing `variantOffset` cycles cleanly through available hint candidates.
 */
export function generateAristocratHint(
  quote: Quote,
  alphabet: string,
  difficulty: AristocratDifficulty,
  variantOffset = 0
): string | null {
  const candidates = buildAristocratHintCandidates(quote, alphabet, difficulty);
  if (candidates.length === 0) return null;
  const idx = Math.abs(Math.trunc(quote.id + variantOffset)) % candidates.length;
  return candidates[idx];
}

const PROMPT_HINT_SUFFIX_RE = /\s*Hint:\s+.*$/i;

/**
 * Replaces or appends a `Hint: <sentence>` clause onto a Practice Test question prompt,
 * or removes an existing `Hint: ...` suffix when `hintSentence` is `null`.
 */
export function applyHintToQuestionPrompt(
  currentPrompt: string,
  fallbackBasePrompt: string,
  hintSentence: string | null
): string {
  const stripped = currentPrompt.replace(PROMPT_HINT_SUFFIX_RE, '').trim();
  if (!hintSentence) {
    return stripped;
  }
  const base = stripped || fallbackBasePrompt.trim();
  const normalizedBase =
    base.endsWith('.') || base.endsWith('!') || base.endsWith('?')
      ? base
      : `${base}.`;
  return `${normalizedBase} Hint: ${hintSentence}`.slice(0, 240);
}

export function hasHintInQuestionPrompt(prompt: string | undefined): boolean {
  if (!prompt) return false;
  return PROMPT_HINT_SUFFIX_RE.test(prompt) || /\b(starts with|ends with|contains the word|maps to)\b/i.test(prompt);
}
