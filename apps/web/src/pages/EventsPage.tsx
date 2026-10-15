// ─────────────────────────────────────────────
// Events page – webhook event log with force-retry
// ─────────────────────────────────────────────
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Webhook, X, RefreshCw, AlertCircle, ChevronLeft, ChevronRight,
  Filter, RotateCcw, Loader2,
  ChevronDown, ChevronUp, FileJson
} from 'lucide-react';
import { eventsApi } from '../api';
import type { WebhookEvent, WebhookEventDetail, WebhookEventStatus } from '../types';
import { fmtDate, timeAgo, eventStatusClass, shortId } from '../utils';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

const PAGE_SIZE = 20;

const STATUS_OPTIONS: Array<{ value: WebhookEventStatus | ''; label: string }> = [
  { value: '',          label: 'All statuses' },
  { value: 'RECEIVED',  label: 'Received' },
  { value: 'PROCESSED', label: 'Processed' },
  { value: 'FAILED',    label: 'Failed' },
  { value: 'REJECTED',  label: 'Rejected' },
  { value: 'DEAD',      label: 'Dead' },
];

// const STATUS_ICONS: Record<WebhookEventStatus, React.ElementType> = {
//   RECEIVED:  Clock,
//   PROCESSED: CheckCircle2,
//   FAILED:    AlertCircle,
//   REJECTED:  Ban,
//   DEAD:      Skull,
// };

export function EventsPage() {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<WebhookEventStatus | ''>('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['events', statusFilter, page],
    queryFn: () =>
      eventsApi.list({ status: statusFilter || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
    refetchInterval: 15_000,
  });

  const items: WebhookEvent[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Webhook Events</h1>
            <p className="page-subtitle">
              {total > 0 ? `${total.toLocaleString()} event${total !== 1 ? 's' : ''} total` : 'No events yet'}
              {user?.role === 'ADMIN' && (
                <span style={{ marginLeft: 8, color: 'var(--color-primary-light)', fontSize: '0.75rem' }}>
                  · Admin: force-retry available
                </span>
              )}
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
            onClick={() => { setStatusFilter(opt.value as WebhookEventStatus | ''); setPage(1); }}
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
              <th>Event ID</th>
              <th>Gateway Event ID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Received</th>
              <th>Processed</th>
              {user?.role === 'ADMIN' && <th>Actions</th>}
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
                <td colSpan={user?.role === 'ADMIN' ? 8 : 7}>
                  <div className="empty-state">
                    <Webhook />
                    <h3>No events found</h3>
                    <p>Try changing the filter or run the gateway</p>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((ev) => {
                // const Icon = STATUS_ICONS[ev.status] ?? Clock;
                const canRetry = user?.role === 'ADMIN' && (ev.status === 'FAILED' || ev.status === 'DEAD');
                return (
                  <tr key={ev.id} onClick={() => setSelectedId(ev.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      <span className="mono" title={ev.id}>{shortId(ev.id)}…</span>
                    </td>
                    <td>
                      <span className="mono">{ev.gatewayEventId}</span>
                    </td>
                    <td>
                      <span style={{
                        fontSize: '0.78rem',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--color-text-secondary)',
                        background: 'rgba(99,102,241,0.08)',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-sm)',
                      }}>
                        {ev.eventType}
                      </span>
                    </td>
                    <td>
                      <span className={eventStatusClass(ev.status)}>
                        <span className="dot" />{ev.status}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        fontSize: '0.8rem',
                        color: ev.attemptCount > 1 ? 'var(--color-amber)' : 'var(--color-text-muted)',
                        fontWeight: ev.attemptCount > 1 ? 600 : 400,
                      }}>
                        {ev.attemptCount}
                      </span>
                    </td>
                    <td className="text-muted text-sm">{timeAgo(ev.receivedAt)}</td>
                    <td className="text-muted text-sm">{ev.processedAt ? timeAgo(ev.processedAt) : '—'}</td>
                    {user?.role === 'ADMIN' && (
                      <td onClick={(e) => e.stopPropagation()}>
                        {canRetry && (
                          <ForceRetryButton
                            id={ev.id}
                            onSuccess={(newStatus) => {
                              success('Retry triggered', `Event moved to ${newStatus}`);
                              qc.invalidateQueries({ queryKey: ['events'] });
                            }}
                            onError={(msg) => toastError('Retry failed', msg)}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="pagination">
            <span className="pagination-info">Page {page} of {totalPages} · {total} records</span>
            <div className="pagination-controls">
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const n = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
                return (
                  <button key={n} className={`page-num ${n === page ? 'current' : ''}`} onClick={() => setPage(n)}>{n}</button>
                );
              })}
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Drawer */}
      {selectedId && (
        <EventDrawer
          id={selectedId}
          onClose={() => setSelectedId(null)}
          isAdmin={user?.role === 'ADMIN'}
        />
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}

// ── Force retry button ────────────────────────

function ForceRetryButton({ id, onSuccess, onError }: {
  id: string;
  onSuccess: (status: string) => void;
  onError: (msg: string) => void;
}) {
  const { mutate, isPending } = useMutation({
    mutationFn: () => eventsApi.forceRetry(id),
    onSuccess: (data) => onSuccess(data.status),
    onError: (err) => onError(err instanceof Error ? err.message : 'Unknown error'),
  });

  return (
    <button
      className="btn btn-success btn-sm"
      onClick={() => mutate()}
      disabled={isPending}
      title="Force retry this event"
    >
      {isPending ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCcw size={12} />}
      Retry
    </button>
  );
}

// ── Event detail drawer ───────────────────────

function EventDrawer({ id, onClose, isAdmin }: { id: string; onClose: () => void; isAdmin?: boolean }) {
  const { success: toastSuccess, error: toastError } = useToast();
  const qc = useQueryClient();
  const [showPayload, setShowPayload] = useState(false);

  const { data, isLoading } = useQuery<WebhookEventDetail>({
    queryKey: ['event-detail', id],
    queryFn: () => eventsApi.get(id),
  });

  const { mutate: forceRetry, isPending: retrying } = useMutation({
    mutationFn: () => eventsApi.forceRetry(id),
    onSuccess: (res) => {
      toastSuccess('Retry triggered', `New status: ${res.status}`);
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['event-detail', id] });
    },
    onError: (err) => toastError('Retry failed', err instanceof Error ? err.message : 'Unknown error'),
  });

  const ev = data;
  const canRetry = isAdmin && ev && (ev.status === 'FAILED' || ev.status === 'DEAD');

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <div>
            <div className="drawer-title">Event Detail</div>
            {ev && (
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                {ev.id}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {canRetry && (
              <button className="btn btn-success btn-sm" onClick={() => forceRetry()} disabled={retrying}>
                {retrying
                  ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />Retrying…</>
                  : <><RotateCcw size={12} />Force Retry</>
                }
              </button>
            )}
            <button className="close-btn" onClick={onClose}><X size={14} /></button>
          </div>
        </div>

        <div className="drawer-body">
          {isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 48 }} />
              ))}
            </div>
          ) : ev ? (
            <>
              {/* Status banner */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                background: 'rgba(99,102,241,0.06)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border)',
                marginBottom: 24,
              }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Event Type</div>
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>{ev.eventType}</div>
                </div>
                <span className={eventStatusClass(ev.status)}>
                  <span className="dot" />{ev.status}
                </span>
              </div>

              {/* Fields */}
              <div className="detail-grid mb-6">
                <div className="detail-field">
                  <span className="detail-field-label">Gateway Event ID</span>
                  <span className="detail-field-value mono">{ev.gatewayEventId}</span>
                </div>
                <div className="detail-field">
                  <span className="detail-field-label">Attempt Count</span>
                  <span className="detail-field-value">{ev.attemptCount}</span>
                </div>
                <div className="detail-field">
                  <span className="detail-field-label">Received At</span>
                  <span className="detail-field-value">{fmtDate(ev.receivedAt)}</span>
                </div>
                <div className="detail-field">
                  <span className="detail-field-label">Processed At</span>
                  <span className="detail-field-value">{ev.processedAt ? fmtDate(ev.processedAt) : '—'}</span>
                </div>
                <div className="detail-field">
                  <span className="detail-field-label">Next Attempt</span>
                  <span className="detail-field-value">{ev.nextAttemptAt ? timeAgo(ev.nextAttemptAt) : '—'}</span>
                </div>
                <div className="detail-field">
                  <span className="detail-field-label">Attempt Base</span>
                  <span className="detail-field-value">{ev.attemptBase}</span>
                </div>
              </div>

              {/* Last error */}
              {ev.lastError && (
                <div style={{ marginBottom: 24 }}>
                  <div className="detail-section-title">
                    <AlertCircle size={13} />
                    Last Error
                  </div>
                  <div style={{
                    background: 'rgba(244,63,94,0.08)',
                    border: '1px solid rgba(244,63,94,0.2)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 16px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem',
                    color: '#fb7185',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}>
                    {ev.lastError}
                  </div>
                </div>
              )}

              {/* Attempt history */}
              {ev.attempts?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div className="detail-section-title">
                    <RotateCcw size={13} />
                    Attempt History ({ev.attempts.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {ev.attempts.map((a) => (
                      <div key={a.attempt_no} style={{
                        padding: '10px 14px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                        background: a.outcome === 'SUCCEEDED'
                          ? 'rgba(16,185,129,0.05)'
                          : 'rgba(244,63,94,0.05)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: a.error ? 8 : 0 }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: a.outcome === 'SUCCEEDED' ? 'var(--color-emerald)' : 'var(--color-rose)' }}>
                            Attempt #{a.attempt_no} · {a.outcome}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{timeAgo(a.created_at)}</span>
                        </div>
                        {a.error && (
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: '#fb7185', marginTop: 4 }}>
                            {a.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Payload collapsible */}
              <div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowPayload((v) => !v)}
                  style={{ marginBottom: 12, gap: 8 }}
                >
                  <FileJson size={13} />
                  {showPayload ? 'Hide' : 'Show'} Payload
                  {showPayload ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {showPayload && (
                  <pre style={{
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px 16px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.72rem',
                    color: 'var(--color-text-secondary)',
                    overflow: 'auto',
                    maxHeight: 320,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    lineHeight: 1.7,
                  }}>
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <AlertCircle />
              <h3>Event not found</h3>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
