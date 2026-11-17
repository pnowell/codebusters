import React, { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface UPlotLineSeries {
  id?: string;
  label: string;
  color: string;
  values: (number | null)[];
  fill?: string;
  dash?: number[];
  formatValue?: (val: number, idx: number) => string;
}

interface UPlotChartProps {
  /** Midday UTC epoch seconds for each X tick, sorted ascending. */
  timestamps: number[];
  /** Human-readable X-axis labels aligned 1-to-1 with `timestamps`. */
  dateLabels: string[];
  series: UPlotLineSeries[];
  yAxisLabel?: string;
  yAxisUnitSuffix?: string;
  height?: number;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Optional [minSec, maxSec] bounds used when rendering an empty chart grid. */
  emptyWindowSec?: [number, number];
}

interface HoverInfo {
  idx: number;
  leftPx: number;
  topPx: number;
  hostWidth: number;
}

const UTC_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function formatCompactTick(val: number, suffix = ''): string {
  if (!Number.isFinite(val)) return '';
  const rounded =
    Math.abs(val) >= 100
      ? Math.round(val).toString()
      : Math.abs(val) >= 10
        ? val.toFixed(1).replace(/\.0$/, '')
        : val.toFixed(2).replace(/\.?0+$/, '');
  return suffix ? `${rounded}${suffix}` : rounded;
}

function getDefaultEmptyRange(): [number, number] {
  const nowSec = Math.floor(Date.now() / 1000);
  return [nowSec - 7 * 86_400, nowSec];
}

/**
 * Lightweight dark-themed responsive uPlot line chart with deferred offscreen mounting,
 * empty-axis rendering when no activity exists, and declarative JSX hover tooltips.
 */
export const UPlotChart: React.FC<UPlotChartProps> = ({
  timestamps,
  dateLabels,
  series,
  yAxisLabel,
  yAxisUnitSuffix = '',
  height = 175,
  isLoading = false,
  emptyMessage = 'No activity in this window.',
  emptyWindowSec,
}) => {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [fallbackRange] = useState<[number, number]>(getDefaultEmptyRange);
  const [hasEnteredViewport, setHasEnteredViewport] = useState<boolean>(
    () => typeof IntersectionObserver === 'undefined'
  );

  useEffect(() => {
    if (hasEnteredViewport || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const target = shellRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasEnteredViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '260px 0px' }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasEnteredViewport]);

  const hasAnyPoint = useMemo(
    () =>
      timestamps.length > 0 &&
      series.some((s) =>
        s.values.some((v) => v !== null && Number.isFinite(v))
      ),
    [timestamps, series]
  );

  const alignedData = useMemo<uPlot.AlignedData>(() => {
    if (!hasAnyPoint) {
      const [startSec, endSec] = emptyWindowSec ?? fallbackRange;
      const safeEnd = endSec > startSec ? endSec : startSec + 86_400;
      return [
        [startSec, safeEnd],
        [null, null],
      ] as unknown as uPlot.AlignedData;
    }
    const xVals = timestamps;
    const yCols = series.map((s) => s.values);
    return [xVals, ...yCols] as uPlot.AlignedData;
  }, [emptyWindowSec, fallbackRange, hasAnyPoint, series, timestamps]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host || isLoading || !hasEnteredViewport) {
      plotRef.current?.destroy();
      plotRef.current = null;
      return;
    }

    const initialWidth = Math.max(220, Math.floor(host.clientWidth) || 440);
    const axisStroke = '#94a3b8';
    const gridStroke = 'rgba(148, 163, 184, 0.14)';

    const singleDayX = hasAnyPoint && timestamps.length === 1;
    const minX = singleDayX ? timestamps[0] - 43200 : undefined;
    const maxX = singleDayX ? timestamps[0] + 43200 : undefined;

    const uplotSeries: uPlot.Series[] = hasAnyPoint
      ? [
          {
            label: 'Date',
          },
          ...series.map((s) => ({
            label: s.label,
            stroke: s.color,
            fill: s.fill,
            width: 2,
            spanGaps: true,
            dash: s.dash,
            points: {
              show: timestamps.length <= 45,
              size: 5,
              width: 1.5,
              stroke: s.color,
              fill: '#0f172a',
            },
          })),
        ]
      : [
          { label: 'Date' },
          {
            label: '',
            stroke: 'transparent',
            points: { show: false },
          },
        ];

    const opts: uPlot.Options = {
      width: initialWidth,
      height,
      padding: [10, 12, 4, 4],
      scales: {
        x: {
          time: true,
          min: minX,
          max: maxX,
        },
        y: {
          auto: true,
          range: (_u, dataMin, dataMax) => {
            if (!hasAnyPoint || !Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
              return [0, 10];
            }
            const low = Math.min(0, dataMin);
            const span = Math.max(dataMax - low, 1);
            return [low, dataMax + span * 0.14];
          },
        },
      },
      cursor: hasAnyPoint
        ? {
            drag: { x: false, y: false },
            points: {
              size: 7,
              width: 2,
            },
          }
        : {
            show: false,
            drag: { x: false, y: false },
          },
      legend: {
        show: false,
      },
      axes: [
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: gridStroke, width: 1 },
          font: '11px Outfit, sans-serif',
          values: (_u, splits) =>
            splits.map((sec) => UTC_DATE_FMT.format(new Date(sec * 1000))),
        },
        {
          stroke: axisStroke,
          label: yAxisLabel,
          labelFont: '11px Outfit, sans-serif',
          labelSize: yAxisLabel ? 16 : 0,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: gridStroke, width: 1 },
          font: '11px "JetBrains Mono", monospace',
          size: 46,
          values: (_u, splits) =>
            splits.map((v) => formatCompactTick(v, yAxisUnitSuffix)),
        },
      ],
      series: uplotSeries,
      hooks: hasAnyPoint
        ? {
            setCursor: [
              (u) => {
                const idx = u.cursor.idx;
                const left = u.cursor.left ?? -1;
                const top = u.cursor.top ?? -1;
                if (
                  idx === null ||
                  idx === undefined ||
                  idx < 0 ||
                  idx >= timestamps.length ||
                  left < 0
                ) {
                  setHoverInfo((prev) => (prev ? null : prev));
                  return;
                }
                const bboxLeft = u.bbox.left / window.devicePixelRatio;
                const bboxTop = u.bbox.top / window.devicePixelRatio;
                setHoverInfo({
                  idx,
                  leftPx: bboxLeft + left,
                  topPx: bboxTop + Math.max(0, top),
                  hostWidth: host.clientWidth,
                });
              },
            ],
          }
        : undefined,
    };

    const instance = new uPlot(opts, alignedData, host);
    plotRef.current = instance;

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        const width = Math.floor(entries[0]?.contentRect.width ?? 0);
        if (width > 120 && plotRef.current) {
          plotRef.current.setSize({ width, height });
        }
      });
      observer.observe(host);
    }

    return () => {
      observer?.disconnect();
      instance.destroy();
      if (plotRef.current === instance) {
        plotRef.current = null;
      }
      setHoverInfo(null);
    };
  }, [
    alignedData,
    hasAnyPoint,
    hasEnteredViewport,
    height,
    isLoading,
    series,
    timestamps,
    yAxisLabel,
    yAxisUnitSuffix,
  ]);

  const activeIdx =
    hasAnyPoint &&
    hoverInfo &&
    hoverInfo.idx >= 0 &&
    hoverInfo.idx < dateLabels.length
      ? hoverInfo.idx
      : null;

  const tooltipLeftPx = hoverInfo
    ? Math.max(8, Math.min(hoverInfo.leftPx, Math.max(8, hoverInfo.hostWidth - 190)))
    : 8;

  return (
    <div
      ref={shellRef}
      className="analytics-uplot-shell"
      onMouseLeave={() => setHoverInfo(null)}
    >
      {isLoading || !hasEnteredViewport ? (
        <div className="analytics-chart-loading" style={{ minHeight: `${height}px` }}>
          <span className="analytics-spinner" aria-hidden="true" />
          <span>Loading…</span>
        </div>
      ) : (
        <div className="analytics-uplot-stage" style={{ minHeight: `${height}px` }}>
          <div
            ref={containerRef}
            className="analytics-uplot-host"
            style={{ minHeight: `${height}px` }}
          />
          {!hasAnyPoint && (
            <div className="analytics-empty-overlay">{emptyMessage}</div>
          )}
        </div>
      )}

      {!isLoading && hasAnyPoint && series.length > 0 && (
        <div className="analytics-uplot-legend">
          {series.map((s) => (
            <span key={s.id ?? s.label} className="analytics-legend-item">
              <span
                className="analytics-legend-swatch"
                style={{ backgroundColor: s.color }}
              />
              <span>{s.label}</span>
            </span>
          ))}
        </div>
      )}

      {hoverInfo && activeIdx !== null && (
        <div
          className="analytics-uplot-tooltip"
          style={{
            left: `${tooltipLeftPx}px`,
            top: `${Math.max(8, hoverInfo.topPx)}px`,
          }}
        >
          <div className="analytics-tooltip-date">{dateLabels[activeIdx]}</div>
          {series.map((s) => {
            const val = s.values[activeIdx];
            if (val === null || val === undefined || !Number.isFinite(val)) {
              return null;
            }
            const formatted = s.formatValue
              ? s.formatValue(val, activeIdx)
              : formatCompactTick(val, yAxisUnitSuffix);
            return (
              <div key={s.id ?? s.label} className="analytics-tooltip-row">
                <span
                  className="analytics-legend-swatch"
                  style={{ backgroundColor: s.color }}
                />
                <span className="analytics-tooltip-series">{s.label}:</span>
                <strong className="analytics-tooltip-value">{formatted}</strong>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
