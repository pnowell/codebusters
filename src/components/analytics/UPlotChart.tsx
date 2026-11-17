import React, { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface UPlotLineSeries {
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
  emptyMessage?: string;
}

interface HoverInfo {
  idx: number;
  leftPx: number;
  topPx: number;
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

/**
 * Lightweight dark-themed responsive uPlot line chart with declarative JSX hover tooltips.
 */
export const UPlotChart: React.FC<UPlotChartProps> = ({
  timestamps,
  dateLabels,
  series,
  yAxisLabel,
  yAxisUnitSuffix = '',
  height = 240,
  emptyMessage = 'No data points recorded in this window.',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  const hasAnyPoint = useMemo(
    () =>
      timestamps.length > 0 &&
      series.some((s) =>
        s.values.some((v) => v !== null && Number.isFinite(v))
      ),
    [timestamps, series]
  );

  // If there is only a single timestamp, pad +/- 12h range so the single point renders centered.
  const data = useMemo<uPlot.AlignedData>(() => {
    const xVals = timestamps;
    const yCols = series.map((s) => s.values);
    return [xVals, ...yCols] as uPlot.AlignedData;
  }, [timestamps, series]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host || !hasAnyPoint) {
      plotRef.current?.destroy();
      plotRef.current = null;
      return;
    }

    const initialWidth = Math.max(260, Math.floor(host.clientWidth) || 540);
    const axisStroke = '#94a3b8';
    const gridStroke = 'rgba(148, 163, 184, 0.14)';

    const singleDayX = timestamps.length === 1;
    const minX = singleDayX ? timestamps[0] - 43200 : undefined;
    const maxX = singleDayX ? timestamps[0] + 43200 : undefined;

    const uplotSeries: uPlot.Series[] = [
      {
        label: 'Date',
      },
      ...series.map((s) => ({
        label: s.label,
        stroke: s.color,
        fill: s.fill,
        width: 2.25,
        spanGaps: true,
        dash: s.dash,
        points: {
          show: timestamps.length <= 35,
          size: 6,
          width: 1.5,
          stroke: s.color,
          fill: '#0f172a',
        },
      })),
    ];

    const opts: uPlot.Options = {
      width: initialWidth,
      height,
      padding: [12, 16, 4, 8],
      scales: {
        x: {
          time: true,
          min: minX,
          max: maxX,
        },
        y: {
          auto: true,
          range: (_u, dataMin, dataMax) => {
            if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
              return [0, 10];
            }
            const low = Math.min(0, dataMin);
            const span = Math.max(dataMax - low, 1);
            return [low, dataMax + span * 0.12];
          },
        },
      },
      cursor: {
        drag: { x: false, y: false },
        points: {
          size: 7,
          width: 2,
        },
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
          labelSize: yAxisLabel ? 18 : 0,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: gridStroke, width: 1 },
          font: '11px "JetBrains Mono", monospace',
          size: 56,
          values: (_u, splits) =>
            splits.map((v) => formatCompactTick(v, yAxisUnitSuffix)),
        },
      ],
      series: uplotSeries,
      hooks: {
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
            });
          },
        ],
      },
    };

    const instance = new uPlot(opts, data, host);
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
  }, [data, hasAnyPoint, height, series, timestamps, yAxisLabel, yAxisUnitSuffix]);

  if (!hasAnyPoint) {
    return <div className="analytics-chart-empty">{emptyMessage}</div>;
  }

  const activeIdx =
    hoverInfo && hoverInfo.idx >= 0 && hoverInfo.idx < dateLabels.length
      ? hoverInfo.idx
      : null;

  return (
    <div
      className="analytics-uplot-shell"
      onMouseLeave={() => setHoverInfo(null)}
    >
      <div ref={containerRef} className="analytics-uplot-host" />
      <div className="analytics-uplot-legend">
        {series.map((s) => (
          <span key={s.label} className="analytics-legend-item">
            <span
              className="analytics-legend-swatch"
              style={{ backgroundColor: s.color }}
            />
            <span>{s.label}</span>
          </span>
        ))}
      </div>

      {hoverInfo && activeIdx !== null && (
        <div
          className="analytics-uplot-tooltip"
          style={{
            left: `${Math.max(8, hoverInfo.leftPx)}px`,
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
              <div key={s.label} className="analytics-tooltip-row">
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
