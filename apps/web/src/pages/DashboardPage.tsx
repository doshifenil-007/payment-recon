// ─────────────────────────────────────────────
// Dashboard – summary stats + charts
// ─────────────────────────────────────────────

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList
} from 'recharts';
import {
  CreditCard, CheckCircle2, XCircle,
Webhook, Skull, Activity, TrendingUp
} from 'lucide-react';
import { paymentsApi, eventsApi, auditApi } from '../api';
import type { Payment, WebhookEvent, AuditLog } from '../types';
import { formatAmount, fmtDateShort, timeAgo } from '../utils';
import { useNavigate } from 'react-router-dom';

// ── Custom tooltip ────────────────────────────
const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border-bright)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      fontSize: '0.78rem',
      boxShadow: 'var(--shadow-elevated)',
    }}>
      <div style={{ color: 'var(--color-text-muted)', marginBottom: 6 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ display: 'flex', gap: 8, alignItems: 'center', color: p.color }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          <span style={{ color: 'var(--color-text-muted)' }}>{p.name}:</span>
          <strong style={{ color: 'var(--color-text-primary)' }}>{p.value}</strong>
        </div>
      ))}
    </div>
  );
};

export function DashboardPage() {
  const navigate = useNavigate();

  const { data: payments } = useQuery({
    queryKey: ['payments'],
    queryFn: () => paymentsApi.list({ pageSize: 100 }),
    refetchInterval: 30_000,
  });

  const { data: events } = useQuery({
    queryKey: ['events'],
    queryFn: () => eventsApi.list({ pageSize: 100 }),
    refetchInterval: 30_000,
  });

  const { data: audit } = useQuery({
    queryKey: ['audit'],
    queryFn: () => auditApi.list(20),
    refetchInterval: 60_000,
  });

  const payItems: Payment[] = payments?.items ?? [];
  const evItems: WebhookEvent[]  = events?.items ?? [];
  const auditItems: AuditLog[] = audit?.items ?? [];

  // ── Stats ────────────────────────────────────
  const stats = {
    total:     payItems.length,
    succeeded: payItems.filter((p) => p.status === 'SUCCEEDED').length,
    failed:    payItems.filter((p) => p.status === 'FAILED').length,
    pending:   payItems.filter((p) => p.status === 'PENDING').length,
    refunded:  payItems.filter((p) => p.status === 'REFUNDED').length,
    totalRevenue: payItems
      .filter((p) => p.status === 'SUCCEEDED')
      .reduce((sum, p) => sum + Number(p.amountMinor) / 100, 0),
  };

  const evStats = {
    processed: evItems.filter((e) => e.status === 'PROCESSED').length,
    failed:    evItems.filter((e) => e.status === 'FAILED').length,
    dead:      evItems.filter((e) => e.status === 'DEAD').length,
    received:  evItems.filter((e) => e.status === 'RECEIVED').length,
  };

  // ── Pie chart data ────────────────────────────
  const pieData = [
    { name: 'Succeeded', value: stats.succeeded, color: 'var(--color-emerald)' },
    { name: 'Failed',    value: stats.failed,    color: 'var(--color-rose)' },
    { name: 'Pending',   value: stats.pending,   color: 'var(--color-amber)' },
    { name: 'Refunded',  value: stats.refunded,  color: 'var(--color-cyan)' },
  ].filter((d) => d.value > 0);

  // ── Area chart – payments over time ───────────
  const timelineData = React.useMemo(() => {
    const buckets: Record<string, { date: string; succeeded: number; failed: number; pending: number }> = {};
    payItems.forEach((p) => {
      const day = fmtDateShort(p.createdAt);
      if (!buckets[day]) buckets[day] = { date: day, succeeded: 0, failed: 0, pending: 0 };
      if (p.status === 'SUCCEEDED') buckets[day].succeeded++;
      else if (p.status === 'FAILED') buckets[day].failed++;
      else buckets[day].pending++;
    });
    return Object.values(buckets).slice(-10);
  }, [payItems]);

  // ── Bar chart – event types ────────────────────
  const eventTypeData = React.useMemo(() => {
    const types: Record<string, number> = {};
    evItems.forEach((e) => {
      types[e.eventType] = (types[e.eventType] ?? 0) + 1;
    });
    return Object.entries(types).map(([name, count]) => ({ name, count }));
  }, [evItems]);

  return (
    <>
      {/* ─── Page Header ─────────────────────── */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">Real-time payment reconciliation overview</p>
          </div>
          <div className="live-indicator">
            <span className="live-dot" />
            Live
          </div>
        </div>
      </div>

      {/* ─── Stat Cards ──────────────────────── */}
      <div className="stat-grid">
        <StatCard
          icon={CreditCard}
          label="Total Payments"
          value={stats.total}
          sub={`${payments?.total ?? 0} in database`}
          accent="var(--color-primary)"
          iconBg="rgba(99,102,241,0.12)"
        />
        <StatCard
          icon={CheckCircle2}
          label="Succeeded"
          value={stats.succeeded}
          sub={stats.total ? `${((stats.succeeded / stats.total) * 100).toFixed(1)}% success rate` : '—'}
          accent="var(--color-emerald)"
          iconBg="rgba(16,185,129,0.12)"
        />
        <StatCard
          icon={XCircle}
          label="Failed"
          value={stats.failed}
          sub={stats.total ? `${((stats.failed / stats.total) * 100).toFixed(1)}% failure rate` : '—'}
          accent="var(--color-rose)"
          iconBg="rgba(244,63,94,0.12)"
        />
        <StatCard
          icon={TrendingUp}
          label="Revenue"
          value={`$${stats.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          sub="From successful payments"
          accent="var(--color-violet)"
          iconBg="rgba(139,92,246,0.12)"
        />
        <StatCard
          icon={Webhook}
          label="Events Processed"
          value={evStats.processed}
          sub={`${evItems.length} total events`}
          accent="var(--color-cyan)"
          iconBg="rgba(6,182,212,0.12)"
        />
        <StatCard
          icon={Skull}
          label="Dead Events"
          value={evStats.dead}
          sub={evStats.failed > 0 ? `${evStats.failed} still failing` : 'None failing'}
          accent="var(--color-amber)"
          iconBg="rgba(245,158,11,0.12)"
        />
      </div>

      {/* ─── Charts ──────────────────────────── */}
      <div className="chart-section">
        {/* Area chart */}
        <div className="card">
          <div style={{ marginBottom: 20 }}>
            <div className="table-title">Payment Timeline</div>
            <div className="table-subtitle">Status breakdown over time</div>
          </div>
          {timelineData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={timelineData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                <defs>
                  <linearGradient id="gradSucceeded" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--color-emerald)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-emerald)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--color-rose)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--color-rose)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="succeeded" stroke="var(--color-emerald)" fill="url(#gradSucceeded)" strokeWidth={3} name="Succeeded" activeDot={{ r: 5 }}>
                  <LabelList dataKey="succeeded" position="top" fill="var(--color-text-primary)" fontSize={11} />
                </Area>
                <Area type="monotone" dataKey="failed" stroke="var(--color-rose)" fill="url(#gradFailed)" strokeWidth={3} name="Failed" activeDot={{ r: 5 }}>
                  <LabelList dataKey="failed" position="top" fill="var(--color-text-primary)" fontSize={11} />
                </Area>
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <NoData />
          )}
        </div>

        {/* Pie chart */}
        <div className="card">
          <div style={{ marginBottom: 20 }}>
            <div className="table-title">Payment Distribution</div>
            <div className="table-subtitle">By status</div>
          </div>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) => [v, '']}
                  contentStyle={{
                    background: 'var(--color-bg-elevated)',
                    border: '1px solid var(--color-border-bright)',
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                />
                <Legend
                  formatter={(v) => {
                    const count = pieData.find((item) => item.name === v)?.value ?? 0;
                    return <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>{v}: {count}</span>;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <NoData />
          )}
        </div>
      </div>

      {/* ─── Event type bar chart ─────────────── */}
      {eventTypeData.length > 0 && (
        <div className="card mb-8">
          <div style={{ marginBottom: 20 }}>
            <div className="table-title">Webhook Event Types</div>
            <div className="table-subtitle">Count by gateway event type</div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={eventTypeData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Events" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="count" position="top" fill="var(--color-text-primary)" fontSize={12} />
                {eventTypeData.map((_, i) => (
                  <Cell key={i} fill={['var(--color-primary)', 'var(--color-emerald)', 'var(--color-rose)', 'var(--color-cyan)'][i % 4]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ─── Recent activity ──────────────────── */}
      <div className="chart-section">
        {/* Recent payments */}
        <div className="table-container">
          <div className="table-header-row">
            <div>
              <div className="table-title">Recent Payments</div>
              <div className="table-subtitle">Latest 5 transactions</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/payments')}>
              View all
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Amount</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {payItems.slice(0, 5).map((p) => (
                <tr key={p.id} onClick={() => navigate('/payments')}>
                  <td>
                    <span className="amount">{formatAmount(p.amountMinor, p.currency)}</span>
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="text-muted text-sm">{timeAgo(p.createdAt)}</td>
                </tr>
              ))}
              {payItems.length === 0 && (
                <tr><td colSpan={3}><NoData small /></td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Recent audit */}
        <div className="table-container">
          <div className="table-header-row">
            <div>
              <div className="table-title">Audit Trail</div>
              <div className="table-subtitle">Latest system events</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/audit')}>
              View all
            </button>
          </div>
          <div style={{ padding: '0 4px' }}>
            {auditItems.slice(0, 5).map((a) => (
              <div key={a.id} className="audit-item">
                <div className="audit-icon">
                  <Activity />
                </div>
                <div>
                  <div className="audit-action">{a.action}</div>
                  <div className="audit-meta">
                    {a.actor} · {timeAgo(a.created_at)}
                  </div>
                </div>
              </div>
            ))}
            {auditItems.length === 0 && <NoData small />}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, accent, iconBg,
}: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; accent: string; iconBg: string;
}) {
  return (
    <div className="stat-card" style={{ '--accent-color': accent, '--icon-bg': iconBg } as React.CSSProperties}>
      <div className="stat-card-icon">
        <Icon />
      </div>
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
      {sub && <div className="stat-card-sub">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = {
    PENDING:   'badge badge-pending',
    SUCCEEDED: 'badge badge-succeeded',
    FAILED:    'badge badge-failed',
    REFUNDED:  'badge badge-refunded',
  }[status] ?? 'badge';
  return <span className={cls}><span className="dot" />{status}</span>;
}

function NoData({ small }: { small?: boolean }) {
  if (small) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
        No data yet
      </div>
    );
  }
  return (
    <div className="empty-state" style={{ padding: '40px' }}>
      <Activity />
      <h3>No data yet</h3>
      <p>Run the gateway to generate some payments</p>
    </div>
  );
}
