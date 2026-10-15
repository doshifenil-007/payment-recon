// ─────────────────────────────────────────────
// Payments page with list + detail drawer
// ─────────────────────────────────────────────

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CreditCard, X, Copy, CheckCheck,
  ChevronLeft, ChevronRight, Filter, RefreshCw, Clock, Zap, AlertCircle, CornerDownLeft
} from 'lucide-react';
import { paymentsApi } from '../api';
import type { Payment, PaymentDetail, PaymentStatus, WebhookEvent } from '../types';
import { formatAmount, fmtDate, timeAgo, paymentStatusClass, eventStatusClass, shortId } from '../utils';
import { useToast } from '../contexts/ToastContext';
import { copyToClipboard } from '../utils';

const PAGE_SIZE = 20;

const STATUS_OPTIONS: Array<{ value: PaymentStatus | ''; label: string }> = [
  { value: '',          label: 'All statuses' },
  { value: 'PENDING',   label: 'Pending' },
  { value: 'SUCCEEDED', label: 'Succeeded' },
  { value: 'FAILED',    label: 'Failed' },
  { value: 'REFUNDED',  label: 'Refunded' },
];

export function PaymentsPage() {
  const { success } = useToast();
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | ''>('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['payments', statusFilter, page],
    queryFn: () =>
      paymentsApi.list({ status: statusFilter || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const items: Payment[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleCopy = async (text: string, label: string) => {
    const ok = await copyToClipboard(text);
    if (ok) success('Copied!', label);
  };

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Payments</h1>
            <p className="page-subtitle">
              {total > 0 ? `${total.toLocaleString()} payment${total !== 1 ? 's' : ''} total` : 'No payments yet'}
            </p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw size={13} style={{ animation: isFetching ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar mb-6">
        <Filter size={14} color="var(--color-text-muted)" />
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            className={`btn btn-sm ${statusFilter === opt.value ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setStatusFilter(opt.value as PaymentStatus | ''); setPage(1); }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="table-container mb-8">
        <table className="data-table">
          <thead>
            <tr>
              <th>Payment ID</th>
              <th>Gateway ID</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Version</th>
              <th>Last Event</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j}><div className="skeleton" style={{ height: 16, borderRadius: 4, width: '80%' }} /></td>
                  ))}
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">
                    <CreditCard />
                    <h3>No payments found</h3>
                    <p>Try a different filter or run the gateway to generate data</p>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr key={p.id} onClick={() => setSelectedId(p.id)}>
                  <td>
                    <span className="mono" style={{ cursor: 'pointer' }} title={p.id}>
                      {shortId(p.id)}…
                    </span>
                  </td>
                  <td>
                    <span className="mono">{p.gatewayPaymentId}</span>
                  </td>
                  <td>
                    <span className="amount">{formatAmount(p.amountMinor, p.currency)}</span>
                  </td>
                  <td>
                    <span className={paymentStatusClass(p.status)}>
                      <span className="dot" />{p.status}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>v{p.version}</span>
                  </td>
                  <td className="text-muted text-sm">{timeAgo(p.lastEventAt)}</td>
                  <td className="text-muted text-sm">{timeAgo(p.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination">
            <span className="pagination-info">
              Page {page} of {totalPages} · {total} records
            </span>
            <div className="pagination-controls">
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const n = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
                return (
                  <button
                    key={n}
                    className={`page-num ${n === page ? 'current' : ''}`}
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </button>
                );
              })}
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selectedId && (
        <PaymentDrawer
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onCopy={handleCopy}
        />
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}

// ── Detail Drawer ─────────────────────────────

function PaymentDrawer({ id, onClose, onCopy }: {
  id: string;
  onClose: () => void;
  onCopy: (text: string, label: string) => void;
}) {
  const { data, isLoading } = useQuery<PaymentDetail>({
    queryKey: ['payments', id],
    queryFn: () => paymentsApi.get(id),
  });

  const p = data?.payment;
  const events: WebhookEvent[] = data?.events ?? [];

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <div>
            <div className="drawer-title">Payment Detail</div>
            {p && (
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                {p.id}
              </div>
            )}
          </div>
          <button className="close-btn" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="drawer-body">
          {isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 48 }} />
              ))}
            </div>
          ) : p ? (
            <>
              {/* Amount hero */}
              <div style={{
                textAlign: 'center',
                padding: '24px',
                background: 'rgba(99,102,241,0.06)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border)',
                marginBottom: 24,
              }}>
                <div className="amount-large">{formatAmount(p.amountMinor, p.currency)}</div>
                <div style={{ marginTop: 8 }}>
                  <span className={paymentStatusClass(p.status)}>
                    <span className="dot" />{p.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 8 }}>
                  Version {p.version}
                </div>
              </div>

              {/* Fields grid */}
              <div className="detail-grid mb-6">
                <DetailField label="Payment ID">
                  <span className="detail-field-value mono">{shortId(p.id)}</span>
                  <button
                    className="btn btn-ghost btn-icon"
                    style={{ padding: '2px 4px', marginLeft: 4 }}
                    onClick={() => onCopy(p.id, 'Payment ID copied')}
                  >
                    <Copy size={12} />
                  </button>
                </DetailField>
                <DetailField label="Gateway Payment ID">
                  <span className="detail-field-value mono">{p.gatewayPaymentId}</span>
                </DetailField>
                <DetailField label="Currency">
                  <span className="detail-field-value">{p.currency}</span>
                </DetailField>
                <DetailField label="Amount (minor)">
                  <span className="detail-field-value mono">{p.amountMinor}</span>
                </DetailField>
                <DetailField label="Created">
                  <span className="detail-field-value">{fmtDate(p.createdAt)}</span>
                </DetailField>
                <DetailField label="Last Event">
                  <span className="detail-field-value">{p.lastEventAt ? fmtDate(p.lastEventAt) : '—'}</span>
                </DetailField>
              </div>

              {/* Webhook events timeline */}
              <div className="detail-section-title">
                <Zap size={13} />
                Webhook Events ({events.length})
              </div>

              {events.length === 0 ? (
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: 24 }}>
                  No events recorded yet
                </div>
              ) : (
                <div className="timeline">
                  {events.map((ev) => (
                    <EventTimelineItem key={ev.id} event={ev} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <AlertCircle />
              <h3>Payment not found</h3>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="detail-field">
      <span className="detail-field-label">{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{children}</div>
    </div>
  );
}

const EVENT_ICONS: Record<string, React.ElementType> = {
  'payment.created':   Clock,
  'payment.succeeded': CheckCheck,
  'payment.failed':    AlertCircle,
  'refund.created':    CornerDownLeft,
};

function EventTimelineItem({ event }: { event: WebhookEvent }) {
  const Icon = EVENT_ICONS[event.eventType] ?? Zap;
  const isProcessed = event.status === 'PROCESSED';
  const isFailed = event.status === 'FAILED' || event.status === 'DEAD';

  return (
    <div className="timeline-item">
      <div
        className="timeline-dot"
        style={{
          borderColor: isProcessed
            ? 'var(--color-emerald)'
            : isFailed
              ? 'var(--color-rose)'
              : 'var(--color-border)',
        }}
      >
        <Icon size={12} color={isProcessed ? 'var(--color-emerald)' : isFailed ? 'var(--color-rose)' : 'var(--color-text-muted)'} />
      </div>
      <div className="timeline-content">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="timeline-event-type">{event.eventType}</span>
          <span className={eventStatusClass(event.status)}>
            <span className="dot" />{event.status}
          </span>
          {event.attemptCount > 1 && (
            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
              {event.attemptCount} attempts
            </span>
          )}
        </div>
        <div className="timeline-meta">
          Received {timeAgo(event.receivedAt)}
          {event.processedAt && ` · Processed ${timeAgo(event.processedAt)}`}
        </div>
        {event.lastError && (
          <div className="timeline-error">{event.lastError}</div>
        )}
      </div>
    </div>
  );
}
