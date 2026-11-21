import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  ShareCipherMode,
  ShareLinkPayloadSchema,
} from '../proto/share_link_pb';
import type {
  AristocratDifficulty,
  CaesarRangeMode,
  TestableCipherType,
  WorkoutStepContext,
} from '../types';
import {
  normalizeCaesarOffset,
  sanitizeVigenereKeyword,
  toUnsignedCaesarOffset,
} from './ciphers';

const BASE62_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE62_MAP = new Uint8Array(128).fill(255);
for (let i = 0; i < BASE62_ALPHABET.length; i += 1) {
  BASE62_MAP[BASE62_ALPHABET.charCodeAt(i)] = i;
}

export const SAFE_SHARE_TOKEN_RE = /^[0-9A-Za-z]{6,128}$/;

const SHARE_STREAM_MAGIC = 0x5bd1e995;

export interface ShareLinkConfig {
  cipher: TestableCipherType;
  quoteId: number;
  caesarRange?: CaesarRangeMode;
  caesarOffset?: number;
  vigenereKeyword?: string;
  aristocratDifficulty?: AristocratDifficulty;
  aristocratSeed?: number;
  hintVariant?: number;
}

function createMaskStream(salt16: number): () => number {
  let state = ((salt16 & 0xffff) ^ SHARE_STREAM_MAGIC) >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 24) & 0xff;
  };
}

function fnv1a16(saltHi: number, saltLo: number, payload: Uint8Array): number {
  let h = 0x811c9dc5;
  h ^= saltHi & 0xff;
  h = Math.imul(h, 0x01000193) >>> 0;
  h ^= saltLo & 0xff;
  h = Math.imul(h, 0x01000193) >>> 0;
  for (let i = 0; i < payload.length; i += 1) {
    h ^= payload[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ((h >>> 16) ^ (h & 0xffff)) & 0xffff;
}

export function encodeBase62(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) {
    leadingZeros += 1;
  }

  let value = 0n;
  for (let i = leadingZeros; i < bytes.length; i += 1) {
    value = (value << 8n) | BigInt(bytes[i]);
  }

  let digits = '';
  while (value > 0n) {
    const rem = Number(value % 62n);
    digits = BASE62_ALPHABET[rem] + digits;
    value /= 62n;
  }

  return '0'.repeat(leadingZeros) + digits;
}

export function decodeBase62(encoded: string): Uint8Array | null {
  if (!encoded || encoded.length > 128) return null;
  let leadingZeros = 0;
  while (leadingZeros < encoded.length && encoded[leadingZeros] === '0') {
    leadingZeros += 1;
  }

  let value = 0n;
  for (let i = leadingZeros; i < encoded.length; i += 1) {
    const code = encoded.charCodeAt(i);
    if (code >= 128) return null;
    const digit = BASE62_MAP[code];
    if (digit === 255) return null;
    value = value * 62n + BigInt(digit);
  }

  const tailBytes: number[] = [];
  while (value > 0n) {
    tailBytes.push(Number(value & 0xffn));
    value >>= 8n;
  }
  tailBytes.reverse();

  const totalLen = leadingZeros + tailBytes.length;
  if (totalLen > 96) return null;
  const out = new Uint8Array(totalLen);
  for (let i = 0; i < tailBytes.length; i += 1) {
    out[leadingZeros + i] = tailBytes[i];
  }
  return out;
}

function toShareCipherMode(config: ShareLinkConfig): ShareCipherMode {
  switch (config.cipher) {
    case 'atbash':
      return ShareCipherMode.ATBASH;
    case 'pigpen':
      return ShareCipherMode.PIGPEN;
    case 'galactic':
      return ShareCipherMode.GALACTIC;
    case 'tap':
      return ShareCipherMode.TAP;
    case 'knights':
      return ShareCipherMode.KNIGHTS;
    case 'caesar':
      return config.caesarRange === 'any'
        ? ShareCipherMode.CAESAR_ANY
        : ShareCipherMode.CAESAR_PM3;
    case 'vigenere':
      return ShareCipherMode.VIGENERE;
    case 'aristocrat':
      if (config.aristocratDifficulty === 'medium') {
        return ShareCipherMode.ARISTOCRAT_MEDIUM;
      }
      if (config.aristocratDifficulty === 'hard') {
        return ShareCipherMode.ARISTOCRAT_HARD;
      }
      return ShareCipherMode.ARISTOCRAT_EASY;
  }
}

function fromShareCipherMode(mode: ShareCipherMode): {
  cipher: TestableCipherType;
  caesarRange?: CaesarRangeMode;
  aristocratDifficulty?: AristocratDifficulty;
} | null {
  switch (mode) {
    case ShareCipherMode.ATBASH:
      return { cipher: 'atbash' };
    case ShareCipherMode.PIGPEN:
      return { cipher: 'pigpen' };
    case ShareCipherMode.GALACTIC:
      return { cipher: 'galactic' };
    case ShareCipherMode.TAP:
      return { cipher: 'tap' };
    case ShareCipherMode.KNIGHTS:
      return { cipher: 'knights' };
    case ShareCipherMode.CAESAR_PM3:
      return { cipher: 'caesar', caesarRange: 'pm3' };
    case ShareCipherMode.CAESAR_ANY:
      return { cipher: 'caesar', caesarRange: 'any' };
    case ShareCipherMode.VIGENERE:
      return { cipher: 'vigenere' };
    case ShareCipherMode.ARISTOCRAT_EASY:
      return { cipher: 'aristocrat', aristocratDifficulty: 'easy' };
    case ShareCipherMode.ARISTOCRAT_MEDIUM:
      return { cipher: 'aristocrat', aristocratDifficulty: 'medium' };
    case ShareCipherMode.ARISTOCRAT_HARD:
      return { cipher: 'aristocrat', aristocratDifficulty: 'hard' };
    case ShareCipherMode.UNSPECIFIED:
    default:
      return null;
  }
}

function generateSalt16(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint16Array(1);
    crypto.getRandomValues(buf);
    // Avoid leading 0x00 byte so tokens never begin with leading '0' padding
    return buf[0] < 0x0100 ? buf[0] | 0x0100 : buf[0];
  }
  const fallback = Math.floor(Math.random() * 0xffff) & 0xffff;
  return fallback < 0x0100 ? fallback | 0x0100 : fallback;
}

/**
 * Serializes a cipher + quote exercise configuration using Protobuf (`ShareLinkPayload`),
 * wraps it with a 2-byte random salt + 2-byte FNV-1a checksum, XOR-scrambles the payload,
 * and returns a compact Base62 token suitable for `?share=<token>`.
 */
export function encodeShareToken(
  config: ShareLinkConfig,
  saltOverride?: number
): string {
  const msg = create(ShareLinkPayloadSchema, {
    cipherMode: toShareCipherMode(config),
    quoteId: Math.max(0, Math.trunc(config.quoteId)) >>> 0,
    caesarOffset:
      config.cipher === 'caesar' && config.caesarOffset !== undefined
        ? toUnsignedCaesarOffset(config.caesarOffset)
        : 0,
    vigenereKeyword:
      config.cipher === 'vigenere' && config.vigenereKeyword
        ? sanitizeVigenereKeyword(config.vigenereKeyword)
        : '',
    aristocratSeed:
      config.cipher === 'aristocrat' && config.aristocratSeed !== undefined
        ? config.aristocratSeed >>> 0
        : 0,
    hintVariant:
      config.cipher === 'aristocrat' && config.hintVariant !== undefined
        ? Math.max(0, Math.trunc(config.hintVariant)) >>> 0
        : 0,
  });

  const protoBytes = toBinary(ShareLinkPayloadSchema, msg);
  const salt16 =
    saltOverride !== undefined ? saltOverride & 0xffff : generateSalt16();
  const saltHi = (salt16 >>> 8) & 0xff;
  const saltLo = salt16 & 0xff;
  const checksum = fnv1a16(saltHi, saltLo, protoBytes);

  const envelope = new Uint8Array(2 + protoBytes.length + 2);
  envelope[0] = saltHi;
  envelope[1] = saltLo;

  const nextMask = createMaskStream(salt16);
  for (let i = 0; i < protoBytes.length; i += 1) {
    envelope[2 + i] = protoBytes[i] ^ nextMask();
  }
  envelope[2 + protoBytes.length] = ((checksum >>> 8) & 0xff) ^ nextMask();
  envelope[2 + protoBytes.length + 1] = (checksum & 0xff) ^ nextMask();

  return encodeBase62(envelope);
}

/**
 * Decodes and validates an opaque `?share=<token>` Base62 string.
 * Returns `null` if the token is malformed, fails checksum verification, or contains invalid fields.
 */
export function decodeShareToken(token: string): ShareLinkConfig | null {
  if (typeof token !== 'string' || !SAFE_SHARE_TOKEN_RE.test(token)) {
    return null;
  }
  const envelope = decodeBase62(token);
  if (!envelope || envelope.length < 5) {
    return null;
  }

  const saltHi = envelope[0];
  const saltLo = envelope[1];
  const salt16 = (saltHi << 8) | saltLo;
  const protoLen = envelope.length - 4;
  const protoBytes = new Uint8Array(protoLen);

  const nextMask = createMaskStream(salt16);
  for (let i = 0; i < protoLen; i += 1) {
    protoBytes[i] = envelope[2 + i] ^ nextMask();
  }
  const checkHi = envelope[2 + protoLen] ^ nextMask();
  const checkLo = envelope[2 + protoLen + 1] ^ nextMask();
  const expectedChecksum = (checkHi << 8) | checkLo;

  if (fnv1a16(saltHi, saltLo, protoBytes) !== expectedChecksum) {
    return null;
  }

  let msg;
  try {
    msg = fromBinary(ShareLinkPayloadSchema, protoBytes);
  } catch {
    return null;
  }

  const mapped = fromShareCipherMode(msg.cipherMode);
  if (!mapped) return null;
  if (!Number.isInteger(msg.quoteId) || msg.quoteId < 0 || msg.quoteId > 100_000) {
    return null;
  }

  const result: ShareLinkConfig = {
    cipher: mapped.cipher,
    quoteId: msg.quoteId,
    ...(mapped.caesarRange ? { caesarRange: mapped.caesarRange } : {}),
    ...(mapped.aristocratDifficulty
      ? { aristocratDifficulty: mapped.aristocratDifficulty }
      : {}),
  };

  if (mapped.cipher === 'caesar') {
    if (msg.caesarOffset >= 1 && msg.caesarOffset <= 25) {
      const normalized = normalizeCaesarOffset(msg.caesarOffset);
      if (normalized !== undefined) {
        result.caesarOffset = normalized;
      }
    }
  } else if (mapped.cipher === 'vigenere') {
    const cleanKw = sanitizeVigenereKeyword(msg.vigenereKeyword);
    if (cleanKw) {
      result.vigenereKeyword = cleanKw.slice(0, 16);
    }
  } else if (mapped.cipher === 'aristocrat') {
    result.aristocratSeed = msg.aristocratSeed >>> 0;
    if (msg.hintVariant > 0 && msg.hintVariant <= 255) {
      result.hintVariant = msg.hintVariant;
    }
  }

  return result;
}

export function buildShareLinkUrl(token: string): string {
  return `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(token)}`;
}

export const MEANINGFULLY_SEEN_TIMEOUT_SEC = 60;

export function buildCipherSessionKey(params: {
  shareToken?: string;
  workoutContext?: WorkoutStepContext;
  explicitTeacherQuoteId?: number;
  explicitTeacherCaesarOffset?: number;
  cipher: TestableCipherType;
  caesarRange: CaesarRangeMode;
  aristocratDifficulty: AristocratDifficulty;
}): string {
  if (params.shareToken) {
    return `share:${params.shareToken}`;
  }
  if (params.workoutContext) {
    return `workout:${params.workoutContext.round}:${params.workoutContext.stepIndex}:${params.cipher}`;
  }
  const modePart =
    params.cipher === 'caesar'
      ? params.caesarRange
      : params.cipher === 'aristocrat'
        ? params.aristocratDifficulty
        : 'std';
  const offsetSuffix =
    params.cipher === 'caesar' && params.explicitTeacherCaesarOffset !== undefined
      ? `:off${params.explicitTeacherCaesarOffset}`
      : '';
  if (params.explicitTeacherQuoteId !== undefined || offsetSuffix) {
    return `teacher:${params.cipher}:${modePart}:${params.explicitTeacherQuoteId ?? 'rand'}${offsetSuffix}`;
  }
  return `solo:${params.cipher}:${modePart}`;
}

