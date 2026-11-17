import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchDashboardAnalytics,
  type AnalyticsProfileInfo,
  type AnalyticsWindow,
  type CipherSeriesPoint,
  type DashboardAnalyticsResponse,
  type DrillSeriesPoint,
  type StudentEngagementSummary,
} from '../../services/analyticsService';
import '../../styles/analytics.css';
import { UPlotChart, type UPlotLineSeries } from './UPlotChart';

interface TeacherAnalyticsViewProps {
  onBack: () => void;
}

const WINDOW_OPTIONS: ReadonlyArray<{ id: AnalyticsWindow; label: string }> = [
  { id: '7d', label: '7 Days' },
  { id: '30d', label: '30 Days' },
  { id: '90d', label: '90 Days' },
  { id: 'all', label: 'All Time' },
];

const DRILL_LABELS: Record<string, string> = {
  offsetsLetterToNum: 'Letter Offsets (A → 1)',
  offsetsNumToLetter: 'Letter Offsets (1 → A)',
  letterMathEasy: 'ABC ± # (Num Easy)',
  letterMathHard: 'ABC ± # (Num Hard)',
  letterMathLetterEasy: 'ABC ± # (Letter Easy)',
  letterMathLetterHard: 'ABC ± # (Letter Hard)',
  atbash: 'Atbash Symbols',
  pigpen: 'Pigpen Symbols',
  galactic: 'Galactic Symbols',
  tap: 'Tap Code Symbols',
  knights: 'Knights Templar Symbols',
};

const CIPHER_LABELS: Record<string, string> = {
  aristocrat: 'Aristocrat',
  caesar: 'Caesar',
  vigenere: 'Vigenère',
  atbash: 'Atbash',
  pigpen: 'Pigpen',
  galactic: 'Standard Galactic',
  tap: 'Tap Code',
  knights: 'Knights Templar',
};

const MODE_LABELS: Record<string, string> = {
  '': 'Default',
  pm3: '±3',
  any: 'Any Shift',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

const MODE_COLORS: Record<string, string> = {
  easy: '#10b981',
  pm3: '#10b981',
  medium: '#f59e0b',
  any: '#38bdf8',
  hard: '#f43f5e',
  '': '#38bdf8',
};

const FALLBACK_PALETTE = [
  '#38bdf8',
  '#10b981',
  '#f59e0b',
  '#a855f7',
  '#f43f5e',
  '#22d3ee',
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

function formatPace(val: number): string {
  return `${val.toFixed(2)}s`;
}

function buildDrillBreakdown(rows: DrillSeriesPoint[]) {
  const byDrill = new Map<
    string,
    { drillId: string; sessions: number; durationSec: number; answered: number; correct: number; best60s: number }
  >();
  for (const r of rows) {
    const prev = byDrill.get(r.drillId) ?? {
      drillId: r.drillId,
      sessions: 0,
      durationSec: 0,
      answered: 0,
      correct: 0,
      best60s: 0,
    };
    prev.sessions += r.sessions;
    prev.durationSec += r.totalDurationSec;
    prev.answered += r.totalAnswered;
    prev.correct += r.totalCorrect;
    prev.best60s = Math.max(prev.best60s, r.best60sScore);
    byDrill.set(r.drillId, prev);
  }
  return Array.from(byDrill.values()).sort((a, b) => b.sessions - a.sessions);
}

function buildCipherBreakdown(rows: CipherSeriesPoint[]) {
  const byCipher = new Map<
    string,
    { cipher: string; passingSolves: number; fullScoreCount: number; submissions: number; durationSec: number }
  >();
  for (const r of rows) {
    const prev = byCipher.get(r.cipher) ?? {
      cipher: r.cipher,
      passingSolves: 0,
      fullScoreCount: 0,
      submissions: 0,
      durationSec: 0,
    };
    prev.passingSolves += r.passingSolves;
    prev.fullScoreCount += r.fullScoreCount;
    prev.submissions += r.submissions;
    prev.durationSec += r.sumElapsedSec;
    byCipher.set(r.cipher, prev);
  }
  return Array.from(byCipher.values()).sort(
    (a, b) => b.passingSolves - a.passingSolves || b.submissions - a.submissions
  );
}

/**
 * Lazy-loaded teacher analytics dashboard backed by BigQuery + Firestore profiles.
 */
export const TeacherAnalyticsView: React.FC<TeacherAnalyticsViewProps> = ({
  onBack,
}) => {
  const [windowRange, setWindowRange] = useState<AnalyticsWindow>('30d');
  const [includeSharedLinks, setIncludeSharedLinks] = useState<boolean>(false);
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [selectedDrillId, setSelectedDrillId] = useState<string>('');
  const [selectedCipher, setSelectedCipher] = useState<string>('');
  const [aristocratInputFilter, setAristocratInputFilter] = useState<
    'all' | 'linked' | 'standard_paper'
  >('all');
  const [refreshNonce, setRefreshNonce] = useState<number>(0);

  const requestKey = `${windowRange}|${includeSharedLinks ? '1' : '0'}|${refreshNonce}`;
  const [fetchState, setFetchState] = useState<{
    key: string;
    data: DashboardAnalyticsResponse | null;
    error: string | null;
  }>({ key: '', data: null, error: null });

  useEffect(() => {
    const controller = new AbortController();

    fetchDashboardAnalytics({
      window: windowRange,
      includeSharedLinks,
      signal: controller.signal,
    })
      .then((res) => {
        if (!controller.signal.aborted) {
          setFetchState({ key: requestKey, data: res, error: null });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Unable to load practice analytics.';
        setFetchState((prev) => ({
          key: requestKey,
          data: prev.data,
          error: message,
        }));
      });

    return () => controller.abort();
  }, [requestKey, windowRange, includeSharedLinks]);

  const isLoading = fetchState.key !== requestKey;
  const data = fetchState.data;
  const errorMsg = fetchState.key === requestKey ? fetchState.error : null;

  const handleRefresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);

  const profiles = useMemo(() => data?.profiles ?? {}, [data]);

  const studentOptions = useMemo(() => {
    const uids = new Set<string>();
    for (const s of data?.studentSummaries ?? []) {
      uids.add(s.uid);
    }
    return Array.from(uids)
      .map((uid) => ({
        uid,
        displayName: getProfileName(uid, profiles),
        role: profiles[uid]?.role ?? 'student',
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [data, profiles]);

  // Clear selectedUid if it no longer exists in the fetched window
  const effectiveSelectedUid = useMemo(() => {
    if (!selectedUid) return '';
    return studentOptions.some((s) => s.uid === selectedUid) ? selectedUid : '';
  }, [selectedUid, studentOptions]);

  const filteredSummaries = useMemo<StudentEngagementSummary[]>(() => {
    const list = data?.studentSummaries ?? [];
    if (!effectiveSelectedUid) return list;
    return list.filter((s) => s.uid === effectiveSelectedUid);
  }, [data, effectiveSelectedUid]);

  const filteredDrillRows = useMemo<DrillSeriesPoint[]>(() => {
    const rows = data?.drillSeries ?? [];
    if (!effectiveSelectedUid) return rows;
    return rows.filter((r) => r.uid === effectiveSelectedUid);
  }, [data, effectiveSelectedUid]);

  const filteredCipherRows = useMemo<CipherSeriesPoint[]>(() => {
    const rows = data?.cipherSeries ?? [];
    if (!effectiveSelectedUid) return rows;
    return rows.filter((r) => r.uid === effectiveSelectedUid);
  }, [data, effectiveSelectedUid]);

  const kpis = useMemo(() => {
    let totalActiveSec = 0;
    let drillSessions = 0;
    let drillAnswered = 0;
    let drillCorrect = 0;
    let ciphersPassed = 0;
    let ciphersFullScore = 0;
    let ciphersSolved = 0;
    let testsParticipated = 0;

    for (const s of filteredSummaries) {
      totalActiveSec +=
        s.drillDurationSec + s.cipherSolveDurationSec + s.testActiveSec;
      drillSessions += s.drillSessions;
      drillAnswered += s.drillAnswered;
      drillCorrect += s.drillCorrect;
      ciphersPassed += s.ciphersPassed;
      ciphersFullScore += s.ciphersFullScore;
      ciphersSolved += s.ciphersSolved;
      testsParticipated += s.testsParticipated;
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
      testsParticipated,
    };
  }, [filteredSummaries]);

  const drillBreakdown = useMemo(
    () => buildDrillBreakdown(filteredDrillRows),
    [filteredDrillRows]
  );

  const cipherBreakdown = useMemo(
    () => buildCipherBreakdown(filteredCipherRows),
    [filteredCipherRows]
  );

  // Pick default drill & cipher automatically based on volume
  const activeDrillId = useMemo(() => {
    if (
      selectedDrillId &&
      drillBreakdown.some((d) => d.drillId === selectedDrillId)
    ) {
      return selectedDrillId;
    }
    return drillBreakdown[0]?.drillId ?? '';
  }, [selectedDrillId, drillBreakdown]);

  const activeCipher = useMemo(() => {
    if (
      selectedCipher &&
      cipherBreakdown.some((c) => c.cipher === selectedCipher)
    ) {
      return selectedCipher;
    }
    return cipherBreakdown[0]?.cipher ?? '';
  }, [selectedCipher, cipherBreakdown]);

  // Build uPlot data for Drill sessionBest60sScore over time
  const drillChartModel = useMemo(() => {
    if (!activeDrillId) {
      return { timestamps: [], dateLabels: [], series: [] as UPlotLineSeries[] };
    }
    const byDay = new Map<
      string,
      { best60s: number; sumBest60s: number; sessions: number }
    >();
    for (const r of filteredDrillRows) {
      if (r.drillId !== activeDrillId) continue;
      const cur = byDay.get(r.day) ?? {
        best60s: 0,
        sumBest60s: 0,
        sessions: 0,
      };
      cur.best60s = Math.max(cur.best60s, r.best60sScore);
      cur.sumBest60s += r.sumBest60sScore;
      cur.sessions += r.sessions;
      byDay.set(r.day, cur);
    }

    const sortedDays = Array.from(byDay.keys()).sort();
    const timestamps = sortedDays.map(dayToMiddayEpochSec);
    const dateLabels = sortedDays.map((d) => formatShortDate(`${d}T12:00:00Z`));
    const bestVals = sortedDays.map((d) => byDay.get(d)?.best60s ?? null);
    const avgVals = sortedDays.map((d) => {
      const entry = byDay.get(d);
      if (!entry || entry.sessions <= 0) return null;
      return Number((entry.sumBest60s / entry.sessions).toFixed(1));
    });

    const series: UPlotLineSeries[] = [
      {
        label: 'Daily Best 60s Score',
        color: '#38bdf8',
        fill: 'rgba(56, 189, 248, 0.12)',
        values: bestVals,
        formatValue: (v) => `${Math.round(v)} pts`,
      },
      {
        label: 'Daily Avg 60s Score',
        color: '#a855f7',
        dash: [5, 4],
        values: avgVals,
        formatValue: (v) => `${v.toFixed(1)} pts`,
      },
    ];

    return { timestamps, dateLabels, series };
  }, [activeDrillId, filteredDrillRows]);

  // Build uPlot data for normalized Cipher solve pace by difficulty mode
  const cipherChartModel = useMemo(() => {
    if (!activeCipher) {
      return { timestamps: [], dateLabels: [], series: [] as UPlotLineSeries[], hasLinked: false };
    }

    const matching = filteredCipherRows.filter((r) => {
      if (r.cipher !== activeCipher || r.pacedSolveCount <= 0) return false;
      if (activeCipher === 'aristocrat') {
        if (aristocratInputFilter === 'linked') return r.inputMode === 'linked';
        if (aristocratInputFilter === 'standard_paper') {
          return r.inputMode !== 'linked';
        }
      }
      return true;
    });

    const hasLinked = filteredCipherRows.some(
      (r) =>
        r.cipher === 'aristocrat' &&
        r.inputMode === 'linked' &&
        r.pacedSolveCount > 0
    );

    const daySet = new Set<string>();
    const seriesKeys = new Set<string>();
    const grid = new Map<
      string,
      Map<string, { sumPace: number; count: number }>
    >();

    for (const r of matching) {
      daySet.add(r.day);
      const key =
        activeCipher === 'aristocrat' && aristocratInputFilter === 'all'
          ? `${r.mode || ''}|${r.inputMode === 'linked' ? 'linked' : 'std'}`
          : `${r.mode || ''}|all`;
      seriesKeys.add(key);
      let dayMap = grid.get(r.day);
      if (!dayMap) {
        dayMap = new Map();
        grid.set(r.day, dayMap);
      }
      const cur = dayMap.get(key) ?? { sumPace: 0, count: 0 };
      cur.sumPace += r.sumNormalizedPace;
      cur.count += r.pacedSolveCount;
      dayMap.set(key, cur);
    }

    const sortedDays = Array.from(daySet).sort();
    const timestamps = sortedDays.map(dayToMiddayEpochSec);
    const dateLabels = sortedDays.map((d) => formatShortDate(`${d}T12:00:00Z`));
    const orderedKeys = Array.from(seriesKeys).sort();

    const series: UPlotLineSeries[] = orderedKeys.map((key, idx) => {
      const [mode, inputGroup] = key.split('|');
      const modeLabel = MODE_LABELS[mode] ?? (mode || 'Default');
      const inputSuffix =
        inputGroup === 'linked'
          ? ' · Linked (s/uniq)'
          : inputGroup === 'std'
            ? ' · Std/Paper (s/char)'
            : '';
      const baseColor =
        MODE_COLORS[mode] ?? FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];

      const values = sortedDays.map((day) => {
        const bucket = grid.get(day)?.get(key);
        if (!bucket || bucket.count <= 0) return null;
        return Number((bucket.sumPace / bucket.count).toFixed(2));
      });

      return {
        label: `${modeLabel}${inputSuffix}`,
        color: baseColor,
        dash: inputGroup === 'std' ? [5, 4] : undefined,
        values,
        formatValue: (v) =>
          inputGroup === 'linked' ||
          (activeCipher === 'aristocrat' && aristocratInputFilter === 'linked')
            ? `${formatPace(v)} / unique char`
            : `${formatPace(v)} / char`,
      };
    });

    return { timestamps, dateLabels, series, hasLinked };
  }, [activeCipher, aristocratInputFilter, filteredCipherRows]);

  const maxDrillSessions = Math.max(
    1,
    ...drillBreakdown.map((d) => d.sessions)
  );
  const maxCipherSolves = Math.max(
    1,
    ...cipherBreakdown.map((c) => c.passingSolves || c.submissions)
  );

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
          disabled={isLoading}
        >
          {isLoading ? 'Loading…' : '↻ Refresh'}
        </button>
      </header>

      <div className="analytics-filters-bar">
        <div className="analytics-window-pills" role="group" aria-label="Time window">
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

      {errorMsg && (
        <div className="analytics-state-banner is-error">{errorMsg}</div>
      )}

      {isLoading && !data && !errorMsg && (
        <div className="analytics-state-banner">
          Querying BigQuery practice logs…
        </div>
      )}

      {data && (
        <>
          <div className="analytics-kpi-grid">
            <div className="analytics-kpi-card">
              <span className="analytics-kpi-label">Active Practice Time</span>
              <span className="analytics-kpi-value">
                {formatDuration(kpis.totalActiveSec)}
              </span>
              <span className="analytics-kpi-sub">
                Drills + cipher solves + test screen time
              </span>
            </div>

            <div className="analytics-kpi-card">
              <span className="analytics-kpi-label">Flashcard Sessions</span>
              <span className="analytics-kpi-value">{kpis.drillSessions}</span>
              <span className="analytics-kpi-sub">
                {kpis.drillAnswered} cards answered
                {kpis.drillAccuracyPct !== null
                  ? ` (${kpis.drillAccuracyPct}% accuracy)`
                  : ''}
              </span>
            </div>

            <div className="analytics-kpi-card">
              <span className="analytics-kpi-label">Ciphers Solved</span>
              <span className="analytics-kpi-value">{kpis.ciphersPassed}</span>
              <span className="analytics-kpi-sub">
                {kpis.ciphersFullScore} full score
                {kpis.fullRatePct !== null ? ` (${kpis.fullRatePct}% rate)` : ''}
              </span>
            </div>

            <div className="analytics-kpi-card">
              <span className="analytics-kpi-label">Practice Tests</span>
              <span className="analytics-kpi-value">
                {kpis.testsParticipated}
              </span>
              <span className="analytics-kpi-sub">
                Student-test participations logged
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
                  Click any row to filter charts and breakdowns to that student.
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

            {data.studentSummaries.length === 0 ? (
              <div className="analytics-chart-empty">
                No practice events recorded in this time window.
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
                      <th className="is-num">Test Time</th>
                      <th className="is-num">Last Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.studentSummaries.map((s) => {
                      const totalSec =
                        s.drillDurationSec +
                        s.cipherSolveDurationSec +
                        s.testActiveSec;
                      const acc =
                        s.drillAnswered > 0
                          ? `${Math.round((s.drillCorrect / s.drillAnswered) * 100)}%`
                          : '—';
                      const isRowSelected = effectiveSelectedUid === s.uid;
                      const role = profiles[s.uid]?.role;

                      return (
                        <tr
                          key={s.uid}
                          className={isRowSelected ? 'is-selected' : ''}
                          onClick={() =>
                            setSelectedUid((prev) =>
                              prev === s.uid ? '' : s.uid
                            )
                          }
                        >
                          <td>
                            <span className="analytics-student-cell">
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
                            {s.ciphersPassed}
                            {s.ciphersSolved > s.ciphersPassed
                              ? ` / ${s.ciphersSolved}`
                              : ''}
                          </td>
                          <td className="is-num">
                            {formatDuration(s.testActiveSec)}
                            {s.testsParticipated > 0
                              ? ` (${s.testsParticipated})`
                              : ''}
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

          <div className="analytics-two-col">
            <section className="analytics-section-card">
              <div className="analytics-section-header">
                <h3 className="analytics-section-title">Volume by Drill</h3>
              </div>
              {drillBreakdown.length === 0 ? (
                <div className="analytics-chart-empty">No drill sessions yet.</div>
              ) : (
                <div className="analytics-bar-list">
                  {drillBreakdown.map((d) => {
                    const pct = Math.max(
                      4,
                      Math.round((d.sessions / maxDrillSessions) * 100)
                    );
                    return (
                      <div key={d.drillId} className="analytics-bar-row">
                        <div className="analytics-bar-meta">
                          <span className="analytics-bar-name">
                            {DRILL_LABELS[d.drillId] ?? d.drillId}
                          </span>
                          <span className="analytics-bar-stat">
                            {d.sessions} sess · {formatDuration(d.durationSec)} · best{' '}
                            {d.best60s}
                          </span>
                        </div>
                        <div className="analytics-bar-track">
                          <div
                            className="analytics-bar-fill"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="analytics-section-card">
              <div className="analytics-section-header">
                <h3 className="analytics-section-title">Volume by Cipher</h3>
              </div>
              {cipherBreakdown.length === 0 ? (
                <div className="analytics-chart-empty">No cipher solves yet.</div>
              ) : (
                <div className="analytics-bar-list">
                  {cipherBreakdown.map((c) => {
                    const count = c.passingSolves || c.submissions;
                    const pct = Math.max(
                      4,
                      Math.round((count / maxCipherSolves) * 100)
                    );
                    const fullPct =
                      c.submissions > 0
                        ? Math.round((c.fullScoreCount / c.submissions) * 100)
                        : 0;
                    return (
                      <div key={c.cipher} className="analytics-bar-row">
                        <div className="analytics-bar-meta">
                          <span className="analytics-bar-name">
                            {CIPHER_LABELS[c.cipher] ?? c.cipher}
                          </span>
                          <span className="analytics-bar-stat">
                            {c.passingSolves} passed · {fullPct}% full ·{' '}
                            {formatDuration(c.durationSec)}
                          </span>
                        </div>
                        <div className="analytics-bar-track">
                          <div
                            className="analytics-bar-fill is-cipher"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <section className="analytics-section-card">
            <div className="analytics-section-header">
              <div>
                <h3 className="analytics-section-title">
                  Flashcard Fluency Progression (Best 60s Score)
                </h3>
                <p className="analytics-section-subtitle">
                  Daily peak and session average `sessionBest60sScore` over time
                  (higher is faster).
                </p>
              </div>
              {drillBreakdown.length > 0 && (
                <div className="analytics-chart-controls">
                  <select
                    className="analytics-select"
                    value={activeDrillId}
                    onChange={(e) => setSelectedDrillId(e.target.value)}
                    aria-label="Select drill for 60s progression chart"
                  >
                    {drillBreakdown.map((d) => (
                      <option key={d.drillId} value={d.drillId}>
                        {DRILL_LABELS[d.drillId] ?? d.drillId}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <UPlotChart
              timestamps={drillChartModel.timestamps}
              dateLabels={drillChartModel.dateLabels}
              series={drillChartModel.series}
              yAxisUnitSuffix=" pts"
              emptyMessage="No flashcard drill sessions recorded for this selection."
            />
          </section>

          <section className="analytics-section-card">
            <div className="analytics-section-header">
              <div>
                <h3 className="analytics-section-title">
                  Cipher Solve Pace Progression
                </h3>
                <p className="analytics-section-subtitle">
                  Normalized pace ({activeCipher === 'aristocrat' && aristocratInputFilter === 'linked'
                    ? 'elapsedSec / uniqueAlphaCharCount for Linked Aristocrat'
                    : activeCipher === 'aristocrat'
                      ? 'elapsedSec / uniqueAlphaCharCount (Linked) or elapsedSec / alphaCharCount (Std/Paper)'
                      : 'elapsedSec / alphaCharCount'}
                  ) across passing solves (lower is faster).
                </p>
              </div>
              {cipherBreakdown.length > 0 && (
                <div className="analytics-chart-controls">
                  <select
                    className="analytics-select"
                    value={activeCipher}
                    onChange={(e) => setSelectedCipher(e.target.value)}
                    aria-label="Select cipher for pace progression chart"
                  >
                    {cipherBreakdown.map((c) => (
                      <option key={c.cipher} value={c.cipher}>
                        {CIPHER_LABELS[c.cipher] ?? c.cipher}
                      </option>
                    ))}
                  </select>

                  {activeCipher === 'aristocrat' && cipherChartModel.hasLinked && (
                    <select
                      className="analytics-select"
                      value={aristocratInputFilter}
                      onChange={(e) =>
                        setAristocratInputFilter(
                          e.target.value as 'all' | 'linked' | 'standard_paper'
                        )
                      }
                      aria-label="Filter Aristocrat input mode"
                    >
                      <option value="all">All Input Modes</option>
                      <option value="linked">Linked Only (s / unique letter)</option>
                      <option value="standard_paper">
                        Standard / Paper Only (s / letter)
                      </option>
                    </select>
                  )}
                </div>
              )}
            </div>

            <UPlotChart
              timestamps={cipherChartModel.timestamps}
              dateLabels={cipherChartModel.dateLabels}
              series={cipherChartModel.series}
              yAxisUnitSuffix="s"
              emptyMessage="No passing cipher solves with timing recorded for this selection."
            />
          </section>
        </>
      )}
    </div>
  );
};
