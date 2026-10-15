// ─────────────────────────────────────────────
// Application shell: sidebar + topbar
// ─────────────────────────────────────────────

import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CreditCard, Webhook, ScrollText, Activity, Search, Bell, LogOut, Zap, FlaskConical, WifiOff
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useSSE } from '../hooks/useSSE';

interface NavItemDef {
  to: string;
  icon: React.ElementType;
  label: string;
  badge?: string;
}

const NAV_ITEMS: NavItemDef[] = [
  { to: '/',         icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/testing',  icon: FlaskConical,    label: 'Payment Testing', badge: 'Live' },
  { to: '/payments', icon: CreditCard,      label: 'Payments' },
  { to: '/events',   icon: Webhook,         label: 'Events' },
  { to: '/audit',    icon: ScrollText,      label: 'Audit Log' },
];

function LiveStatus({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) {
  if (status === 'connected') {
    return (
      <div className="live-indicator">
        <span className="live-dot" />
        LIVE
      </div>
    );
  }
  if (status === 'connecting') {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-amber)', textTransform: 'uppercase' }}>
        <Activity size={12} style={{ animation: 'spin 1s linear infinite' }} />
        Connecting
      </div>
    );
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-rose)', textTransform: 'uppercase' }}>
      <WifiOff size={12} />
      Offline
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { success } = useToast();
  const navigate = useNavigate();
  const sseStatus = useSSE();

  const handleLogout = async () => {
    await logout();
    success('Signed out', 'See you next time!');
    navigate('/login');
  };

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : '??';

  return (
    <div className="app-layout">
      {/* Decorative glow orbs */}
      <div className="glow-orb glow-1" />
      <div className="glow-orb glow-2" />

      {/* ─── Topbar ──────────────────────────── */}
      <header className="topbar">
        <div className="topbar-left">
          <NavLink to="/" className="logo" style={{ textDecoration: 'none' }}>
            <div className="logo-icon">
              <Zap size={16} color="white" strokeWidth={2.5} />
            </div>
            <span>
              <span className="logo-text-pay">Pay</span>
              <span className="logo-text-recon">Recon</span>
            </span>
          </NavLink>

          <div className="topbar-divider" />

          <div className="topbar-search">
            <Search className="icon" />
            <input className="input" placeholder="Search payments, events…" />
          </div>
        </div>

        <div className="topbar-right">
          <LiveStatus status={sseStatus} />

          <button className="notif-btn" title="Notifications">
            <Bell size={15} />
            <span className="notif-dot" />
          </button>

          <div className="user-menu" onClick={handleLogout} title="Sign out">
            <div className="user-avatar">{initials}</div>
            <div className="user-info">
              <span className="user-name">{user?.email?.split('@')[0]}</span>
              <span className="user-role">{user?.role}</span>
            </div>
            <LogOut size={13} color="var(--color-text-muted)" />
          </div>
        </div>
      </header>

      {/* ─── Sidebar ─────────────────────────── */}
      <aside className="sidebar">
        <div className="nav-section">
          <div className="nav-section-label">Navigation</div>
          {NAV_ITEMS.map(({ to, icon: Icon, label, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              style={{ textDecoration: 'none' }}
            >
              <Icon />
              {label}
              {badge && <span className="nav-badge">{badge}</span>}
            </NavLink>
          ))}
        </div>

        <div style={{ marginTop: 'auto', padding: '0 16px 8px' }}>
          <div className="nav-section-label" style={{ marginBottom: 8, paddingTop: 16 }}>Session</div>
          <div style={{
            padding: '12px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(99,102,241,0.06)',
            border: '1px solid var(--color-border)',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>Signed in as</div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
              {user?.email}
            </div>
            <div className={`badge badge-${user?.role?.toLowerCase()}`}>{user?.role}</div>
          </div>
        </div>
      </aside>

      {/* ─── Main Content ────────────────────── */}
      <main className="main-content" style={{ position: 'relative', zIndex: 1 }}>
        {children}
      </main>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
