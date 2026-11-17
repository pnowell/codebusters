import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GENERAL_PRACTICE_DRILLS } from '../../data/drills';
import { useDualPaneTabs, type DualPaneTab } from '../../hooks/useDualPaneTabs';
import {
  fetchDashboardAnalytics,
  type AnalyticsProfileInfo,
  type AnalyticsWindow,
  type CipherSeriesPoint,
  type DashboardAnalyticsResponse,
  type DashboardScope,
  type DrillSeriesPoint,
  type StudentEngagementSummary,
} from '../../services/analyticsService';
import '../../styles/analytics.css';
import {
  CiphersTabIcon,
  DrillsTabIcon,
} from '../shared/DualPaneTabIcons';
import { UPlotChart, type UPlotLineSeries } from './UPlotChart';

interface TeacherAnalyticsViewProps {
  onBack: () => void;
}

type AristocratModeFilter = 'all' | 'linked' | 'paper';

const WINDOW_OPTIONS: ReadonlyArray<{ id: AnalyticsWindow; label: string }> = [
  { id: '7d', label: '7 Days' },
  { id: '30d', label: '30 Days' },
  { id: '90d', label: '90 Days' },
  { id: 'all', label: 'All Time' },
];

const WINDOW_SECONDS: Record<AnalyticsWindow, number> = {
  '7d': 7 * 86_400,
  '30d': 30 * 86_400,
  '90d': 90 * 86_400,
  all: 30 * 86_400,
};

const CANONICAL_DRILLS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'offsetsLetterToNum', label: 'Letter Offsets (A → 1)' },
  { id: 'offsetsNumToLetter', label: 'Letter Offsets (1 → A)' },
  { id: 'letterMathEasy', label: 'ABC ± # (Num Easy)' },
  { id: 'letterMathHard', label: 'ABC ± # (Num Hard)' },
  { id: 'letterMathLetterEasy', label: 'ABC ± # (Letter Easy)' },
  { id: 'letterMathLetterHard', label: 'ABC ± # (Letter Hard)' },
  { id: 'atbash', label: 'Atbash' },
  { id: 'pigpen', label: 'Pigpen' },
  { id: 'galactic', label: 'Standard Galactic' },
  { id: 'tap', label: 'Tap Code' },
  { id: 'knights', label: 'Knights Templar' },
];

const CANONICAL_CIPHERS: ReadonlyArray<{ id: string; label: string }> =
  GENERAL_PRACTICE_DRILLS.map((d) => ({
    id: d.id,
    label: d.shortTitle,
  }));

const STUDENT_PALETTE: readonly string[] = [
  '#38bdf8', // Sky
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#a855f7', // Violet
  '#fb7185', // Rose
  '#22d3ee', // Cyan
  '#60a5fa', // Blue
  '#facc15', // Yellow
  '#4ade80', // Mint
  '#f97316', // Orange
  '#c084fc', // Lavender
  '#e879f9', // Fuchsia
];

const UTC_TOOLTIP_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatDuration(totalSec: number): string {
  const rounded = Math.max(0, Math.round(totalSec));
  if (rounded === 0) return '0m';
  const hours = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  return `${secs}s`;
}

function formatShortDate(iso: string): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return UTC_TOOLTIP_FMT.format(new Date(ms));
}

function getProfileName(
  uid: string,
  profiles: Record<string, AnalyticsProfileInfo>
): string {
  const found = profiles[uid];
  if (found?.displayName) return found.displayName;
  if (uid.length > 10) return `User ${uid.slice(0, 6)}`;
  return uid || 'Decoder';
}

function dayToMiddayEpochSec(day: string): number {
  const parsed = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

interface ScopedAnalyticsState {
  data: DashboardAnalyticsResponse | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetches one analytics dashboard scope independently without synchronous setState inside effects.
 */
function useScopedAnalytics(
  scope: Exclude<DashboardScope, 'all'>,
  windowRange: AnalyticsWindow,
  includeSharedLinks: boolean,
  refreshNonce: number,
  enabled: boolean
): ScopedAnalyticsState {
  const expectedKey = enabled
    ? `${scope}|${windowRange}|${includeSharedLinks ? '1' : '0'}|${refreshNonce}`
    : '';
  const [fetchState, setFetchState] = useState<{
    key: string;
    data: DashboardAnalyticsResponse | null;
    error: string | null;
  }>({ key: '', data: null, error: null });

  useEffect(() => {
    if (!expectedKey) return;

    const controller = new AbortController();
    fetchDashboardAnalytics({
      scope,
      window: windowRange,
      includeSharedLinks,
      signal: controller.signal,
    })
      .then((res) => {
        if (!controller.signal.aborted) {
          setFetchState({ key: expectedKey, data: res, error: null });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Unable to load practice analytics.';
        setFetchState((prev) => ({
          key: expectedKey,
          data: prev.data,
          error: message,
        }));
      });

    return () => controller.abort();
  }, [expectedKey, scope, windowRange, includeSharedLinks]);

  if (!enabled) {
    return {
      data: fetchState.data,
      isLoading: false,
      error: null,
    };
  }

  return {
    data: fetchState.data,
    isLoading: fetchState.key !== expectedKey,
    error: fetchState.key === expectedKey ? fetchState.error : null,
  };
}

interface VolumeSegment {
  uid: string;
  label: string;
  color: string;
  value: number;
  detail: string;
}

interface VolumeBarProps {
  label: string;
  statText: string;
  segments: VolumeSegment[];
  totalValue: number;
  maxColumnValue: number;
}

const VolumeBar: React.FC<VolumeBarProps> = ({
  label,
  statText,
  segments,
  totalValue,
  maxColumnValue,
}) => {
  const fillPct =
    totalValue > 0 && maxColumnValue > 0
      ? Math.min(100, Math.max(4, (totalValue / maxColumnValue) * 100))
      : 0;

  return (
    <div className="analytics-volume-block">
      <div className="analytics-volume-meta">
        <span>{label}</span>
        <span className="analytics-volume-stat">{statText}</span>
      </div>
      <div className="analytics-bar-track" aria-label={`${label}: ${statText}`}>
        {fillPct > 0 && totalValue > 0 && (
          <div
            className="analytics-bar-segments"
            style={{ width: `${fillPct.toFixed(2)}%` }}
          >
            {segments.map((seg) => {
              const segPct = (seg.value / totalValue) * 100;
              return (
                <span
                  key={seg.uid}
                  className="analytics-bar-seg"
                  style={{
                    width: `${segPct.toFixed(2)}%`,
                    backgroundColor: seg.color,
                  }}
                  title={seg.detail}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

function buildStudentSeriesModel(options: {
  days: string[];
  uidList: string[];
  getValue: (day: string, uid: string) => number | null;
  profiles: Record<string, AnalyticsProfileInfo>;
  studentColorMap: Map<string, string>;
  formatValue: (val: number) => string;
}): { timestamps: number[]; dateLabels: string[]; series: UPlotLineSeries[] } {
  const sortedDays = [...options.days].sort();
  const timestamps = sortedDays.map(dayToMiddayEpochSec);
  const dateLabels = sortedDays.map((d) => formatShortDate(`${d}T12:00:00Z`));

  const series: UPlotLineSeries[] = [];
  for (const uid of options.uidList) {
    const values = sortedDays.map((day) => options.getValue(day, uid));
    if (!values.some((v) => v !== null && Number.isFinite(v))) {
      continue;
    }
    series.push({
      id: uid,
      label: getProfileName(uid, options.profiles),
      color: options.studentColorMap.get(uid) ?? STUDENT_PALETTE[0],
      values,
      formatValue: options.formatValue,
    });
  }

  return { timestamps, dateLabels, series };
}

/**
 * Lazy-loaded teacher analytics dashboard mirroring MainMenu's Drills / Ciphers split.
 */
export const TeacherAnalyticsView: React.FC<TeacherAnalyticsViewProps> = ({
  onBack,
}) => {
  const [windowRange, setWindowRange] = useState<AnalyticsWindow>('30d');
  const [includeSharedLinks, setIncludeSharedLinks] = useState<boolean>(false);
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [aristocratModeFilter, setAristocratModeFilter] =
    useState<AristocratModeFilter>('all');
  const [refreshNonce, setRefreshNonce] = useState<number>(0);
  const [mountNowSec] = useState<number>(() => Math.floor(Date.now() / 1000));

  const [activeTab, setActiveTab] = useState<DualPaneTab>('drills');
  const {
    viewportRef,
    isSideBySide,
    isDragging,
    indicatorProgress,
    visualActiveTab,
    trackTransform,
    handlePointerDown,
    handlePointerMove,
    finishSwipe,
    handleClickCapture,
    handleTabKeyDown,
  } = useDualPaneTabs({
    activeTab,
    onSelectTab: setActiveTab,
    drillsTabId: 'analytics-tab-drills',
    ciphersTabId: 'analytics-tab-ciphers',
  });

  const summaryScope = useScopedAnalytics(
    'summary',
    windowRange,
    includeSharedLinks,
    refreshNonce,
    true
  );
  const drillsScope = useScopedAnalytics(
    'drills',
    windowRange,
    includeSharedLinks,
    refreshNonce,
    isSideBySide || activeTab === 'drills'
  );
  const ciphersScope = useScopedAnalytics(
    'ciphers',
    windowRange,
    includeSharedLinks,
    refreshNonce,
    isSideBySide || activeTab === 'ciphers' || (isDragging && activeTab === 'drills')
  );

  const isAnyLoading =
    summaryScope.isLoading || drillsScope.isLoading || ciphersScope.isLoading;

  const firstError =
    summaryScope.error || drillsScope.error || ciphersScope.error;

  const handleRefresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);

  const profiles = useMemo<Record<string, AnalyticsProfileInfo>>(
    () => ({
      ...(ciphersScope.data?.profiles ?? {}),
      ...(drillsScope.data?.profiles ?? {}),
      ...(summaryScope.data?.profiles ?? {}),
    }),
    [ciphersScope.data?.profiles, drillsScope.data?.profiles, summaryScope.data?.profiles]
  );

  // Order students consistently (summary volume first, then alphabetically by name).
  const orderedStudentUids = useMemo(() => {
    const rankByUid = new Map<string, number>();
    (summaryScope.data?.studentSummaries ?? []).forEach((s, idx) => {
      rankByUid.set(s.uid, idx);
    });

    const uids = new Set<string>();
    for (const s of summaryScope.data?.studentSummaries ?? []) uids.add(s.uid);
    for (const r of drillsScope.data?.drillSeries ?? []) uids.add(r.uid);
    for (const r of ciphersScope.data?.cipherSeries ?? []) uids.add(r.uid);

    return Array.from(uids).sort((a, b) => {
      const rankA = rankByUid.get(a);
      const rankB = rankByUid.get(b);
      if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
      if (rankA !== undefined) return -1;
      if (rankB !== undefined) return 1;
      return getProfileName(a, profiles).localeCompare(getProfileName(b, profiles));
    });
  }, [
    ciphersScope.data?.cipherSeries,
    drillsScope.data?.drillSeries,
    profiles,
    summaryScope.data?.studentSummaries,
  ]);

  const studentColorMap = useMemo(() => {
    const map = new Map<string, string>();
    orderedStudentUids.forEach((uid, idx) => {
      map.set(uid, STUDENT_PALETTE[idx % STUDENT_PALETTE.length]);
    });
    return map;
  }, [orderedStudentUids]);

  const studentOptions = useMemo(
    () =>
      orderedStudentUids
        .map((uid) => ({
          uid,
          displayName: getProfileName(uid, profiles),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [orderedStudentUids, profiles]
  );

  const effectiveSelectedUid = useMemo(() => {
    if (!selectedUid) return '';
    return orderedStudentUids.includes(selectedUid) ? selectedUid : '';
  }, [orderedStudentUids, selectedUid]);

  const filteredSummaries = useMemo<StudentEngagementSummary[]>(() => {
    const list = summaryScope.data?.studentSummaries ?? [];
    if (!effectiveSelectedUid) return list;
    return list.filter((s) => s.uid === effectiveSelectedUid);
  }, [effectiveSelectedUid, summaryScope.data?.studentSummaries]);

  const kpis = useMemo(() => {
    let totalActiveSec = 0;
    let drillSessions = 0;
    let drillAnswered = 0;
    let drillCorrect = 0;
    let ciphersPassed = 0;
    let ciphersFullScore = 0;
    let ciphersSolved = 0;

    for (const s of filteredSummaries) {
      totalActiveSec +=
        s.drillDurationSec + s.cipherSolveDurationSec + s.testActiveSec;
      drillSessions += s.drillSessions;
      drillAnswered += s.drillAnswered;
      drillCorrect += s.drillCorrect;
      ciphersPassed += s.ciphersPassed;
      ciphersFullScore += s.ciphersFullScore;
      ciphersSolved += s.ciphersSolved;
    }

    const drillAccuracyPct =
      drillAnswered > 0 ? Math.round((drillCorrect / drillAnswered) * 100) : null;
    const fullRatePct =
      ciphersSolved > 0
        ? Math.round((ciphersFullScore / ciphersSolved) * 100)
        : null;

    return {
      totalActiveSec,
      drillSessions,
      drillAnswered,
      drillAccuracyPct,
      ciphersPassed,
      ciphersFullScore,
      fullRatePct,
    };
  }, [filteredSummaries]);

  const emptyWindowSec = useMemo<[number, number]>(
    () => [mountNowSec - WINDOW_SECONDS[windowRange], mountNowSec],
    [mountNowSec, windowRange]
  );

  // Build per-drill models across all 11 canonical drills (including empty ones).
  const { drillCards, maxDrillSessions } = useMemo(() => {
    const rows = (drillsScope.data?.drillSeries ?? []).filter(
      (r) => !effectiveSelectedUid || r.uid === effectiveSelectedUid
    );

    const byDrill = new Map<string, DrillSeriesPoint[]>();
    for (const r of rows) {
      const list = byDrill.get(r.drillId) ?? [];
      list.push(r);
      byDrill.set(r.drillId, list);
    }

    const cards = CANONICAL_DRILLS.map((drillDef) => {
      const drillRows = byDrill.get(drillDef.id) ?? [];
      let totalSessions = 0;
      let totalDurationSec = 0;
      let overallBest60s = 0;

      const daySet = new Set<string>();
      const bestByDayUid = new Map<string, number>();
      const volumeByUid = new Map<string, { sessions: number; durationSec: number }>();

      for (const r of drillRows) {
        totalSessions += r.sessions;
        totalDurationSec += r.totalDurationSec;
        overallBest60s = Math.max(overallBest60s, r.best60sScore);
        daySet.add(r.day);

        const dayUidKey = `${r.day}|${r.uid}`;
        const prevScore = bestByDayUid.get(dayUidKey);
        if (prevScore === undefined || r.best60sScore > prevScore) {
          bestByDayUid.set(dayUidKey, r.best60sScore);
        }

        const vol = volumeByUid.get(r.uid) ?? { sessions: 0, durationSec: 0 };
        vol.sessions += r.sessions;
        vol.durationSec += r.totalDurationSec;
        volumeByUid.set(r.uid, vol);
      }

      const segments: VolumeSegment[] = orderedStudentUids
        .filter((uid) => (volumeByUid.get(uid)?.sessions ?? 0) > 0)
        .map((uid) => {
          const vol = volumeByUid.get(uid)!;
          const name = getProfileName(uid, profiles);
          return {
            uid,
            label: name,
            color: studentColorMap.get(uid) ?? STUDENT_PALETTE[0],
            value: vol.sessions,
            detail: `${name}: ${vol.sessions} sessions (${formatDuration(vol.durationSec)})`,
          };
        });

      const chart = buildStudentSeriesModel({
        days: Array.from(daySet),
        uidList: orderedStudentUids,
        getValue: (day, uid) => bestByDayUid.get(`${day}|${uid}`) ?? null,
        profiles,
        studentColorMap,
        formatValue: (v) => `${Math.round(v)} pts`,
      });

      return {
        id: drillDef.id,
        label: drillDef.label,
        totalSessions,
        totalDurationSec,
        overallBest60s,
        segments,
        chart,
      };
    });

    const maxSessions = Math.max(1, ...cards.map((c) => c.totalSessions));
    return { drillCards: cards, maxDrillSessions: maxSessions };
  }, [
    drillsScope.data?.drillSeries,
    effectiveSelectedUid,
    orderedStudentUids,
    profiles,
    studentColorMap,
  ]);

  // Build per-cipher models across all 8 canonical ciphers (including empty ones).
  const { cipherCards, maxCipherSolves } = useMemo(() => {
    const rows = (ciphersScope.data?.cipherSeries ?? []).filter(
      (r) => !effectiveSelectedUid || r.uid === effectiveSelectedUid
    );

    const byCipher = new Map<string, CipherSeriesPoint[]>();
    for (const r of rows) {
      const list = byCipher.get(r.cipher) ?? [];
      list.push(r);
      byCipher.set(r.cipher, list);
    }

    const cards = CANONICAL_CIPHERS.map((cipherDef) => {
      const rawRows = byCipher.get(cipherDef.id) ?? [];
      const matchingRows =
        cipherDef.id === 'aristocrat'
          ? rawRows.filter((r) => {
              if (aristocratModeFilter === 'linked') return r.inputMode === 'linked';
              if (aristocratModeFilter === 'paper') return r.inputMode !== 'linked';
              return true;
            })
          : rawRows;

      let totalPassingSolves = 0;
      let totalSubmissions = 0;
      let totalDurationSec = 0;

      const daySet = new Set<string>();
      const paceByDayUid = new Map<string, { sumPace: number; count: number }>();
      const volumeByUid = new Map<string, { solves: number; durationSec: number }>();

      for (const r of matchingRows) {
        totalPassingSolves += r.passingSolves;
        totalSubmissions += r.submissions;
        totalDurationSec += r.sumElapsedSec;

        const rowSolves = r.passingSolves || r.submissions;
        if (rowSolves > 0) {
          const vol = volumeByUid.get(r.uid) ?? { solves: 0, durationSec: 0 };
          vol.solves += rowSolves;
          vol.durationSec += r.sumElapsedSec;
          volumeByUid.set(r.uid, vol);
        }

        if (r.pacedSolveCount > 0) {
          daySet.add(r.day);
          const dayUidKey = `${r.day}|${r.uid}`;
          const cur = paceByDayUid.get(dayUidKey) ?? { sumPace: 0, count: 0 };
          cur.sumPace += r.sumNormalizedPace;
          cur.count += r.pacedSolveCount;
          paceByDayUid.set(dayUidKey, cur);
        }
      }

      const displayVol = totalPassingSolves || totalSubmissions;

      const segments: VolumeSegment[] = orderedStudentUids
        .filter((uid) => (volumeByUid.get(uid)?.solves ?? 0) > 0)
        .map((uid) => {
          const vol = volumeByUid.get(uid)!;
          const name = getProfileName(uid, profiles);
          return {
            uid,
            label: name,
            color: studentColorMap.get(uid) ?? STUDENT_PALETTE[0],
            value: vol.solves,
            detail: `${name}: ${vol.solves} solves (${formatDuration(vol.durationSec)})`,
          };
        });

      const isAristocratLinked =
        cipherDef.id === 'aristocrat' && aristocratModeFilter === 'linked';
      const isAristocratAll =
        cipherDef.id === 'aristocrat' && aristocratModeFilter === 'all';

      const paceFormat = (v: number) =>
        isAristocratLinked
          ? `${v.toFixed(2)}s / uniq`
          : isAristocratAll
            ? `${v.toFixed(2)}s`
            : `${v.toFixed(2)}s / char`;

      const chart = buildStudentSeriesModel({
        days: Array.from(daySet),
        uidList: orderedStudentUids,
        getValue: (day, uid) => {
          const bucket = paceByDayUid.get(`${day}|${uid}`);
          if (!bucket || bucket.count <= 0) return null;
          return Number((bucket.sumPace / bucket.count).toFixed(2));
        },
        profiles,
        studentColorMap,
        formatValue: paceFormat,
      });

      return {
        id: cipherDef.id,
        label: cipherDef.label,
        totalPassingSolves,
        totalSubmissions,
        totalDurationSec,
        displayVol,
        segments,
        chart,
        yAxisUnitSuffix: 's',
        subtitle:
          cipherDef.id === 'aristocrat'
            ? aristocratModeFilter === 'linked'
              ? 'Normalized pace: sec / unique letter'
              : aristocratModeFilter === 'paper'
                ? 'Normalized pace: sec / letter'
                : 'Linked uses sec/unique letter; Paper uses sec/letter'
            : 'Normalized solve pace (sec / letter)',
      };
    });

    const maxSolves = Math.max(1, ...cards.map((c) => c.displayVol));
    return { cipherCards: cards, maxCipherSolves: maxSolves };
  }, [
    aristocratModeFilter,
    ciphersScope.data?.cipherSeries,
    effectiveSelectedUid,
    orderedStudentUids,
    profiles,
    studentColorMap,
  ]);

  return (
    <div className="analytics-view">
      <header className="analytics-header">
        <button
          type="button"
          className="btn-simple analytics-back-btn"
          onClick={onBack}
          aria-label="Back to Main Menu"
        >
          ← Menu
        </button>
        <h2 className="analytics-header-title">Class Analytics</h2>
        <button
          type="button"
          className="btn-simple analytics-refresh-btn"
          onClick={handleRefresh}
          disabled={isAnyLoading}
        >
          {isAnyLoading ? 'Loading…' : '↻ Refresh'}
        </button>
      </header>

      <div className="analytics-filters-bar">
        <div
          className="analytics-window-pills"
          role="group"
          aria-label="Time window"
        >
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`analytics-pill-btn${windowRange === opt.id ? ' is-active' : ''}`}
              onClick={() => setWindowRange(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="analytics-filter-controls">
          <label className="analytics-select-label">
            Student
            <select
              className="analytics-select"
              value={effectiveSelectedUid}
              onChange={(e) => setSelectedUid(e.target.value)}
            >
              <option value="">All Students ({studentOptions.length})</option>
              {studentOptions.map((s) => (
                <option key={s.uid} value={s.uid}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="analytics-checkbox-label">
            <input
              type="checkbox"
              checked={includeSharedLinks}
              onChange={(e) => setIncludeSharedLinks(e.target.checked)}
            />
            Include shared links
          </label>
        </div>
      </div>

      {firstError && (
        <div className="analytics-state-banner is-error">{firstError}</div>
      )}

      <div className="analytics-kpi-grid">
        <div className="analytics-kpi-card">
          <span className="analytics-kpi-label">Active Practice Time</span>
          <span className="analytics-kpi-value">
            {summaryScope.isLoading
              ? '…'
              : formatDuration(kpis.totalActiveSec)}
          </span>
          <span className="analytics-kpi-sub">
            Drills, ciphers &amp; test screen time
          </span>
        </div>

        <div className="analytics-kpi-card">
          <span className="analytics-kpi-label">Flashcard Sessions</span>
          <span className="analytics-kpi-value">
            {summaryScope.isLoading ? '…' : kpis.drillSessions}
          </span>
          <span className="analytics-kpi-sub">
            {summaryScope.isLoading
              ? 'Loading…'
              : `${kpis.drillAnswered} cards answered${
                  kpis.drillAccuracyPct !== null
                    ? ` (${kpis.drillAccuracyPct}% accuracy)`
                    : ''
                }`}
          </span>
        </div>

        <div className="analytics-kpi-card">
          <span className="analytics-kpi-label">Ciphers Solved</span>
          <span className="analytics-kpi-value">
            {summaryScope.isLoading ? '…' : kpis.ciphersPassed}
          </span>
          <span className="analytics-kpi-sub">
            {summaryScope.isLoading
              ? 'Loading…'
              : `${kpis.ciphersFullScore} full score${
                  kpis.fullRatePct !== null ? ` (${kpis.fullRatePct}% rate)` : ''
                }`}
          </span>
        </div>
      </div>

      <section className="analytics-section-card">
        <div className="analytics-section-header">
          <div>
            <h3 className="analytics-section-title">
              Student Practice Volume &amp; Engagement
            </h3>
            <p className="analytics-section-subtitle">
              Click any student row to focus all charts below.
            </p>
          </div>
          {effectiveSelectedUid && (
            <button
              type="button"
              className="btn-simple"
              onClick={() => setSelectedUid('')}
            >
              Show All Students
            </button>
          )}
        </div>

        {summaryScope.isLoading ? (
          <div className="analytics-table-loading">
            <span className="analytics-spinner" aria-hidden="true" />
            <span>Loading…</span>
          </div>
        ) : !summaryScope.data || summaryScope.data.studentSummaries.length === 0 ? (
          <div className="analytics-chart-empty">
            No practice activity recorded in this time window.
          </div>
        ) : (
          <div className="analytics-table-scroll">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th className="is-num">Active Time</th>
                  <th className="is-num">Drill Sessions</th>
                  <th className="is-num">Drill Acc</th>
                  <th className="is-num">Ciphers Solved</th>
                  <th className="is-num">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {summaryScope.data.studentSummaries.map((s) => {
                  const totalSec =
                    s.drillDurationSec +
                    s.cipherSolveDurationSec +
                    s.testActiveSec;
                  const acc =
                    s.drillAnswered > 0
                      ? `${Math.round((s.drillCorrect / s.drillAnswered) * 100)}%`
                      : '—';
                  const isSelected = effectiveSelectedUid === s.uid;
                  const role = profiles[s.uid]?.role;
                  const swatchColor =
                    studentColorMap.get(s.uid) ?? STUDENT_PALETTE[0];
                  return (
                    <tr
                      key={s.uid}
                      className={isSelected ? 'is-selected' : undefined}
                      onClick={() =>
                        setSelectedUid((prev) =>
                          prev === s.uid ? '' : s.uid
                        )
                      }
                    >
                      <td>
                        <span className="analytics-student-cell">
                          <span
                            className="analytics-student-dot"
                            style={{ backgroundColor: swatchColor }}
                            aria-hidden="true"
                          />
                          <span>{getProfileName(s.uid, profiles)}</span>
                          {role === 'teacher' && (
                            <span className="analytics-role-tag">Coach</span>
                          )}
                        </span>
                      </td>
                      <td className="is-num">{formatDuration(totalSec)}</td>
                      <td className="is-num">{s.drillSessions}</td>
                      <td className="is-num">{acc}</td>
                      <td className="is-num">
                        {s.ciphersPassed} / {s.ciphersSolved}
                      </td>
                      <td className="is-num">
                        {formatShortDate(s.lastActiveIso)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Swipeable / Narrow-viewport tab bar mirroring MainMenu */}
      <div
        className="menu-tabs-bar analytics-tabs-bar-wrap"
        role="tablist"
        aria-label="Practice category"
        onKeyDown={handleTabKeyDown}
      >
        <div
          className={`menu-tabs-indicator ${
            visualActiveTab === 'ciphers' ? 'is-ciphers' : 'is-drills'
          }${isDragging ? ' is-dragging' : ''}`}
          style={{
            transform: `translate3d(${indicatorProgress * 100}%, 0, 0)`,
          }}
          aria-hidden="true"
        />
        <button
          id="analytics-tab-drills"
          type="button"
          role="tab"
          aria-selected={activeTab === 'drills'}
          aria-controls="analytics-panel-drills"
          tabIndex={activeTab === 'drills' ? 0 : -1}
          className={`menu-tab-btn menu-tab-btn-drills ${
            visualActiveTab === 'drills' ? 'active' : ''
          }`}
          onClick={() => setActiveTab('drills')}
        >
          <DrillsTabIcon />
          <span>Drills</span>
        </button>

        <button
          id="analytics-tab-ciphers"
          type="button"
          role="tab"
          aria-selected={activeTab === 'ciphers'}
          aria-controls="analytics-panel-ciphers"
          tabIndex={activeTab === 'ciphers' ? 0 : -1}
          className={`menu-tab-btn menu-tab-btn-ciphers ${
            visualActiveTab === 'ciphers' ? 'active' : ''
          }`}
          onClick={() => setActiveTab('ciphers')}
        >
          <CiphersTabIcon />
          <span>Ciphers</span>
        </button>
      </div>

      {/* Swipeable Viewport on Narrow Screens / Side-by-Side Grid on Wide Screens */}
      <div
        ref={viewportRef}
        className="menu-panes-viewport analytics-panes-viewport"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishSwipe(e, false)}
        onPointerCancel={(e) => finishSwipe(e, true)}
        onClickCapture={handleClickCapture}
      >
        <div
          className={`menu-panes-track analytics-panes-track${isDragging ? ' is-dragging' : ''}`}
          style={trackTransform ? { transform: trackTransform } : undefined}
        >
          <section
            id="analytics-panel-drills"
            role={isSideBySide ? 'region' : 'tabpanel'}
            aria-labelledby={
              isSideBySide ? 'analytics-heading-drills' : 'analytics-tab-drills'
            }
            inert={!isSideBySide && activeTab !== 'drills' ? true : undefined}
            className="analytics-column"
          >
            <div className="analytics-column-header">
              <h3
                id="analytics-heading-drills"
                className="analytics-column-title is-drills"
              >
                <DrillsTabIcon />
                <span>Drills</span>
              </h3>
              <span className="analytics-column-subtitle">
                Volume &amp; daily best 60s score per student
              </span>
            </div>

            {drillCards.map((card) => (
              <article key={card.id} className="analytics-skill-card">
                <div className="analytics-skill-header">
                  <div className="analytics-skill-title-group">
                    <h4 className="analytics-skill-title">{card.label}</h4>
                    <span className="analytics-skill-note">
                      Daily best 60s score by student
                    </span>
                  </div>
                  <div className="analytics-skill-right">
                    {card.overallBest60s > 0 && (
                      <span className="analytics-skill-badge">
                        Peak {card.overallBest60s} pts
                      </span>
                    )}
                  </div>
                </div>

                <VolumeBar
                  label="Practice volume"
                  statText={
                    drillsScope.isLoading
                      ? 'Loading…'
                      : `${card.totalSessions} ${card.totalSessions === 1 ? 'session' : 'sessions'} · ${formatDuration(card.totalDurationSec)}`
                  }
                  segments={card.segments}
                  totalValue={card.totalSessions}
                  maxColumnValue={maxDrillSessions}
                />

                <UPlotChart
                  timestamps={card.chart.timestamps}
                  dateLabels={card.chart.dateLabels}
                  series={card.chart.series}
                  height={170}
                  isLoading={drillsScope.isLoading}
                  emptyWindowSec={emptyWindowSec}
                  emptyMessage="No activity in this window"
                />
              </article>
            ))}
          </section>

          <section
            id="analytics-panel-ciphers"
            role={isSideBySide ? 'region' : 'tabpanel'}
            aria-labelledby={
              isSideBySide ? 'analytics-heading-ciphers' : 'analytics-tab-ciphers'
            }
            inert={!isSideBySide && activeTab !== 'ciphers' ? true : undefined}
            className="analytics-column"
          >
            <div className="analytics-column-header">
              <h3
                id="analytics-heading-ciphers"
                className="analytics-column-title is-ciphers"
              >
                <CiphersTabIcon />
                <span>Ciphers</span>
              </h3>
              <span className="analytics-column-subtitle">
                Volume &amp; daily solve pace per student
              </span>
            </div>

            {cipherCards.map((card) => (
              <article key={card.id} className="analytics-skill-card">
                <div className="analytics-skill-header">
                  <div className="analytics-skill-title-group">
                    <h4 className="analytics-skill-title">{card.label}</h4>
                    <span className="analytics-skill-note">{card.subtitle}</span>
                  </div>
                  <div className="analytics-skill-right">
                    {card.id === 'aristocrat' && (
                      <select
                        className="analytics-select analytics-select-compact"
                        aria-label="Aristocrat input mode"
                        value={aristocratModeFilter}
                        onChange={(e) =>
                          setAristocratModeFilter(
                            e.target.value as AristocratModeFilter
                          )
                        }
                      >
                        <option value="all">All Modes</option>
                        <option value="linked">Linked</option>
                        <option value="paper">Paper</option>
                      </select>
                    )}
                  </div>
                </div>

                <VolumeBar
                  label="Practice volume"
                  statText={
                    ciphersScope.isLoading
                      ? 'Loading…'
                      : `${card.displayVol} ${card.displayVol === 1 ? 'solve' : 'solves'} · ${formatDuration(card.totalDurationSec)}`
                  }
                  segments={card.segments}
                  totalValue={card.displayVol}
                  maxColumnValue={maxCipherSolves}
                />

                <UPlotChart
                  timestamps={card.chart.timestamps}
                  dateLabels={card.chart.dateLabels}
                  series={card.chart.series}
                  yAxisUnitSuffix={card.yAxisUnitSuffix}
                  height={170}
                  isLoading={ciphersScope.isLoading}
                  emptyWindowSec={emptyWindowSec}
                  emptyMessage="No activity in this window"
                />
              </article>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
};
