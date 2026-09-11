/**
 * Format relative date for list headers (e.g. Today, Yesterday, 9 Sep 2026).
 */
export function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;

  const today = new Date();
  const txDate = new Date(year, month - 1, day);

  const isToday =
    today.getFullYear() === txDate.getFullYear() &&
    today.getMonth() === txDate.getMonth() &&
    today.getDate() === txDate.getDate();

  if (isToday) return 'Today';

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === txDate.getFullYear() &&
    yesterday.getMonth() === txDate.getMonth() &&
    yesterday.getDate() === txDate.getDate();

  if (isYesterday) return 'Yesterday';

  return txDate.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: txDate.getFullYear() === today.getFullYear() ? undefined : 'numeric'
  });
}

/**
 * Helper to get current YYYY-MM-DD in local time
 */
export function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** "1h 15m" / "45m" / "1h" */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** 12500 -> "12,500 kg" honoring the configured unit. */
export function formatVolume(volume: number, unit: 'kg' | 'lb' = 'kg'): string {
  return `${Math.round(volume).toLocaleString('en-US')} ${unit}`;
}

/** 82.5 -> "82.5 kg" (weight shown without trailing .0). */
export function formatWeight(weight: number, unit: 'kg' | 'lb' = 'kg'): string {
  const display = Number.isInteger(weight) ? String(weight) : weight.toFixed(1);
  return weight <= 0 ? `Bodyweight` : `${display} ${unit}`;
}

/** 95 -> "1:35" for the rest timer. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
