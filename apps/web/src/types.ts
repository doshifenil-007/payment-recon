// ─────────────────────────────────────────────
// Shared types matching the backend schema
// ─────────────────────────────────────────────

export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
export type WebhookEventStatus = 'RECEIVED' | 'PROCESSED' | 'FAILED' | 'REJECTED' | 'DEAD';
export type Role = 'ADMIN' | 'VIEWER';
export type GatewayEventType = 'payment.created' | 'payment.succeeded' | 'payment.failed' | 'refund.created';

export interface User {
  id: string;
  email: string;
  role: Role;
  merchantId: string;
}

export interface Payment {
  id: string;
  gatewayPaymentId: string;
  amountMinor: string;   // BIGINT as string
  currency: string;
  status: PaymentStatus;
  version: number;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookEvent {
  id: string;
  gatewayEventId: string;
  eventType: GatewayEventType;
  status: WebhookEventStatus;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export interface WebhookEventDetail extends WebhookEvent {
  attemptBase: number;
  payload: Record<string, unknown>;
  attempts: EventAttempt[];
}

export interface EventAttempt {
  attempt_no: number;
  outcome: 'SUCCEEDED' | 'FAILED';
  error: string | null;
  created_at: string;
}

export interface PaymentDetail {
  payment: Payment;
  events: WebhookEvent[];
}

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  request_id: string | null;
  created_at: string;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiError {
  error: string;
  details?: unknown;
}

export interface PaymentTestRequestInput {
  id?: string;
  paymentId: string;
  amount?: number | string;
  amountMinor?: string | number;
  currency?: string;
  eventType?: GatewayEventType | 'full_flow';
  eventId?: string;
  simulateCrash?: boolean;
  simulateInvalidSignature?: boolean;
  simulateMalformedJson?: boolean;
}

export interface PaymentTestResult {
  requestId: string;
  paymentId: string;
  eventType: string;
  amountDisplay: string;
  amountMinor: string;
  currency: string;
  httpStatus: number;
  status: 'PROCESSED' | 'DUPLICATE' | 'REJECTED' | 'FAILED' | 'PENDING' | 'ERROR';
  duplicate: boolean;
  duplicateType: 'NONE' | 'EXACT_EVENT_DUPLICATE' | 'PAYMENT_ALREADY_EXISTS' | 'CONFLICTING_DETAILS';
  message: string;
  errorReason: string | null;
  databaseOutcome: {
    paymentExists: boolean;
    payment: {
      id: string;
      gatewayPaymentId: string;
      amountMinor: string;
      currency: string;
      status: string;
      version: number;
      createdAt: string;
      updatedAt: string;
    } | null;
    eventsCount: number;
    auditLogsCount: number;
    recentEvents: Array<{
      id: string;
      gatewayEventId: string;
      eventType: string;
      status: string;
      attemptCount: number;
      lastError: string | null;
      receivedAt: string;
    }>;
  };
  rawResponse?: unknown;
}

export interface BatchTestResponse {
  summary: {
    total: number;
    processed: number;
    duplicates: number;
    rejected: number;
    failed: number;
    errors: number;
  };
  results: PaymentTestResult[];
}

