import type http from 'node:http';
import { BigQuery } from '@google-cloud/bigquery';
import type { Firestore } from 'firebase-admin/firestore';

export type AnalyticsWindow = '7d' | '30d' | '90d' | 'all';
export type DashboardScope = 'all' | 'summary' | 'drills' | 'ciphers';

export interface AnalyticsProfileInfo {
  displayName: string;
  role: 'student' | 'teacher';
}

export interface AnalyticsServerHelpers {
  getAdminServices: () => Promise<{
    auth: {
      verifyIdToken: (
        idToken: string
      ) => Promise<{ uid?: string; email?: string }>;
    };
    db: Firestore;
  }>;
  readRawBody: (req: http.IncomingMessage, maxBytes: number) => Promise<Buffer>;
  sendJson: (
    res: http.ServerResponse,
    statusCode: number,
    payload: Record<string, unknown>
  ) => void;
  setCorsHeaders: (res: http.ServerResponse) => void;
}

interface ParsedDashboardRequest {
  mode: 'dashboard';
  scope: DashboardScope;
  window: AnalyticsWindow;
  includeSharedLinks: boolean;
  uid?: string;
}

interface ParsedAttemptBreakdownRequest {
  mode: 'attempt_breakdown';
  attemptId: string;
}

type ParsedAnalyticsRequest =
  | ParsedDashboardRequest
  | ParsedAttemptBreakdownRequest;

class AnalyticsRequestError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const MAX_QUERY_BODY_BYTES = 16 * 1024;
const MAX_BYTES_BILLED = '250000000'; // 250 MB safety cap per query
const BQ_DATASET = 'codebusters_analytics';
const BQ_TABLE = 'practice_events';
const DEFAULT_ALL_WINDOW_ISO = '2024-01-01T00:00:00.000Z';

const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ATTEMPT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,240}$/;
const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,61}$/;

const WINDOW_DAYS: Record<Exclude<AnalyticsWindow, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

let bigqueryClient: BigQuery | null = null;

function getBigQueryClient(): { client: BigQuery; tableRef: string } {
  const rawProjectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    'codebusters-6599d';
  const projectId = PROJECT_ID_RE.test(rawProjectId)
    ? rawProjectId
    : 'codebusters-6599d';

  if (!bigqueryClient) {
    bigqueryClient = new BigQuery({ projectId });
  }
  return {
    client: bigqueryClient,
    tableRef: `\`${projectId}.${BQ_DATASET}.${BQ_TABLE}\``,
  };
}

function resolveWindowStartIso(window: AnalyticsWindow): string {
  if (window === 'all') {
    return DEFAULT_ALL_WINDOW_ISO;
  }
  const days = WINDOW_DAYS[window];
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseAnalyticsRequest(raw: unknown): ParsedAnalyticsRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AnalyticsRequestError('Request body must be a JSON object.');
  }
  const body = raw as Record<string, unknown>;
  const mode = body.mode;

  if (mode === 'attempt_breakdown') {
    if (typeof body.attemptId !== 'string' || !ATTEMPT_ID_RE.test(body.attemptId)) {
      throw new AnalyticsRequestError('Invalid attemptId.');
    }
    return {
      mode: 'attempt_breakdown',
      attemptId: body.attemptId,
    };
  }

  if (mode === 'dashboard' || mode === undefined) {
    const rawScope = body.scope ?? 'all';
    if (
      rawScope !== 'all' &&
      rawScope !== 'summary' &&
      rawScope !== 'drills' &&
      rawScope !== 'ciphers'
    ) {
      throw new AnalyticsRequestError('Invalid scope parameter.');
    }

    const rawWindow = body.window ?? '30d';
    if (
      rawWindow !== '7d' &&
      rawWindow !== '30d' &&
      rawWindow !== '90d' &&
      rawWindow !== 'all'
    ) {
      throw new AnalyticsRequestError('Invalid window parameter.');
    }

    let uidFilter: string | undefined;
    if (body.uid !== undefined && body.uid !== null && body.uid !== '') {
      if (typeof body.uid !== 'string' || !UID_RE.test(body.uid)) {
        throw new AnalyticsRequestError('Invalid uid filter.');
      }
      uidFilter = body.uid;
    }

    const includeSharedLinks = body.includeSharedLinks === true;

    return {
      mode: 'dashboard',
      scope: rawScope,
      window: rawWindow,
      includeSharedLinks,
      uid: uidFilter,
    };
  }

  throw new AnalyticsRequestError('Unsupported analytics query mode.');
}

async function isTeacherOnRoster(
  db: Firestore,
  email: string
): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > 320 || normalized.includes('/')) {
    return false;
  }
  const snap = await db.collection('allowed_users').doc(normalized).get();
  if (!snap.exists) return false;
  const data = snap.data() as { active?: unknown; role?: unknown } | undefined;
  return data?.active !== false && data?.role === 'teacher';
}

async function fetchProfilesMap(
  db: Firestore
): Promise<Record<string, AnalyticsProfileInfo>> {
  const snapshot = await db.collection('profiles').get();
  const profiles: Record<string, AnalyticsProfileInfo> = {};
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() as {
      displayName?: unknown;
      role?: unknown;
    };
    const displayName =
      typeof data.displayName === 'string' && data.displayName.trim()
        ? data.displayName.trim()
        : 'Decoder';
    const role = data.role === 'teacher' ? 'teacher' : 'student';
    profiles[docSnap.id] = { displayName, role };
  }
  return profiles;
}

function toNum(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toNullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toStr(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function buildDedupedCte(
  tableRef: string,
  hasEventTypeFilter: boolean
): string {
  const eventTypeClause = hasEventTypeFilter
    ? 'AND event_type = @eventTypeFilter'
    : '';
  // Deduplicate on event_id so client batch retries never double-count sessions.
  return `
    WITH deduped AS (
      SELECT
        timestamp,
        COALESCE(client_timestamp, timestamp) AS event_ts,
        uid,
        event_type,
        source,
        drill_id,
        session_duration_sec,
        session_best_60s_score,
        total_answered,
        total_correct,
        cipher,
        mode,
        elapsed_sec,
        alpha_char_count,
        unique_alpha_char_count,
        input_mode,
        score_tier,
        attempt_id,
        active_screen_time_sec
      FROM ${tableRef}
      WHERE timestamp >= TIMESTAMP(@minTimestamp)
        AND event_id IS NOT NULL
        AND uid IS NOT NULL
        AND uid != ''
        AND (NOT @hasUidFilter OR uid = @uidFilter)
        ${eventTypeClause}
      QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY timestamp ASC) = 1
    ),
    scoped AS (
      SELECT *
      FROM deduped
      WHERE (
        event_type = 'practice_test_question_user'
        OR NOT @excludeSharedLinks
        OR source IS NULL
        OR source != 'shared_link'
      )
    )
  `;
}

async function runDashboardQueries(reqData: ParsedDashboardRequest) {
  const { client, tableRef } = getBigQueryClient();
  const minTimestamp = resolveWindowStartIso(reqData.window);
  const hasUidFilter = Boolean(reqData.uid);
  const uidFilter = reqData.uid ?? '';
  const excludeSharedLinks = !reqData.includeSharedLinks;

  const baseParams = {
    minTimestamp,
    hasUidFilter,
    uidFilter,
    excludeSharedLinks,
  };
  const baseTypes = {
    minTimestamp: 'STRING',
    hasUidFilter: 'BOOL',
    uidFilter: 'STRING',
    excludeSharedLinks: 'BOOL',
  };

  const summaryCte = buildDedupedCte(tableRef, false);
  const drillCte = buildDedupedCte(tableRef, true);
  const cipherCte = buildDedupedCte(tableRef, true);

  const studentSummarySql = `
    ${summaryCte}
    SELECT
      uid,
      COUNTIF(event_type = 'drill_session') AS drill_sessions,
      COALESCE(SUM(CASE WHEN event_type = 'drill_session' THEN COALESCE(session_duration_sec, 0) ELSE 0 END), 0) AS drill_duration_sec,
      COALESCE(SUM(CASE WHEN event_type = 'drill_session' THEN COALESCE(total_answered, 0) ELSE 0 END), 0) AS drill_answered,
      COALESCE(SUM(CASE WHEN event_type = 'drill_session' THEN COALESCE(total_correct, 0) ELSE 0 END), 0) AS drill_correct,
      COUNTIF(event_type = 'cipher_started') AS ciphers_started,
      COUNTIF(event_type = 'cipher_solved') AS ciphers_solved,
      COUNTIF(event_type = 'cipher_solved' AND score_tier IN ('full', 'half')) AS ciphers_passed,
      COUNTIF(event_type = 'cipher_solved' AND score_tier = 'full') AS ciphers_full_score,
      COALESCE(SUM(CASE WHEN event_type = 'cipher_solved' THEN COALESCE(elapsed_sec, 0) ELSE 0 END), 0) AS cipher_solve_duration_sec,
      COALESCE(SUM(CASE WHEN event_type = 'practice_test_question_user' THEN COALESCE(active_screen_time_sec, 0) ELSE 0 END), 0) AS test_active_sec,
      COUNT(DISTINCT CASE WHEN event_type = 'practice_test_question_user' THEN attempt_id ELSE NULL END) AS tests_participated,
      FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', MAX(event_ts)) AS last_active_iso
    FROM scoped
    GROUP BY uid
    ORDER BY (drill_duration_sec + cipher_solve_duration_sec + test_active_sec) DESC
  `;

  const drillSeriesSql = `
    ${drillCte}
    SELECT
      FORMAT_DATE('%Y-%m-%d', DATE(event_ts, 'UTC')) AS day,
      uid,
      drill_id,
      COUNT(*) AS sessions,
      MAX(COALESCE(session_best_60s_score, 0)) AS best_60s_score,
      SUM(COALESCE(session_best_60s_score, 0)) AS sum_best_60s_score,
      SUM(COALESCE(total_answered, 0)) AS total_answered,
      SUM(COALESCE(total_correct, 0)) AS total_correct,
      SUM(COALESCE(session_duration_sec, 0)) AS total_duration_sec
    FROM scoped
    WHERE drill_id IS NOT NULL
      AND drill_id != ''
    GROUP BY day, uid, drill_id
    ORDER BY day ASC
  `;

  const cipherSeriesSql = `
    ${cipherCte},
    cipher_rows AS (
      SELECT
        FORMAT_DATE('%Y-%m-%d', DATE(event_ts, 'UTC')) AS day,
        uid,
        cipher,
        COALESCE(mode, '') AS mode,
        COALESCE(input_mode, 'standard') AS input_mode,
        score_tier,
        COALESCE(elapsed_sec, 0) AS elapsed_sec,
        CASE
          WHEN cipher = 'aristocrat' AND input_mode = 'linked'
            THEN SAFE_DIVIDE(elapsed_sec, NULLIF(unique_alpha_char_count, 0))
          ELSE SAFE_DIVIDE(elapsed_sec, NULLIF(alpha_char_count, 0))
        END AS normalized_pace
      FROM scoped
      WHERE cipher IS NOT NULL
        AND cipher != ''
    )
    SELECT
      day,
      uid,
      cipher,
      mode,
      input_mode,
      COUNT(*) AS submissions,
      COUNTIF(score_tier IN ('full', 'half')) AS passing_solves,
      COUNTIF(score_tier = 'full') AS full_score_count,
      SUM(elapsed_sec) AS sum_elapsed_sec,
      SUM(CASE WHEN score_tier IN ('full', 'half') AND normalized_pace > 0 THEN normalized_pace ELSE 0 END) AS sum_normalized_pace,
      COUNTIF(score_tier IN ('full', 'half') AND normalized_pace > 0) AS paced_solve_count,
      MIN(CASE WHEN score_tier IN ('full', 'half') AND normalized_pace > 0 THEN normalized_pace ELSE NULL END) AS best_normalized_pace
    FROM cipher_rows
    GROUP BY day, uid, cipher, mode, input_mode
    ORDER BY day ASC
  `;

  const wantSummary = reqData.scope === 'all' || reqData.scope === 'summary';
  const wantDrills = reqData.scope === 'all' || reqData.scope === 'drills';
  const wantCiphers = reqData.scope === 'all' || reqData.scope === 'ciphers';

  const [summaryRows, drillRows, cipherRows] = await Promise.all([
    wantSummary
      ? client
          .query({
            query: studentSummarySql,
            params: baseParams,
            types: baseTypes,
            maximumBytesBilled: MAX_BYTES_BILLED,
          })
          .then((res) => res[0] as Record<string, unknown>[])
      : Promise.resolve<Record<string, unknown>[]>([]),
    wantDrills
      ? client
          .query({
            query: drillSeriesSql,
            params: { ...baseParams, eventTypeFilter: 'drill_session' },
            types: { ...baseTypes, eventTypeFilter: 'STRING' },
            maximumBytesBilled: MAX_BYTES_BILLED,
          })
          .then((res) => res[0] as Record<string, unknown>[])
      : Promise.resolve<Record<string, unknown>[]>([]),
    wantCiphers
      ? client
          .query({
            query: cipherSeriesSql,
            params: { ...baseParams, eventTypeFilter: 'cipher_solved' },
            types: { ...baseTypes, eventTypeFilter: 'STRING' },
            maximumBytesBilled: MAX_BYTES_BILLED,
          })
          .then((res) => res[0] as Record<string, unknown>[])
      : Promise.resolve<Record<string, unknown>[]>([]),
  ]);

  const studentSummaries = summaryRows.map((row) => ({
    uid: toStr(row.uid),
    drillSessions: toNum(row.drill_sessions),
    drillDurationSec: toNum(row.drill_duration_sec),
    drillAnswered: toNum(row.drill_answered),
    drillCorrect: toNum(row.drill_correct),
    ciphersStarted: toNum(row.ciphers_started),
    ciphersSolved: toNum(row.ciphers_solved),
    ciphersPassed: toNum(row.ciphers_passed),
    ciphersFullScore: toNum(row.ciphers_full_score),
    cipherSolveDurationSec: toNum(row.cipher_solve_duration_sec),
    testActiveSec: toNum(row.test_active_sec),
    testsParticipated: toNum(row.tests_participated),
    lastActiveIso: toStr(row.last_active_iso),
  }));

  const drillSeries = drillRows.map((row) => ({
    day: toStr(row.day),
    uid: toStr(row.uid),
    drillId: toStr(row.drill_id),
    sessions: toNum(row.sessions),
    best60sScore: toNum(row.best_60s_score),
    sumBest60sScore: toNum(row.sum_best_60s_score),
    totalAnswered: toNum(row.total_answered),
    totalCorrect: toNum(row.total_correct),
    totalDurationSec: toNum(row.total_duration_sec),
  }));

  const cipherSeries = cipherRows.map((row) => ({
    day: toStr(row.day),
    uid: toStr(row.uid),
    cipher: toStr(row.cipher),
    mode: toStr(row.mode),
    inputMode: toStr(row.input_mode) || 'standard',
    submissions: toNum(row.submissions),
    passingSolves: toNum(row.passing_solves),
    fullScoreCount: toNum(row.full_score_count),
    sumElapsedSec: toNum(row.sum_elapsed_sec),
    sumNormalizedPace: toNum(row.sum_normalized_pace),
    pacedSolveCount: toNum(row.paced_solve_count),
    bestNormalizedPace: toNullableNum(row.best_normalized_pace),
  }));

  return { studentSummaries, drillSeries, cipherSeries };
}

async function runAttemptBreakdownQuery(attemptId: string) {
  const { client, tableRef } = getBigQueryClient();
  const sql = `
    SELECT
      uid,
      question_number,
      cipher,
      COALESCE(mode, '') AS mode,
      quote_id,
      COALESCE(is_collaborative, FALSE) AS is_collaborative,
      COALESCE(team_size, 1) AS team_size,
      COALESCE(total_test_elapsed_sec, 0) AS total_test_elapsed_sec,
      COALESCE(active_screen_time_sec, 0) AS active_screen_time_sec,
      COALESCE(correct_gradable_inputs, 0) AS correct_gradable_inputs,
      COALESCE(total_gradable_units, 0) AS total_gradable_units
    FROM ${tableRef}
    WHERE timestamp >= TIMESTAMP(@minTimestamp)
      AND event_type = 'practice_test_question_user'
      AND attempt_id = @attemptId
    QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY timestamp ASC) = 1
    ORDER BY question_number ASC, uid ASC
  `;

  const [rows] = await client.query({
    query: sql,
    params: {
      minTimestamp: DEFAULT_ALL_WINDOW_ISO,
      attemptId,
    },
    types: {
      minTimestamp: 'STRING',
      attemptId: 'STRING',
    },
    maximumBytesBilled: MAX_BYTES_BILLED,
  });

  return (rows as Record<string, unknown>[]).map((row) => ({
    uid: toStr(row.uid),
    questionNumber: toNum(row.question_number),
    cipher: toStr(row.cipher),
    mode: toStr(row.mode),
    quoteId: toNullableNum(row.quote_id),
    isCollaborative: row.is_collaborative === true,
    teamSize: toNum(row.team_size, 1),
    totalTestElapsedSec: toNum(row.total_test_elapsed_sec),
    activeScreenTimeSec: toNum(row.active_screen_time_sec),
    correctGradableInputs: toNum(row.correct_gradable_inputs),
    totalGradableUnits: toNum(row.total_gradable_units),
  }));
}

/**
 * Authenticated HTTP handler for teacher-only practice analytics queries against BigQuery + Firestore.
 */
export async function handleQueryPracticeAnalytics(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  helpers: AnalyticsServerHelpers
): Promise<void> {
  const { getAdminServices, readRawBody, sendJson, setCorsHeaders } = helpers;
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    sendJson(res, 401, { error: 'Missing Bearer token' });
    return;
  }
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) {
    sendJson(res, 401, { error: 'Empty Bearer token' });
    return;
  }

  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req, MAX_QUERY_BODY_BYTES);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'Payload Too Large' });
      return;
    }
    sendJson(res, 400, { error: 'Invalid request stream' });
    return;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody.toString('utf8'));
  } catch {
    sendJson(res, 400, { error: 'Malformed JSON body' });
    return;
  }

  let queryRequest: ParsedAnalyticsRequest;
  try {
    queryRequest = parseAnalyticsRequest(parsedJson);
  } catch (err) {
    if (err instanceof AnalyticsRequestError) {
      sendJson(res, err.statusCode, { error: err.message });
      return;
    }
    sendJson(res, 400, { error: 'Invalid query request' });
    return;
  }

  const { auth, db } = await getAdminServices();

  let decodedToken: { uid?: string; email?: string };
  try {
    decodedToken = await auth.verifyIdToken(idToken);
  } catch {
    sendJson(res, 401, { error: 'Invalid ID token' });
    return;
  }

  const email = decodedToken.email || '';
  const isTeacher = await isTeacherOnRoster(db, email);
  if (!isTeacher) {
    sendJson(res, 403, { error: 'Teacher role required' });
    return;
  }

  try {
    const profiles = await fetchProfilesMap(db);

    if (queryRequest.mode === 'attempt_breakdown') {
      const rows = await runAttemptBreakdownQuery(queryRequest.attemptId);
      sendJson(res, 200, {
        mode: 'attempt_breakdown',
        attemptId: queryRequest.attemptId,
        profiles,
        rows,
      });
      return;
    }

    const dashboardData = await runDashboardQueries(queryRequest);
    sendJson(res, 200, {
      mode: 'dashboard',
      scope: queryRequest.scope,
      window: queryRequest.window,
      includeSharedLinks: queryRequest.includeSharedLinks,
      profiles,
      ...dashboardData,
    });
  } catch (err) {
    console.error('[analytics] Query failed:', err);
    sendJson(res, 500, { error: 'Failed to query analytics' });
  }
}
