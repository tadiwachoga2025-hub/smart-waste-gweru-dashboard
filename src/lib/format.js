// Shared formatting so every screen words times and numbers the same way.

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;

/** "5 minutes ago", "yesterday". Accepts epoch ms, ISO string or Date. */
export function timeAgo(value, now = Date.now()) {
  const t = toMs(value);
  if (t == null) return '—';
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.345, 'week'], [12, 'month'], [Infinity, 'year']];
  let n = diff;
  for (const [size, unit] of steps) {
    if (Math.abs(n) < size) return rtf ? rtf.format(Math.round(n), unit) : `${Math.abs(Math.round(n))} ${unit}s ago`;
    n /= size;
  }
  return '—';
}

export function formatDateTime(value) {
  const t = toMs(value);
  if (t == null) return '—';
  return new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(value) {
  const t = toMs(value);
  if (t == null) return '—';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Epoch ms from a number, Date or any string Date can parse; null otherwise. */
export function toMs(value) {
  if (value == null || value === '' || value === '—') return null;
  if (typeof value === 'number') return value;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
