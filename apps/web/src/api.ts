// ─────────────────────────────────────────────
// API client – all calls go through here
// ─────────────────────────────────────────────

import type {
  AuditLog,
  PagedResult,
  Payment,
  PaymentDetail,
  User,
  WebhookEvent,
  WebhookEventDetail,
  WebhookEventStatus,
  PaymentStatus,
  PaymentTestRequestInput,
  PaymentTestResult,
  BatchTestResponse,
} from './types';

const BASE = '/api';

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.error ?? msg;
    } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    request<User>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () =>
    request<void>('/auth/logout', { method: 'POST' }),

  me: () =>
    request<User>('/auth/me'),
};

// ── Payments ──────────────────────────────────
export const paymentsApi = {
  list: (params?: { status?: PaymentStatus; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params?.status)   q.set('status', params.status);
    if (params?.page)     q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    return request<PagedResult<Payment>>(`/payments${q.toString() ? `?${q}` : ''}`);
  },

  get: (id: string) =>
    request<PaymentDetail>(`/payments/${id}`),
};

// ── Webhook Events ────────────────────────────
export const eventsApi = {
  list: (params?: { status?: WebhookEventStatus; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params?.status)   q.set('status', params.status);
    if (params?.page)     q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    return request<PagedResult<WebhookEvent>>(`/events${q.toString() ? `?${q}` : ''}`);
  },

  get: (id: string) =>
    request<WebhookEventDetail>(`/events/${id}`),

  forceRetry: (id: string) =>
    request<{ status: string }>(`/events/${id}/force-retry`, { method: 'POST' }),
};

// ── Audit ─────────────────────────────────────
export const auditApi = {
  list: (limit = 50) =>
    request<{ items: AuditLog[] }>(`/audit?limit=${limit}`),
};

// ── Health ────────────────────────────────────
export const healthApi = {
  check: () =>
    request<{ status: string }>('/health'),
};

// ── Payment Testing ───────────────────────────
export const testingApi = {
  send: (data: PaymentTestRequestInput) =>
    request<PaymentTestResult>('/testing/send', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  sendBatch: (requests: PaymentTestRequestInput[], concurrent = false) =>
    request<BatchTestResponse>('/testing/batch', {
      method: 'POST',
      body: JSON.stringify({ requests, concurrent }),
    }),

  reset: () =>
    request<{ success: boolean; message: string }>('/testing/reset', {
      method: 'POST',
    }),

  getDbStatus: (paymentId: string) =>
    request<PaymentTestResult['databaseOutcome']>(`/testing/db-status/${encodeURIComponent(paymentId)}`),
};

export { ApiError };
