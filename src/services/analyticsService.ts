import { auth, isFirebaseConfigured } from './firebase';

export type AnalyticsWindow = '7d' | '30d' | '90d' | 'all';

export interface AnalyticsProfileInfo {
  displayName: string;
  role: 'student' | 'teacher';
}

export interface StudentEngagementSummary {
  uid: string;
  drillSessions: number;
  drillDurationSec: number;
  drillAnswered: number;
  drillCorrect: number;
  ciphersStarted: number;
  ciphersSolved: number;
  ciphersPassed: number;
  ciphersFullScore: number;
  cipherSolveDurationSec: number;
  testActiveSec: number;
  testsParticipated: number;
  lastActiveIso: string;
}

export interface DrillSeriesPoint {
  day: string;
  uid: string;
  drillId: string;
  sessions: number;
  best60sScore: number;
  sumBest60sScore: number;
  totalAnswered: number;
  totalCorrect: number;
  totalDurationSec: number;
}

export interface CipherSeriesPoint {
  day: string;
  uid: string;
  cipher: string;
  mode: string;
  inputMode: string;
  submissions: number;
  passingSolves: number;
  fullScoreCount: number;
  sumElapsedSec: number;
  sumNormalizedPace: number;
  pacedSolveCount: number;
  bestNormalizedPace: number | null;
}

export interface DashboardAnalyticsResponse {
  mode: 'dashboard';
  window: AnalyticsWindow;
  includeSharedLinks: boolean;
  profiles: Record<string, AnalyticsProfileInfo>;
  studentSummaries: StudentEngagementSummary[];
  drillSeries: DrillSeriesPoint[];
  cipherSeries: CipherSeriesPoint[];
}

export interface AttemptBreakdownRow {
  uid: string;
  questionNumber: number;
  cipher: string;
  mode: string;
  quoteId: number | null;
  isCollaborative: boolean;
  teamSize: number;
  totalTestElapsedSec: number;
  activeScreenTimeSec: number;
  correctGradableInputs: number;
  totalGradableUnits: number;
}

export interface AttemptBreakdownResponse {
  mode: 'attempt_breakdown';
  attemptId: string;
  profiles: Record<string, AnalyticsProfileInfo>;
  rows: AttemptBreakdownRow[];
}

function getQueryAnalyticsEndpointUrl(): string | null {
  const explicit = import.meta.env.VITE_QUERY_ANALYTICS_URL as
    | string
    | undefined;
  if (explicit && explicit.trim()) {
    return explicit.trim();
  }

  const logEventsUrl = import.meta.env.VITE_LOG_EVENTS_URL as
    | string
    | undefined;
  if (logEventsUrl && logEventsUrl.trim()) {
    return logEventsUrl
      .trim()
      .replace(/\/logPracticeEvents\/?$/, '/queryPracticeAnalytics');
  }

  const senderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as
    | string
    | undefined;
  if (senderId && /^\d+$/.test(senderId.trim())) {
    return `https://codebusters-events-${senderId.trim()}.us-central1.run.app/queryPracticeAnalytics`;
  }

  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as
    | string
    | undefined;
  if (projectId && projectId.trim()) {
    return `https://us-central1-${projectId.trim()}.cloudfunctions.net/queryPracticeAnalytics`;
  }

  return null;
}

async function postAnalyticsQuery<T>(
  payload: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  if (!isFirebaseConfigured() || !auth?.currentUser) {
    throw new Error('Sign in as a teacher to query analytics.');
  }

  const endpoint = getQueryAnalyticsEndpointUrl();
  if (!endpoint) {
    throw new Error('Analytics endpoint is not configured.');
  }

  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    let errorMsg = `Analytics request failed (${res.status})`;
    try {
      const errJson = (await res.json()) as { error?: unknown };
      if (typeof errJson.error === 'string' && errJson.error.trim()) {
        errorMsg = errJson.error.trim();
      }
    } catch {
      // Ignore JSON parse failure on non-JSON error responses
    }
    throw new Error(errorMsg);
  }

  return (await res.json()) as T;
}

export async function fetchDashboardAnalytics(options: {
  window: AnalyticsWindow;
  includeSharedLinks: boolean;
  uid?: string;
  signal?: AbortSignal;
}): Promise<DashboardAnalyticsResponse> {
  const payload: Record<string, unknown> = {
    mode: 'dashboard',
    window: options.window,
    includeSharedLinks: options.includeSharedLinks,
  };
  if (options.uid) {
    payload.uid = options.uid;
  }
  return postAnalyticsQuery<DashboardAnalyticsResponse>(
    payload,
    options.signal
  );
}

export async function fetchAttemptBreakdown(
  attemptId: string,
  signal?: AbortSignal
): Promise<AttemptBreakdownResponse> {
  return postAnalyticsQuery<AttemptBreakdownResponse>(
    {
      mode: 'attempt_breakdown',
      attemptId,
    },
    signal
  );
}
