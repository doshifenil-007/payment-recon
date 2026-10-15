// ─────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────

import { format, formatDistanceToNow } from 'date-fns';
import type { PaymentStatus, WebhookEventStatus } from './types';

/** Convert minor units (e.g. cents) to a formatted currency string */
export function formatAmount(amountMinor: string, currency: string): string {
  const num = Number(amountMinor) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${currency.toUpperCase()} ${num.toFixed(2)}`;
  }
}

/** Short relative time (e.g. "2 mins ago") */
export function timeAgo(date: string | Date | null): string {
  if (!date) return '—';
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

/** Absolute datetime */
export function fmtDate(date: string | Date | null): string {
  if (!date) return '—';
  return format(new Date(date), 'MMM d, yyyy HH:mm:ss');
}

/** Short datetime */
export function fmtDateShort(date: string | Date | null): string {
  if (!date) return '—';
  return format(new Date(date), 'MMM d, HH:mm');
}

/** Badge CSS class for payment status */
export function paymentStatusClass(status: PaymentStatus): string {
  const map: Record<PaymentStatus, string> = {
    PENDING:   'badge badge-pending',
    SUCCEEDED: 'badge badge-succeeded',
    FAILED:    'badge badge-failed',
    REFUNDED:  'badge badge-refunded',
  };
  return map[status] ?? 'badge';
}

/** Badge CSS class for webhook event status */
export function eventStatusClass(status: WebhookEventStatus): string {
  const map: Record<WebhookEventStatus, string> = {
    RECEIVED:  'badge badge-received',
    PROCESSED: 'badge badge-processed',
    FAILED:    'badge badge-failed',
    REJECTED:  'badge badge-rejected',
    DEAD:      'badge badge-dead',
  };
  return map[status] ?? 'badge';
}

/** Truncate a UUID for display */
export function shortId(id: string): string {
  return id.split('-')[0] ?? id.slice(0, 8);
}

/** Copy text to clipboard */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
