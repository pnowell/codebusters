/**
 * Formats seconds as a compact M:SS clock string (e.g., 125 -> "2:05").
 */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Formats seconds as a human-readable duration string (e.g., 125 -> "2m 05s").
 */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

/**
 * Formats cipher solve duration concisely (e.g., 42 -> "42s", 84 -> "1m 24s").
 */
export function formatSolveDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  if (m === 0) {
    return `${s}s`;
  }
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

/**
 * Formats normalized cipher solve speed in seconds per letter (or per unique letter on Aristocrat).
 */
export function formatCipherPace(
  elapsedMs: number,
  unitCount: number,
  isUniqueLetterMode = false
): string {
  const safeUnits = Math.max(1, Math.trunc(unitCount));
  const elapsedSec = Math.max(0, elapsedMs) / 1000;
  const secPerUnit = elapsedSec / safeUnits;
  const unitLabel = isUniqueLetterMode ? 'unique letter' : 'letter';
  return `${secPerUnit.toFixed(1)}s / ${unitLabel}`;
}

