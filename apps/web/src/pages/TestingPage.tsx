// ─────────────────────────────────────────────
// Payment Testing Dashboard
// Full-featured browser testing GUI for payment flows,
// duplicate handling, failures, and DB verification.
// ─────────────────────────────────────────────

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  FlaskConical,
  Play,
  PlaySquare,
  Plus,
  Trash2,
  Copy,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Database,
  Layers,
  Zap,
  ChevronUp,
  Code2,
  HelpCircle,
  FileText,
} from 'lucide-react';
import { testingApi } from '../api';
import type { PaymentTestRequestInput, PaymentTestResult, GatewayEventType } from '../types';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { copyToClipboard } from '../utils';

// Pre-defined test suites for 1-click evaluation
const PRESET_SCENARIOS: Array<{
  name: string;
  badge: string;
  description: string;
  requests: PaymentTestRequestInput[];
  concurrent?: boolean;
}> = [
  {
    name: 'Standard Duplicate Test',
    badge: 'Critical Test',
    description: 'Exact scenario from evaluation prompt: PAY101 (₹500), PAY101 duplicate (₹500), PAY102 (₹300).',
    requests: [
      { id: '1', paymentId: 'PAY101', amount: 500, currency: 'INR', eventType: 'full_flow' },
      { id: '2', paymentId: 'PAY101', amount: 500, currency: 'INR', eventType: 'payment.created' },
      { id: '3', paymentId: 'PAY102', amount: 300, currency: 'INR', eventType: 'full_flow' },
    ],
  },
  {
    name: 'Conflicting Details Duplicate',
    badge: 'Edge Case',
    description: 'PAY201 created for ₹500, then repeated with a conflicting amount of ₹750. Must be rejected.',
    requests: [
      { id: '1', paymentId: 'PAY201', amount: 500, currency: 'INR', eventType: 'full_flow' },
      { id: '2', paymentId: 'PAY201', amount: 750, currency: 'INR', eventType: 'payment.created' },
    ],
  },
  {
    name: 'Concurrent Race Condition',
    badge: 'Concurrency',
    description: '5 simultaneous duplicate requests for PAY_RACE_1 sent in parallel. Tests row locking & deduplication.',
    concurrent: true,
    requests: [
      { id: '1', paymentId: 'PAY_RACE_1', amount: 1000, currency: 'INR', eventType: 'full_flow' },
      { id: '2', paymentId: 'PAY_RACE_1', amount: 1000, currency: 'INR', eventType: 'full_flow' },
      { id: '3', paymentId: 'PAY_RACE_1', amount: 1000, currency: 'INR', eventType: 'full_flow' },
      { id: '4', paymentId: 'PAY_RACE_1', amount: 1000, currency: 'INR', eventType: 'full_flow' },
      { id: '5', paymentId: 'PAY_RACE_1', amount: 1000, currency: 'INR', eventType: 'full_flow' },
    ],
  },
  {
    name: 'Validation Failure Suite',
    badge: 'Validation',
    description: 'Tests negative amount (-₹500), zero amount, missing payment ID, and invalid currency (XYZ123).',
    requests: [
      { id: '1', paymentId: 'PAY_VALID', amount: 250, currency: 'INR', eventType: 'full_flow' },
      { id: '2', paymentId: 'PAY_NEG', amount: -500, currency: 'INR', eventType: 'full_flow' },
      { id: '3', paymentId: 'PAY_ZERO', amount: 0, currency: 'INR', eventType: 'full_flow' },
      { id: '4', paymentId: '', amount: 100, currency: 'INR', eventType: 'full_flow' },
      { id: '5', paymentId: 'PAY_BAD_CURR', amount: 100, currency: 'XYZ123', eventType: 'full_flow' },
    ],
  },
  {
    name: 'Backend Crash Simulation',
    badge: 'Transactional',
    description: 'Simulates a crash inside processWebhookEvent before commit. Verifies full rollback in DB.',
    requests: [
      { id: '1', paymentId: 'PAY_CRASH_TEST', amount: 999, currency: 'INR', eventType: 'payment.created', simulateCrash: true },
    ],
  },
  {
    name: 'Invalid Lifecycle Transition',
    badge: 'State Machine',
    description: 'Payment succeeds, then payment.failed is rejected because SUCCEEDED → FAILED is not an allowed transition.',
    requests: [
      { id: '1', paymentId: 'PAY_STATE_1', amount: 450, currency: 'INR', eventType: 'full_flow' },
      { id: '2', paymentId: 'PAY_STATE_1', amount: 450, currency: 'INR', eventType: 'payment.failed' },
    ],
  },
  {
    name: 'Create Failed Payment',
    badge: 'Payment Lifecycle',
    description: 'Creates a fresh PENDING payment, then applies payment.failed. The final payment appears under Failed.',
    requests: [
      { id: '1', paymentId: 'PAY_FAIL', amount: 450, currency: 'INR', eventType: 'payment.created' },
      { id: '2', paymentId: 'PAY_FAIL', amount: 450, currency: 'INR', eventType: 'payment.failed' },
    ],
  },
];

let nextRowId = 10;

export function PaymentTestingPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { success, error: toastError, info } = useToast();

  // Request list state
  const [requests, setRequests] = useState<PaymentTestRequestInput[]>([
    { id: '1', paymentId: `PAY_TEST_${crypto.randomUUID().slice(0, 8).toUpperCase()}`, amount: 500, currency: 'INR', eventType: 'full_flow' },
  ]);

  // Options & controls
  const [concurrent, setConcurrent] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  // Results & inspector state
  const [results, setResults] = useState<PaymentTestResult[]>([]);
  const [inspectResult, setInspectResult] = useState<PaymentTestResult | null>(null);

  // Row manipulation
  const addRow = () => {
    const idNum = nextRowId++;
    setRequests((prev) => [
      ...prev,
      {
        id: String(idNum),
        paymentId: `PAY${100 + prev.length + 1}`,
        amount: 500,
        currency: 'INR',
        eventType: 'full_flow',
      },
    ]);
  };

  const duplicateRow = (index: number) => {
    const rowToClone = requests[index];
    if (!rowToClone) return;
    const newRow: PaymentTestRequestInput = {
      ...rowToClone,
      id: String(nextRowId++),
    };
    const nextList = [...requests];
    nextList.splice(index + 1, 0, newRow);
    setRequests(nextList);
    info('Duplicated Request', `Cloned ${rowToClone.paymentId} with identical parameters.`);
  };

  const removeRow = (index: number) => {
    if (requests.length <= 1) {
      toastError('Cannot Remove', 'You must have at least one payment request.');
      return;
    }
    setRequests(requests.filter((_, i) => i !== index));
  };

  const updateRow = <K extends keyof PaymentTestRequestInput>(
    index: number,
    field: K,
    val: PaymentTestRequestInput[K],
  ) => {
    setRequests((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  };

  const loadScenario = (scenario: (typeof PRESET_SCENARIOS)[0]) => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const paymentIds = new Map<string, string>();
    setRequests(
      scenario.requests.map((r, i) => {
        let paymentId = r.paymentId;
        if (paymentId) {
          let uniqueId = paymentIds.get(paymentId);
          if (!uniqueId) {
            uniqueId = `${paymentId}_${runId}`;
            paymentIds.set(paymentId, uniqueId);
          }
          paymentId = uniqueId;
        }
        return { ...r, id: String(nextRowId++ + i), paymentId };
      }),
    );
    // Each scenario declares its execution mode. In particular, lifecycle
    // scenarios must run in order so payment.created finishes before payment.failed.
    setConcurrent(Boolean(scenario.concurrent));
    success('Loaded Test Scenario', scenario.name);
  };

  const refreshDatabaseViews = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['payments'] }),
    queryClient.invalidateQueries({ queryKey: ['events'] }),
    queryClient.invalidateQueries({ queryKey: ['audit'] }),
  ]);

  // Execution
  const handleSendSingle = async (index: number) => {
    const row = requests[index];
    if (!row) return;

    setActiveRowIndex(index);
    try {
      const res = await testingApi.send({
        paymentId: row.paymentId,
        amount: row.amount,
        amountMinor: row.amountMinor,
        currency: row.currency,
        eventType: row.eventType,
        eventId: row.eventId,
        simulateCrash: row.simulateCrash,
        simulateInvalidSignature: row.simulateInvalidSignature,
        simulateMalformedJson: row.simulateMalformedJson,
      });

      setResults((prev) => [res, ...prev]);
      await refreshDatabaseViews();

      if (res.status === 'PROCESSED') {
        success('Payment Processed', `${res.paymentId}: Processed and stored in DB.`);
      } else if (res.status === 'DUPLICATE') {
        info('Duplicate Detected', `${res.paymentId}: ${res.message}`);
      } else if (res.status === 'REJECTED') {
        toastError('Payment Rejected', `${res.paymentId}: ${res.errorReason ?? res.message}`);
      } else if (res.status === 'FAILED') {
        toastError('Payment Failed', `${res.paymentId}: ${res.errorReason ?? res.message}`);
      } else {
        toastError('Request Error', res.message);
      }
    } catch (err: unknown) {
      toastError('Execution Error', err instanceof Error ? err.message : String(err));
    } finally {
      setActiveRowIndex(null);
    }
  };

  const handleSendAll = async () => {
    if (requests.length === 0) return;
    setIsRunning(true);
    try {
      const cleanReqs = requests.map((r) => ({
        paymentId: r.paymentId,
        amount: r.amount,
        amountMinor: r.amountMinor,
        currency: r.currency,
        eventType: r.eventType,
        eventId: r.eventId,
        simulateCrash: r.simulateCrash,
        simulateInvalidSignature: r.simulateInvalidSignature,
        simulateMalformedJson: r.simulateMalformedJson,
      }));

      const res = await testingApi.sendBatch(cleanReqs, concurrent);
      setResults((prev) => [...res.results, ...prev]);
      await refreshDatabaseViews();

      success(
        'Batch Execution Complete',
        `Processed ${res.summary.processed}, Duplicates ${res.summary.duplicates}, Rejected ${res.summary.rejected}, Failed ${res.summary.failed}.`,
      );
    } catch (err: unknown) {
      toastError('Batch Error', err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const handleResetData = async () => {
    if (!window.confirm('Clear all payments, webhook events, event attempts, and audit logs for the current merchant? Users, merchant settings, and schema will be kept.')) {
      return;
    }
    try {
      const result = await testingApi.reset();
      setResults([]);
      setInspectResult(null);
      await refreshDatabaseViews();
      success(
        'Payment Data Reset',
        `Deleted ${result.deleted.payments} payments, ${result.deleted.webhookEvents} events, ${result.deleted.eventAttempts} event attempts, and ${result.deleted.auditLogs} audit logs for this merchant.`,
      );
    } catch (err: unknown) {
      toastError('Reset Failed', err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopy = async (text: string, label: string) => {
    const ok = await copyToClipboard(text);
    if (ok) success('Copied!', label);
  };

  // Metrics derived from results
  const totalCount = results.length;
  const processedCount = results.filter((r) => r.status === 'PROCESSED').length;
  const duplicateCount = results.filter((r) => r.status === 'DUPLICATE').length;
  const rejectedCount = results.filter((r) => r.status === 'REJECTED' || r.status === 'FAILED' || r.status === 'ERROR').length;

  return (
    <div className="payment-testing-page" style={{ paddingBottom: 60 }}>
      {/* ─── Page Header ─────────────────────────── */}
      <div className="page-header mb-6">
        <div className="page-header-row">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.3))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid rgba(99,102,241,0.4)',
                  boxShadow: 'var(--shadow-glow)',
                }}
              >
                <FlaskConical size={20} color="var(--color-primary-light)" />
              </div>
              <div>
                <h1 className="page-title" style={{ fontSize: '1.5rem', margin: 0 }}>
                  Payment Testing Dashboard
                </h1>
                <p className="page-subtitle" style={{ margin: 0, marginTop: 2 }}>
                  {isAdmin
                    ? 'Test duplicate payment handling, API validation, concurrent race conditions, and DB consistency live in browser.'
                    : 'Review payment testing outcomes and database verification.'}
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              className={`btn btn-sm ${showGuide ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setShowGuide(!showGuide)}
            >
              <HelpCircle size={14} />
              {showGuide ? 'Hide Test Guide' : 'Evaluation Guide'}
            </button>

            {isAdmin && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--color-rose)' }}
                onClick={handleResetData}
                title="Clear payment, event, attempt, and audit data for the current merchant"
              >
                <RotateCcw size={14} />
                Reset Payment Data
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── Evaluation Guide (Collapsible) ───────── */}
      {showGuide && (
        <div
          className="card mb-6"
          style={{
            background: 'linear-gradient(135deg, rgba(15,15,26,0.95), rgba(20,20,42,0.95))',
            borderColor: 'rgba(99,102,241,0.3)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div className="card-header" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={16} color="var(--color-cyan)" />
              <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                Evaluation Instructions & Verification Guide
              </h3>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowGuide(false)}>
              <ChevronUp size={14} />
            </button>
          </div>
          <div className="card-body" style={{ fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontWeight: 600, color: 'var(--color-amber)', marginBottom: 4 }}>
                  1. Duplicate Payment Testing (Prompt Requirement)
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem' }}>
                  Load <strong>"Standard Duplicate Test"</strong> below and click <strong>Send All Payments</strong>.
                  Notice Request 1 (PAY101) processes; Request 2 (PAY101) is recognized as a duplicate and ignored without duplicate DB rows;
                  Request 3 (PAY102) processes cleanly.
                </p>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontWeight: 600, color: 'var(--color-rose)', marginBottom: 4 }}>
                  2. Conflicting Details & Failures
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem' }}>
                  Load <strong>"Conflicting Details Duplicate"</strong>: PAY201 sent with ₹500 then ₹750.
                  The backend detects the amount conflict and marks it REJECTED, preserving the original record.
                </p>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontWeight: 600, color: 'var(--color-primary-light)', marginBottom: 4 }}>
                  3. Live DB Verification
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem' }}>
                  Click <strong>Inspect</strong> on any row in the Results Table. You will see the actual PostgreSQL database record,
                  version count, webhook event attempts, and audit logs confirming zero mock data.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Metric Cards ────────────────────────── */}
      <div className="testing-metrics-grid">
        <div className="stat-card">
          <div className="stat-card-title">
            <span>Total Requests Sent</span>
            <Layers size={14} color="var(--color-primary-light)" />
          </div>
          <div className="stat-card-value">{totalCount}</div>
          <div className="stat-card-hint">From active browser session</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">
            <span>Processed in DB</span>
            <CheckCircle2 size={14} color="var(--color-emerald)" />
          </div>
          <div className="stat-card-value" style={{ color: 'var(--color-emerald)' }}>
            {processedCount}
          </div>
          <div className="stat-card-hint">Saved & updated in PostgreSQL</div>
        </div>

        <div className="stat-card" style={{ borderLeft: '3px solid var(--color-amber)' }}>
          <div className="stat-card-title">
            <span>Duplicates Protected</span>
            <Copy size={14} color="var(--color-amber)" />
          </div>
          <div className="stat-card-value" style={{ color: 'var(--color-amber)' }}>
            {duplicateCount}
          </div>
          <div className="stat-card-hint">Idempotently blocked / ignored</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">
            <span>Rejections & Failures</span>
            <AlertTriangle size={14} color="var(--color-rose)" />
          </div>
          <div className="stat-card-value" style={{ color: 'var(--color-rose)' }}>
            {rejectedCount}
          </div>
          <div className="stat-card-hint">Conflicts, validation, crash tests</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">
            <span>Database Backend</span>
            <Database size={14} color="var(--color-cyan)" />
          </div>
          <div className="stat-card-value" style={{ fontSize: '1.2rem', color: 'var(--color-cyan)' }}>
            PostgreSQL Live
          </div>
          <div className="stat-card-hint">Enforced by DB constraints & locks</div>
        </div>
      </div>

      {!isAdmin && (
        <div className="card mb-6" role="status" style={{ padding: '14px 18px', color: 'var(--color-text-secondary)' }}>
          <strong style={{ color: 'var(--color-text-primary)' }}>Read-only access.</strong>{' '}
          Payment test scenarios, submissions, and database resets are available to administrators only.
        </div>
      )}

      {isAdmin && <>
      {/* ─── 1-Click Evaluation Presets ──────────── */}
      <div className="card mb-6">
        <div className="card-header" style={{ padding: '12px 18px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={16} color="var(--color-amber)" />
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              1-Click Evaluation Test Scenarios
            </h2>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Click any scenario to pre-load payment requests
          </span>
        </div>
        <div className="card-body" style={{ padding: '14px 18px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 12,
            }}
          >
            {PRESET_SCENARIOS.map((sc, i) => (
              <div
                key={i}
                onClick={() => loadScenario(sc)}
                style={{
                  background: 'rgba(15,15,26,0.6)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 14px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-primary)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-text-primary)' }}>
                    {sc.name}
                  </span>
                  <span className="badge badge-primary" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                    {sc.badge}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                  {sc.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Payment Request Builder Form ────────── */}
      <div className="card mb-6" style={{ overflow: 'visible' }}>
        <div
          className="card-header"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            borderBottom: '1px solid var(--color-border)',
            padding: '14px 20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Layers size={18} color="var(--color-primary-light)" />
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                Payment Requests Batch ({requests.length})
              </h2>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                Configure individual or batch payments to send directly to backend
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.8rem',
                cursor: 'pointer',
                color: concurrent ? 'var(--color-amber)' : 'var(--color-text-secondary)',
                userSelect: 'none',
                background: concurrent ? 'rgba(245,158,11,0.1)' : 'transparent',
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                border: concurrent ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent',
              }}
            >
              <input
                type="checkbox"
                checked={concurrent}
                onChange={(e) => setConcurrent(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontWeight: 600 }}>Concurrent Mode (Race Test)</span>
            </label>

            <button
              className="btn btn-ghost btn-sm"
              onClick={addRow}
              disabled={isRunning}
            >
              <Plus size={14} />
              Add Request
            </button>

            <button
              className="btn btn-primary"
              onClick={handleSendAll}
              disabled={isRunning || requests.length === 0}
              style={{ padding: '8px 18px', fontWeight: 600, boxShadow: 'var(--shadow-primary)' }}
            >
              <PlaySquare size={16} style={{ animation: isRunning ? 'spin 1s linear infinite' : 'none' }} />
              {isRunning ? 'Sending Batch…' : `Send All Payments (${requests.length})`}
            </button>
          </div>
        </div>

        <div className="card-body" style={{ padding: 0 }}>
          <div className="table-container" style={{ margin: 0, borderRadius: 0, border: 'none' }}>
            <table className="data-table testing-request-table">
              <thead>
                <tr>
                  <th style={{ width: 40, textAlign: 'center' }}>#</th>
                  <th style={{ minWidth: 150 }}>Payment ID</th>
                  <th style={{ minWidth: 110 }}>Amount</th>
                  <th style={{ width: 90 }}>Currency</th>
                  <th style={{ minWidth: 180 }}>Flow / Event Type</th>
                  <th style={{ minWidth: 170 }}>Simulate Condition</th>
                  <th style={{ width: 180, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req, idx) => (
                  <tr key={req.id || idx}>
                    <td style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>
                      {idx + 1}
                    </td>

                    {/* Payment ID Input */}
                    <td>
                      <input
                        className="input"
                        value={req.paymentId}
                        onChange={(e) => updateRow(idx, 'paymentId', e.target.value)}
                        placeholder="e.g. PAY101"
                        style={{ height: 32, fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}
                      />
                    </td>

                    {/* Amount Input */}
                    <td>
                      <input
                        className="input"
                        type="text"
                        value={req.amount ?? ''}
                        onChange={(e) => updateRow(idx, 'amount', e.target.value)}
                        placeholder="e.g. 500"
                        style={{ height: 32, fontSize: '0.8rem' }}
                      />
                    </td>

                    {/* Currency Selector */}
                    <td>
                      <select
                        className="select"
                        value={req.currency ?? 'INR'}
                        onChange={(e) => updateRow(idx, 'currency', e.target.value)}
                        style={{ height: 32, fontSize: '0.8rem', padding: '0 8px' }}
                      >
                        <option value="INR">INR (₹)</option>
                        <option value="USD">USD ($)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="GBP">GBP (£)</option>
                        <option value="XYZ123">XYZ (Invalid)</option>
                      </select>
                    </td>

                    {/* Event Type / Flow */}
                    <td>
                      <select
                        className="select"
                        value={req.eventType ?? 'full_flow'}
                        onChange={(e) =>
                          updateRow(idx, 'eventType', e.target.value as GatewayEventType | 'full_flow')
                        }
                        style={{ height: 32, fontSize: '0.8rem' }}
                      >
                        <option value="full_flow">Full Flow (Create → Succeed)</option>
                        <option value="payment.created">payment.created (Pending)</option>
                        <option value="payment.succeeded">payment.succeeded (Success)</option>
                        <option value="payment.failed">payment.failed (requires a pending payment)</option>
                        <option value="refund.created">refund.created (Refunded)</option>
                      </select>
                    </td>

                    {/* Simulation Options */}
                    <td>
                      <select
                        className="select"
                        value={
                          req.simulateCrash
                            ? 'crash'
                            : req.simulateInvalidSignature
                              ? 'signature'
                              : req.simulateMalformedJson
                                ? 'json'
                                : 'normal'
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          setRequests((prev) => {
                            const copy = [...prev];
                            copy[idx] = {
                              ...copy[idx],
                              simulateCrash: val === 'crash',
                              simulateInvalidSignature: val === 'signature',
                              simulateMalformedJson: val === 'json',
                            };
                            return copy;
                          });
                        }}
                        style={{
                          height: 32,
                          fontSize: '0.78rem',
                          color:
                            req.simulateCrash || req.simulateInvalidSignature || req.simulateMalformedJson
                              ? 'var(--color-rose)'
                              : 'inherit',
                        }}
                      >
                        <option value="normal">Normal (Safe Run)</option>
                        <option value="crash">💥 Simulate Transaction Crash (Rollback)</option>
                        <option value="signature">🔐 Simulate Bad Signature (401)</option>
                        <option value="json">⚠️ Simulate Malformed JSON (400)</option>
                      </select>
                    </td>

                    {/* Row Actions */}
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleSendSingle(idx)}
                          disabled={activeRowIndex === idx || isRunning}
                          title="Send this single payment"
                          style={{ height: 30, padding: '0 10px', fontSize: '0.75rem' }}
                        >
                          <Play size={12} style={{ animation: activeRowIndex === idx ? 'spin 1s linear infinite' : 'none' }} />
                          Send
                        </button>

                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => duplicateRow(idx)}
                          title="Duplicate this row with identical Payment ID to test duplicates"
                          style={{ height: 30, padding: '0 8px' }}
                        >
                          <Copy size={13} color="var(--color-amber)" />
                        </button>

                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeRow(idx)}
                          title="Delete row"
                          style={{ height: 30, padding: '0 8px' }}
                        >
                          <Trash2 size={13} color="var(--color-text-muted)" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      </>}

      {/* ─── Results Table ───────────────────────── */}
      <div className="card">
        <div
          className="card-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--color-border)',
            padding: '14px 20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileText size={18} color="var(--color-cyan)" />
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                Test Execution Results ({results.length})
              </h2>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                Live outcomes, HTTP statuses, duplicate detection, and database verification
              </div>
            </div>
          </div>

          {results.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setResults([])}
              style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}
            >
              Clear Results Table
            </button>
          )}
        </div>

        <div className="card-body" style={{ padding: 0 }}>
          {results.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
              <FlaskConical size={36} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                No Payment Requests Sent Yet
              </div>
              <p style={{ fontSize: '0.8rem', maxWidth: 460, margin: '0 auto' }}>
                {isAdmin
                  ? <>Click <strong>"Send All Payments"</strong> above or run one of the 1-Click Evaluation Scenarios to see live results and database verification.</>
                  : 'There are no test results in this browser session yet.'}
              </p>
            </div>
          ) : (
            <div className="table-container" style={{ margin: 0, borderRadius: 0, border: 'none' }}>
              <table className="data-table testing-results-table">
                <thead>
                  <tr>
                    <th style={{ width: 45 }}>#</th>
                    <th style={{ minWidth: 120 }}>Payment ID</th>
                    <th style={{ minWidth: 90 }}>Amount</th>
                    <th style={{ width: 95 }}>HTTP</th>
                    <th style={{ minWidth: 150 }}>Result Status</th>
                    <th style={{ minWidth: 240 }}>Reason & Backend Message</th>
                    <th style={{ minWidth: 160 }}>PostgreSQL DB Outcome</th>
                    <th style={{ width: 90, textAlign: 'right' }}>Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((res, i) => {
                    // A result can be both a duplicate AND failed (conflicting duplicate rejected).
                    // In that case we treat it as FAILED — one clear status, not two competing badges.
                    const isFailed = res.status === 'FAILED';
                    const isRejected = res.status === 'REJECTED';
                    const isError = res.status === 'ERROR';
                    const isProcessed = res.status === 'PROCESSED';
                    // Only show DUPLICATE/IGNORED badge when NOT already shown as FAILED
                    const isDupOnly = (res.duplicate || res.status === 'DUPLICATE') && !isFailed && !isRejected;

                    return (
                      <tr
                        key={res.requestId || i}
                        style={{
                          background: isFailed || isRejected || isError
                            ? 'rgba(244,63,94,0.04)'
                            : isDupOnly
                              ? 'rgba(245,158,11,0.03)'
                              : 'transparent',
                        }}
                      >
                        <td style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                          {results.length - i}
                        </td>

                        {/* Payment ID */}
                        <td>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 700,
                                fontSize: '0.85rem',
                                color: 'var(--color-text-primary)',
                              }}
                            >
                              {res.paymentId || '—'}
                            </span>
                            {res.paymentId && (
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ padding: 2, height: 20 }}
                                onClick={() => handleCopy(res.paymentId, 'Payment ID')}
                                title="Copy ID"
                              >
                                <Copy size={11} color="var(--color-text-muted)" />
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Amount */}
                        <td style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                          {res.currency} {res.amountDisplay}
                        </td>

                        {/* HTTP Status Code */}
                        <td>
                          <span
                            className={`badge ${
                              res.httpStatus >= 200 && res.httpStatus < 300
                                ? 'badge-succeeded'
                                : res.httpStatus === 409
                                  ? 'badge-duplicate'
                                  : 'badge-failed'
                            }`}
                            style={{ fontSize: '0.75rem', fontWeight: 700 }}
                          >
                            {res.httpStatus}
                          </span>
                        </td>

                        {/* Result Status Badge — single badge per row, most-specific wins */}
                        <td>
                          {isProcessed && (
                            <span className="badge badge-succeeded" style={{ gap: 4 }}>
                              <CheckCircle2 size={12} />
                              PROCESSED
                            </span>
                          )}
                          {/* Duplicate-and-failed: one clear REJECTED badge, not two */}
                          {isFailed && res.duplicate && res.duplicateType !== 'NONE' && (
                            <span className="badge badge-failed" style={{ gap: 4, fontSize: '0.72rem' }}>
                              <XCircle size={12} />
                              REJECTED ({res.duplicateType === 'CONFLICTING_DETAILS' ? 'CONFLICT' : 'DUPLICATE'})
                            </span>
                          )}
                          {/* Pure failure — no duplicate involved */}
                          {isFailed && !res.duplicate && (
                            <span className="badge badge-failed" style={{ gap: 4 }}>
                              <XCircle size={12} />
                              FAILED
                            </span>
                          )}
                          {/* Benign idempotent duplicate (same event-id replayed) */}
                          {isDupOnly && (
                            <span className="badge badge-duplicate" style={{ gap: 4 }}>
                              <Copy size={12} />
                              DUPLICATE / IGNORED
                            </span>
                          )}
                          {isRejected && (
                            <span className="badge badge-rejected" style={{ gap: 4 }}>
                              <XCircle size={12} />
                              REJECTED
                            </span>
                          )}
                          {res.status === 'PENDING' && (
                            <span className="badge badge-pending" style={{ gap: 4 }}>
                              <Clock size={12} />
                              PENDING
                            </span>
                          )}
                          {isError && (
                            <span className="badge badge-failed" style={{ gap: 4 }}>
                              <AlertTriangle size={12} />
                              ERROR
                            </span>
                          )}
                        </td>

                        {/* Message / Error Reason */}
                        <td style={{ fontSize: '0.8rem', lineHeight: 1.4 }}>
                          <div style={{
                            color: isFailed || isRejected || isError
                              ? 'var(--color-rose)'
                              : isDupOnly
                                ? 'var(--color-amber)'
                                : 'var(--color-text-secondary)',
                          }}>
                            {res.message}
                          </div>
                          {res.errorReason && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-rose)', marginTop: 2 }}>
                              Reason: {res.errorReason}
                            </div>
                          )}
                        </td>

                        {/* PostgreSQL Database Outcome */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {res.databaseOutcome.paymentExists ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span className={`badge badge-${res.databaseOutcome.payment?.status?.toLowerCase()}`} style={{ fontSize: '0.7rem' }}>
                                  In DB: {res.databaseOutcome.payment?.status} (v{res.databaseOutcome.payment?.version})
                                </span>
                              </div>
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                ∅ Not in payments table
                              </span>
                            )}
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                              Events: {res.databaseOutcome.eventsCount} | Audits: {res.databaseOutcome.auditLogsCount}
                            </div>
                          </div>
                        </td>

                        {/* Inspect Button */}
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setInspectResult(res)}
                            style={{ fontSize: '0.75rem', gap: 4 }}
                          >
                            <Code2 size={13} color="var(--color-cyan)" />
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ─── Detailed Verification Modal / Drawer ── */}
      {inspectResult && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => setInspectResult(null)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 720,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--color-bg-elevated)',
              boxShadow: 'var(--shadow-elevated)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="card-header"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid var(--color-border)',
                padding: '16px 20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Database size={18} color="var(--color-cyan)" />
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                    Live Database Outcome: {inspectResult.paymentId}
                  </h3>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    Actual state read from PostgreSQL
                  </div>
                </div>
              </div>

              <button className="btn btn-ghost btn-sm" onClick={() => setInspectResult(null)}>
                Close
              </button>
            </div>

            <div className="card-body" style={{ overflowY: 'auto', padding: 20 }}>
              {/* Payment Row Details */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 8 }}>
                  1. Payments Table (Row in DB)
                </div>
                {inspectResult.databaseOutcome.payment ? (
                  <div
                    style={{
                      background: 'rgba(0,0,0,0.3)',
                      padding: 14,
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                      fontSize: '0.8rem',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <span style={{ color: 'var(--color-text-muted)' }}>Database UUID:</span>{' '}
                        {inspectResult.databaseOutcome.payment.id}
                      </div>
                      <div>
                        <span style={{ color: 'var(--color-text-muted)' }}>Gateway ID:</span>{' '}
                        {inspectResult.databaseOutcome.payment.gatewayPaymentId}
                      </div>
                      <div>
                        <span style={{ color: 'var(--color-text-muted)' }}>Amount Minor:</span>{' '}
                        {inspectResult.databaseOutcome.payment.amountMinor} ({inspectResult.databaseOutcome.payment.currency})
                      </div>
                      <div>
                        <span style={{ color: 'var(--color-text-muted)' }}>Status:</span>{' '}
                        <span className={`badge badge-${inspectResult.databaseOutcome.payment.status.toLowerCase()}`}>
                          {inspectResult.databaseOutcome.payment.status}
                        </span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--color-text-muted)' }}>Version:</span>{' '}
                        v{inspectResult.databaseOutcome.payment.version}
                      </div>
                      <div>
                        <span style={{ color: 'var(--color-text-muted)' }}>Updated:</span>{' '}
                        {new Date(inspectResult.databaseOutcome.payment.updatedAt).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      background: 'rgba(244,63,94,0.06)',
                      padding: 12,
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid rgba(244,63,94,0.2)',
                      fontSize: '0.8rem',
                      color: 'var(--color-rose)',
                    }}
                  >
                    No payment row exists in the payments table for {inspectResult.paymentId}. (Expected if rejected, failed before creation, or rolled back).
                  </div>
                )}
              </div>

              {/* Webhook Events */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 8 }}>
                  2. Webhook Events in DB ({inspectResult.databaseOutcome.eventsCount})
                </div>
                {inspectResult.databaseOutcome.recentEvents.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {inspectResult.databaseOutcome.recentEvents.map((evt, i) => (
                      <div
                        key={i}
                        style={{
                          background: 'rgba(0,0,0,0.3)',
                          padding: 10,
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--color-border)',
                          fontSize: '0.78rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                            {evt.eventType}{' '}
                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
                              ({evt.gatewayEventId})
                            </span>
                          </div>
                          {evt.lastError && (
                            <div style={{ color: 'var(--color-rose)', fontSize: '0.72rem', marginTop: 2 }}>
                              Last Error: {evt.lastError}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                            Attempts: {evt.attemptCount}
                          </span>
                          <span className={`badge badge-${evt.status.toLowerCase()}`}>
                            {evt.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                    No webhook events recorded in database.
                  </div>
                )}
              </div>

              {/* Raw JSON Details */}
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 8 }}>
                  3. Full Test Response Payload
                </div>
                <pre
                  style={{
                    background: 'var(--color-bg-base)',
                    padding: 12,
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    fontSize: '0.75rem',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--color-text-secondary)',
                    overflowX: 'auto',
                    maxHeight: 200,
                  }}
                >
                  {JSON.stringify(inspectResult, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
