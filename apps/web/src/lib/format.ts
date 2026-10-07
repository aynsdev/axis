const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatTokens = (n: number) => compact.format(n);
export const formatUsd = (n: number | null) => (n === null ? '—' : n > 0 && n < 0.01 ? '<$0.01' : usd.format(n));

export function formatDuration(startIso: string | null, endIso: string | null, now = Date.now()): string {
  if (!startIso) return '—';
  const ms = (endIso ? Date.parse(endIso) : now) - Date.parse(startIso);
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatRelative(iso: string, now = Date.now()): string {
  const diff = (Date.parse(iso) - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Tokens that count toward work done: fresh input, cache writes and output. Cache reads are reported separately. */
export const billableTokens = (t: { input: number; cacheWrite: number; output: number }) => t.input + t.cacheWrite + t.output;
