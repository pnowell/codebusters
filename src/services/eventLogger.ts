import { create, fromJson, toJson, type JsonValue } from '@bufbuild/protobuf';
import { onIdTokenChanged } from 'firebase/auth';
import {
  CipherSolvedEventSchema,
  CipherStartedEventSchema,
  DrillSessionEventSchema,
  PracticeEventBatchSchema,
  PracticeEventSchema,
  PracticeSource,
  ScoreTierProto,
  type PracticeEvent,
} from '../proto/events_pb';
import type {
  CipherPracticeSource,
  DrillId,
  ScoreTier,
  TestableCipherType,
} from '../types';
import { auth } from './firebase';

const PENDING_EVENTS_KEY = 'davinci_pending_events';
const MAX_QUEUED_EVENTS = 100;
const MAX_BATCH_SIZE = 50;
const FLUSH_DEBOUNCE_MS = 1500;

let isLoggingEnabled = false;
let cachedIdToken: string | null = null;
let tokenListenerAttached = false;
let flushTimeoutId: ReturnType<typeof setTimeout> | null = null;
let inFlightFlush: Promise<boolean> | null = null;

function generateEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function resolveLogPracticeEventsUrl(): string | null {
  const explicit = import.meta.env.VITE_LOG_EVENTS_URL as string | undefined;
  if (typeof explicit === 'string' && explicit.trim().startsWith('https://')) {
    return explicit.trim();
  }
  const senderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as
    | string
    | undefined;
  if (typeof senderId === 'string' && /^\d{6,20}$/.test(senderId.trim())) {
    return `https://codebusters-events-${senderId.trim()}.us-central1.run.app/logPracticeEvents`;
  }
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as
    | string
    | undefined;
  if (
    typeof projectId === 'string' &&
    /^[a-z0-9][a-z0-9-]{4,30}[a-z0-9]$/.test(projectId.trim())
  ) {
    return `https://us-central1-${projectId.trim()}.cloudfunctions.net/logPracticeEvents`;
  }
  return null;
}

export function toPracticeSourceProto(
  source: CipherPracticeSource
): PracticeSource {
  switch (source) {
    case 'standalone':
      return PracticeSource.STANDALONE;
    case 'general_practice':
      return PracticeSource.GENERAL_PRACTICE;
    case 'shared_link':
      return PracticeSource.SHARED_LINK;
  }
}

export function toScoreTierProto(tier: ScoreTier): ScoreTierProto {
  switch (tier) {
    case 'full':
      return ScoreTierProto.FULL;
    case 'half':
      return ScoreTierProto.HALF;
    case 'none':
      return ScoreTierProto.ZERO;
  }
}

export function loadQueuedPracticeEvents(): PracticeEvent[] {
  try {
    const raw = localStorage.getItem(PENDING_EVENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const valid: PracticeEvent[] = [];
    for (const item of parsed.slice(-MAX_QUEUED_EVENTS)) {
      try {
        const ev = fromJson(PracticeEventSchema, item as JsonValue, {
          ignoreUnknownFields: true,
        });
        if (ev.eventId && ev.payload.case) {
          valid.push(ev);
        }
      } catch {
        // Drop malformed entry
      }
    }
    return valid;
  } catch {
    return [];
  }
}

function saveQueuedPracticeEvents(events: readonly PracticeEvent[]): void {
  try {
    if (events.length === 0) {
      localStorage.removeItem(PENDING_EVENTS_KEY);
      return;
    }
    const trimmed = events.slice(-MAX_QUEUED_EVENTS);
    const serialized = trimmed.map((ev) =>
      toJson(PracticeEventSchema, ev, { alwaysEmitImplicit: true })
    );
    localStorage.setItem(PENDING_EVENTS_KEY, JSON.stringify(serialized));
  } catch {
    // Ignore storage quota errors
  }
}

function removeAcknowledgedEvents(sentIds: ReadonlySet<string>): void {
  if (sentIds.size === 0) return;
  const remaining = loadQueuedPracticeEvents().filter(
    (ev) => !sentIds.has(ev.eventId)
  );
  saveQueuedPracticeEvents(remaining);
}

function ensureTokenListener(): void {
  if (tokenListenerAttached || !auth) return;
  tokenListenerAttached = true;
  onIdTokenChanged(auth, (user) => {
    if (!user) {
      cachedIdToken = null;
      return;
    }
    void user
      .getIdToken()
      .then((tok) => {
        cachedIdToken = tok;
      })
      .catch(() => {
        cachedIdToken = null;
      });
  });
}

function scheduleFlush(immediate = false): void {
  if (!isLoggingEnabled) return;
  if (flushTimeoutId !== null) {
    clearTimeout(flushTimeoutId);
    flushTimeoutId = null;
  }
  if (immediate) {
    void flushPendingPracticeEvents();
    return;
  }
  flushTimeoutId = setTimeout(() => {
    flushTimeoutId = null;
    void flushPendingPracticeEvents();
  }, FLUSH_DEBOUNCE_MS);
}

/**
 * Enables or disables event queuing/flushing based on whether the current user is an
 * authenticated roster member (`isAllowed && Boolean(user)`).
 */
export function setPracticeEventLoggingEnabled(enabled: boolean): void {
  ensureTokenListener();
  isLoggingEnabled = enabled;
  if (!enabled) {
    if (flushTimeoutId !== null) {
      clearTimeout(flushTimeoutId);
      flushTimeoutId = null;
    }
    return;
  }

  if (auth?.currentUser) {
    void auth.currentUser
      .getIdToken()
      .then((tok) => {
        cachedIdToken = tok;
        if (loadQueuedPracticeEvents().length > 0) {
          scheduleFlush(false);
        }
      })
      .catch(() => {});
  }
}

/**
 * Flushes up to `MAX_BATCH_SIZE` queued events to `logPracticeEvents`.
 * When `keepalive` is true (e.g. inside `pagehide`), uses the synchronously cached
 * ID token so the browser starts the request before unloading the document.
 */
export async function flushPendingPracticeEvents(options?: {
  keepalive?: boolean;
}): Promise<boolean> {
  if (!isLoggingEnabled) return false;
  const endpoint = resolveLogPracticeEventsUrl();
  if (!endpoint) return false;

  const queued = loadQueuedPracticeEvents();
  if (queued.length === 0) return true;

  if (options?.keepalive) {
    if (!cachedIdToken) return false;
    const batchSlice = queued.slice(0, MAX_BATCH_SIZE);
    const batchMsg = create(PracticeEventBatchSchema, { events: batchSlice });
    const bodyStr = JSON.stringify(
      toJson(PracticeEventBatchSchema, batchMsg, { alwaysEmitImplicit: true })
    );
    const sentIds = new Set(batchSlice.map((e) => e.eventId));
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cachedIdToken}`,
        },
        body: bodyStr,
        keepalive: true,
      });
      if (res.ok) {
        removeAcknowledgedEvents(sentIds);
        return true;
      }
    } catch {
      // Leave in localStorage outbox for retry on next page load
    }
    return false;
  }

  if (inFlightFlush) {
    return inFlightFlush;
  }

  inFlightFlush = (async () => {
    try {
      const token =
        (auth?.currentUser ? await auth.currentUser.getIdToken() : null) ??
        cachedIdToken;
      if (!token) return false;
      cachedIdToken = token;

      const currentQueue = loadQueuedPracticeEvents();
      if (currentQueue.length === 0) return true;

      const batchSlice = currentQueue.slice(0, MAX_BATCH_SIZE);
      const batchMsg = create(PracticeEventBatchSchema, { events: batchSlice });
      const bodyStr = JSON.stringify(
        toJson(PracticeEventBatchSchema, batchMsg, { alwaysEmitImplicit: true })
      );
      const sentIds = new Set(batchSlice.map((e) => e.eventId));

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: bodyStr,
      });

      if (res.ok) {
        removeAcknowledgedEvents(sentIds);
        if (loadQueuedPracticeEvents().length > 0) {
          scheduleFlush(false);
        }
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      inFlightFlush = null;
    }
  })();

  return inFlightFlush;
}

function enqueuePracticeEvent(
  event: PracticeEvent,
  options?: { immediate?: boolean; keepalive?: boolean }
): void {
  if (!isLoggingEnabled) return;
  const existing = loadQueuedPracticeEvents();
  existing.push(event);
  saveQueuedPracticeEvents(existing);

  if (options?.keepalive) {
    void flushPendingPracticeEvents({ keepalive: true });
  } else {
    scheduleFlush(Boolean(options?.immediate));
  }
}

export function logDrillSessionEvent(
  params: {
    drillId: DrillId;
    sessionDurationSec: number;
    sessionBest60sScore: number;
    totalAnswered: number;
    totalCorrect: number;
    source: 'standalone' | 'general_practice';
  },
  options?: { keepalive?: boolean }
): void {
  if (params.totalAnswered < 1) return;
  const event = create(PracticeEventSchema, {
    eventId: generateEventId(),
    clientTimestampMs: Date.now(),
    payload: {
      case: 'drillSession',
      value: create(DrillSessionEventSchema, {
        drillId: params.drillId,
        sessionDurationSec:
          Math.round(Math.max(0, params.sessionDurationSec) * 10) / 10,
        sessionBest60sScore: Math.max(
          0,
          Math.trunc(params.sessionBest60sScore)
        ),
        totalAnswered: Math.max(0, Math.trunc(params.totalAnswered)),
        totalCorrect: Math.max(0, Math.trunc(params.totalCorrect)),
        source: toPracticeSourceProto(params.source),
      }),
    },
  });
  enqueuePracticeEvent(event, options);
}

export function logCipherStartedEvent(params: {
  cipher: TestableCipherType;
  mode?: string;
  quoteId: number;
  source: CipherPracticeSource;
}): void {
  const event = create(PracticeEventSchema, {
    eventId: generateEventId(),
    clientTimestampMs: Date.now(),
    payload: {
      case: 'cipherStarted',
      value: create(CipherStartedEventSchema, {
        cipher: params.cipher,
        mode: params.mode ?? '',
        quoteId: Math.max(0, Math.trunc(params.quoteId)),
        source: toPracticeSourceProto(params.source),
      }),
    },
  });
  enqueuePracticeEvent(event);
}

export function logCipherSolvedEvent(params: {
  cipher: TestableCipherType;
  mode?: string;
  quoteId: number;
  elapsedSec: number;
  alphaCharCount: number;
  uniqueAlphaCharCount: number;
  inputMode?: string;
  errorCount: number;
  correctChars: number;
  scoreTier: ScoreTier;
  source: CipherPracticeSource;
}): void {
  const event = create(PracticeEventSchema, {
    eventId: generateEventId(),
    clientTimestampMs: Date.now(),
    payload: {
      case: 'cipherSolved',
      value: create(CipherSolvedEventSchema, {
        cipher: params.cipher,
        mode: params.mode ?? '',
        quoteId: Math.max(0, Math.trunc(params.quoteId)),
        elapsedSec: Math.round(Math.max(0, params.elapsedSec) * 10) / 10,
        alphaCharCount: Math.max(0, Math.trunc(params.alphaCharCount)),
        uniqueAlphaCharCount: Math.max(
          0,
          Math.trunc(params.uniqueAlphaCharCount)
        ),
        inputMode: params.inputMode ?? '',
        errorCount: Math.max(0, Math.trunc(params.errorCount)),
        correctChars: Math.max(0, Math.trunc(params.correctChars)),
        scoreTier: toScoreTierProto(params.scoreTier),
        source: toPracticeSourceProto(params.source),
      }),
    },
  });
  enqueuePracticeEvent(event, { immediate: true });
}
