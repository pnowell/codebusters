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
