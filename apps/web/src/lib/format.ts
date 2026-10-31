export {
  formatBytes,
  formatSpeed,
  formatEta,
  formatRuntime,
  DOWNLOADABILITY_LABEL,
  DOWNLOAD_STATUS_LABEL,
} from '@blaxkvault/shared';

import type { DownloadStatus, Downloadability } from '@blaxkvault/shared';

/** Tailwind classes for a real job state. Status colours are never decorative. */
export const STATUS_CLASS: Record<DownloadStatus, string> = {
  inspected: 'text-status-unknown border-status-unknown/40 bg-status-unknown/10',
  queued: 'text-status-queued border-status-queued/40 bg-status-queued/10',
  downloading: 'text-status-downloading border-status-downloading/40 bg-status-downloading/10',
  paused: 'text-status-paused border-status-paused/40 bg-status-paused/10',
  completed: 'text-status-completed border-status-completed/40 bg-status-completed/10',
  failed: 'text-status-failed border-status-failed/40 bg-status-failed/10',
  cancelled: 'text-status-cancelled border-status-cancelled/40 bg-status-cancelled/10',
  unsupported: 'text-status-unknown border-status-unknown/40 bg-status-unknown/10',
  unavailable: 'text-status-unknown border-status-unknown/40 bg-status-unknown/10',
};

export const STATUS_BAR_CLASS: Record<DownloadStatus, string> = {
  inspected: 'bg-status-unknown',
  queued: 'bg-status-queued',
  downloading: 'bg-status-downloading',
  paused: 'bg-status-paused',
  completed: 'bg-status-completed',
  failed: 'bg-status-failed',
  cancelled: 'bg-status-cancelled',
  unsupported: 'bg-status-unknown',
  unavailable: 'bg-status-unknown',
};

/** Verdict chip styling: available is the only "green" state, and unknown is never green. */
export const VERDICT_CLASS: Record<Downloadability, string> = {
  available: 'text-status-completed border-status-completed/45 bg-status-completed/10',
  unavailable: 'text-status-failed border-status-failed/40 bg-status-failed/10',
  unsupported: 'text-status-unknown border-status-unknown/40 bg-status-unknown/10',
  unknown: 'text-status-paused border-status-paused/40 bg-status-paused/10',
};

export function prettyDate(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function prettyDateTime(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(iso?: string): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return prettyDate(iso);
}
