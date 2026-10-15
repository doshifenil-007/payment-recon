// Shared rules for payments and gateway events. Used by the API and (later) the dashboard.

export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const WEBHOOK_EVENT_STATUSES = ['RECEIVED', 'PROCESSED', 'FAILED', 'REJECTED', 'DEAD'] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

export const ROLES = ['ADMIN', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

// Only forward transitions are valid. Anything else is a permanent error.
const ALLOWED: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: ['REFUNDED'],
  FAILED: [],
  REFUNDED: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED[from].includes(to);
}

export const EVENT_TYPES = ['payment.created', 'payment.succeeded', 'payment.failed', 'refund.created'] as const;
export type GatewayEventType = (typeof EVENT_TYPES)[number];

// Which payment status each gateway event type produces.
export const EVENT_TARGET_STATUS: Record<GatewayEventType, PaymentStatus> = {
  'payment.created': 'PENDING',
  'payment.succeeded': 'SUCCEEDED',
  'payment.failed': 'FAILED',
  'refund.created': 'REFUNDED',
};
