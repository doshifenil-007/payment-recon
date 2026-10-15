// ─────────────────────────────────────────────
// Audit Log page
// ─────────────────────────────────────────────

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ScrollText, Activity, RefreshCw, Shield, User, Zap, ArrowRight, AlertTriangle
} from 'lucide-react';
import { auditApi } from '../api';
import type { AuditLog } from '../types';
import { fmtDate, timeAgo, shortId } from '../utils';

const LIMIT_OPTIONS = [20, 50, 100, 200];

const ACTION_ICONS: Record<string, React.ElementType> = {
  'webhook.force_retry':    RefreshCw,
  'payment.status_changed': Zap,
  'webhook.processed':      Activity,
  'webhook.failed':         AlertTriangle,
};

const ACTION_COLORS: Record<string, string> = {
  'webhook.force_retry':    'var(--color-violet)',
  'payment.status_changed': 'var(--color-cyan)',
  'webhook.processed':      'var(--color-emerald)',
  'webhook.failed':         'var(--color-rose)',
};

export function AuditPage() {
  const [limit, setLimit] = useState(50);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['audit', limit],
    queryFn: () => auditApi.list(limit),
    refetchInterval: 30_000,
  });

  const items: AuditLog[] = data?.items ?? [];

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Audit Log</h1>
            <p className="page-subtitle">
              Append-only history of every system and user action
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="select"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              {LIMIT_OPTIONS.map((l) => (
                <option key={l} value={l}>Last {l}</option>
              ))}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw size={13} style={{ animation: isFetching ? 'spin 1s linear infinite' : 'none' }} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{
          padding: '10px 18px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          fontSize: '0.8rem',
        }}>
          <span style={{ color: 'var(--color-text-muted)' }}>Total Records: </span>
          <strong style={{ color: 'var(--color-text-primary)' }}>{items.length}</strong>
        </div>
        {countByAction(items).slice(0, 4).map(([action, count]) => (
          <div key={action} style={{
            padding: '10px 18px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            fontSize: '0.8rem',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              color: ACTION_COLORS[action] ?? 'var(--color-primary-light)',
              fontSize: '0.75rem',
            }}>{action}</span>
            <strong style={{ color: 'var(--color-text-primary)' }}>{count}</strong>
          </div>
        ))}
      </div>

      {/* Audit entries */}
      <div className="table-container">
        <div className="table-header-row">
          <div>
            <div className="table-title">Activity Feed</div>
            <div className="table-subtitle">Most recent {limit} entries</div>
          </div>
          <div className="live-indicator">
            <span className="live-dot" />
            Auto-refresh 30s
          </div>
        </div>

        <div style={{ padding: '0 8px' }}>
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="audit-item">
                <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="skeleton" style={{ height: 14, width: '40%', borderRadius: 4 }} />
                  <div className="skeleton" style={{ height: 12, width: '60%', borderRadius: 4 }} />
                </div>
              </div>
            ))
          ) : items.length === 0 ? (
            <div className="empty-state">
              <ScrollText />
              <h3>No audit entries yet</h3>
              <p>Activity will appear here as payments are processed</p>
            </div>
          ) : (
            items.map((entry) => (
              <AuditEntry key={entry.id} entry={entry} />
            ))
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}

function AuditEntry({ entry }: { entry: AuditLog }) {
  const Icon = ACTION_ICONS[entry.action] ?? Activity;
  const color = ACTION_COLORS[entry.action] ?? 'var(--color-primary-light)';
  const isUser = !entry.actor.includes(':') && !entry.actor.includes('system');

  const hasDiff = entry.before || entry.after;

  return (
    <div className="audit-item">
      <div className="audit-icon" style={{ background: `${color}20`, color }}>
        <Icon />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <span className="audit-action">{entry.action}</span>
          <span style={{
            fontSize: '0.7rem',
            fontFamily: 'var(--font-mono)',
            padding: '1px 7px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(99,102,241,0.08)',
            color: 'var(--color-text-muted)',
          }}>
            {entry.entity_type}/{shortId(entry.entity_id)}
          </span>
        </div>
        <div className="audit-meta">
          {isUser ? (
            <><User size={10} style={{ display: 'inline', marginRight: 4 }} />User {shortId(entry.actor)}</>
          ) : (
            <><Shield size={10} style={{ display: 'inline', marginRight: 4 }} />{entry.actor}</>
          )}
          {' · '}
          <span title={fmtDate(entry.created_at)}>{timeAgo(entry.created_at)}</span>
          {entry.request_id && (
            <span style={{ marginLeft: 8, color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}>
              req:{shortId(entry.request_id)}
            </span>
          )}
        </div>

        {hasDiff && (
          <div className="audit-diff">
            {entry.before && (
              <span className="diff-chip diff-before">
                before: {JSON.stringify(entry.before)}
              </span>
            )}
            {entry.before && entry.after && (
              <ArrowRight size={10} color="var(--color-text-muted)" />
            )}
            {entry.after && (
              <span className="diff-chip diff-after">
                after: {JSON.stringify(entry.after)}
              </span>
            )}
          </div>
        )}
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', alignSelf: 'flex-start', marginTop: 2 }}>
        {fmtDate(entry.created_at)}
      </div>
    </div>
  );
}

function countByAction(items: AuditLog[]): [string, number][] {
  const counts: Record<string, number> = {};
  items.forEach((i) => {
    counts[i.action] = (counts[i.action] ?? 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
