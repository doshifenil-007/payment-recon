// ─────────────────────────────────────────────
// Not Found page
// ─────────────────────────────────────────────

import { useNavigate } from 'react-router-dom';
import { Home, AlertTriangle } from 'lucide-react';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg-base)',
    }}>
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <AlertTriangle size={48} color="var(--color-amber)" style={{ marginBottom: 16 }} />
        <div style={{ fontSize: '5rem', fontWeight: 900, letterSpacing: '-0.05em', color: 'var(--color-border-bright)', lineHeight: 1 }}>
          404
        </div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)', margin: '16px 0 8px' }}>
          Page not found
        </h1>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 32 }}>
          The page you're looking for doesn't exist.
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          <Home size={14} />
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}
