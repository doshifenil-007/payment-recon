import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  eventEnvelopeSchema,
  type EventEnvelope,
  type GatewayEventType,
} from '@payment-recon/shared';
import { env } from '../../config/env';
import { pool } from '../../lib/db';
import { requireAuth, requireRole } from '../../middleware/auth';
import { ingestEvent } from '../webhooks/ingest-event';
import { signatureHeader } from '../webhooks/signature';

export const testingRouter = Router();
testingRouter.use(requireAuth);

export interface PaymentTestRequestInput {
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

/** Helper to query current DB state for a payment ID */
async function getDbOutcome(merchantId: string, paymentId: string) {
  const paymentRes = await pool.query<{
    id: string;
    gateway_payment_id: string;
    amount_minor: string;
    currency: string;
    status: string;
    version: number;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, gateway_payment_id, amount_minor, currency, status, version, created_at, updated_at
       FROM payments
      WHERE merchant_id = $1 AND gateway_payment_id = $2`,
    [merchantId, paymentId],
  );
  const paymentRow = paymentRes.rows[0];

  const eventsRes = await pool.query<{
    id: string;
    gateway_event_id: string;
    event_type: string;
    status: string;
    attempt_count: number;
    last_error: string | null;
    received_at: Date;
  }>(
    `SELECT id, gateway_event_id, event_type, status, attempt_count, last_error, received_at
       FROM webhook_events
      WHERE merchant_id = $1 AND payload->'data'->>'paymentId' = $2
      ORDER BY received_at DESC
      LIMIT 10`,
    [merchantId, paymentId],
  );

  const auditCountRes = await pool.query<{ count: string }>(
    `SELECT count(*)::text as count FROM audit_logs
      WHERE merchant_id = $1 AND (entity_id = $2 OR entity_id = $3)`,
    [merchantId, paymentRow?.id ?? '', paymentId],
  );

  return {
    paymentExists: !!paymentRow,
    payment: paymentRow
      ? {
          id: paymentRow.id,
          gatewayPaymentId: paymentRow.gateway_payment_id,
          amountMinor: paymentRow.amount_minor,
          currency: paymentRow.currency,
          status: paymentRow.status,
          version: paymentRow.version,
          createdAt: paymentRow.created_at.toISOString(),
          updatedAt: paymentRow.updated_at.toISOString(),
        }
      : null,
    eventsCount: eventsRes.rows.length,
    auditLogsCount: Number(auditCountRes.rows[0]?.count ?? 0),
    recentEvents: eventsRes.rows.map((e) => ({
      id: e.id,
      gatewayEventId: e.gateway_event_id,
      eventType: e.event_type,
      status: e.status,
      attemptCount: e.attempt_count,
      lastError: e.last_error,
      receivedAt: e.received_at.toISOString(),
    })),
  };
}

/** Processes a single test payment request against the real database and webhook logic */
async function executeTestPayment(
  input: PaymentTestRequestInput,
  merchantId: string,
  merchantGatewayId: string,
): Promise<PaymentTestResult> {
  const reqId = `req_${randomUUID().slice(0, 8)}`;
  const paymentId = (input.paymentId ?? '').trim();
  const currency = (input.currency ?? 'INR').trim().toUpperCase();
  const eventType = input.eventType ?? 'full_flow';

  // 1. Resolve amount and amountMinor
  let amountMinorStr: string;
  let amountDisplay: string;

  if (input.amountMinor !== undefined && input.amountMinor !== '') {
    amountMinorStr = String(input.amountMinor);
    const num = Number(amountMinorStr);
    amountDisplay = !isNaN(num) ? (num / 100).toFixed(2) : amountMinorStr;
  } else if (input.amount !== undefined && input.amount !== '') {
    const rawAmount = String(input.amount).trim();
    const num = Number(rawAmount);
    if (!isNaN(num)) {
      if (num < 0) {
        amountMinorStr = rawAmount; // Negative string e.g. "-500" to trigger schema rejection
        amountDisplay = rawAmount;
      } else {
        amountMinorStr = Math.round(num * 100).toString();
        amountDisplay = num.toFixed(2);
      }
    } else {
      amountMinorStr = rawAmount;
      amountDisplay = rawAmount;
    }
  } else {
    amountMinorStr = '';
    amountDisplay = '0.00';
  }

  // 2. Check DB state BEFORE executing
  const paymentBeforeRes = await pool.query<{
    id: string;
    status: string;
    amount_minor: string;
    currency: string;
    version: number;
  }>(
    `SELECT id, status, amount_minor, currency, version
       FROM payments
      WHERE merchant_id = $1 AND gateway_payment_id = $2`,
    [merchantId, paymentId],
  );
  const existingPaymentBefore = paymentBeforeRes.rows[0];

  const customEventId = input.eventId?.trim() || `evt_${randomUUID().slice(0, 10)}`;
  const existingEventBefore = input.eventId
    ? (
        await pool.query(
          `SELECT id, status, payload_hash FROM webhook_events
            WHERE gateway = 'mock' AND gateway_event_id = $1`,
          [input.eventId.trim()],
        )
      ).rows[0]
    : null;

  // 3. Simulation tests: Signature or Malformed JSON
  if (input.simulateInvalidSignature) {
    const dbOutcome = await getDbOutcome(merchantId, paymentId);
    return {
      requestId: reqId,
      paymentId,
      eventType: String(eventType),
      amountDisplay,
      amountMinor: amountMinorStr,
      currency,
      httpStatus: 401,
      status: 'REJECTED',
      duplicate: false,
      duplicateType: 'NONE',
      message: 'Webhook signature validation failed. Request rejected before database write.',
      errorReason: 'Invalid signature: x-gateway-signature mismatch',
      databaseOutcome: dbOutcome,
    };
  }

  if (input.simulateMalformedJson) {
    const dbOutcome = await getDbOutcome(merchantId, paymentId);
    return {
      requestId: reqId,
      paymentId,
      eventType: String(eventType),
      amountDisplay,
      amountMinor: amountMinorStr,
      currency,
      httpStatus: 400,
      status: 'ERROR',
      duplicate: false,
      duplicateType: 'NONE',
      message: 'Gateway payload malformed JSON. Permanently rejected with 400 Bad Request.',
      errorReason: 'Malformed JSON syntax',
      databaseOutcome: dbOutcome,
    };
  }

  // 4. Validate payload with Zod schema (same as real webhook router)
  const primaryEnvelope: EventEnvelope = {
    id: customEventId,
    type: eventType === 'full_flow' ? 'payment.created' : (eventType as GatewayEventType),
    merchantId: merchantGatewayId,
    data: {
      paymentId,
      amountMinor: amountMinorStr,
      currency,
    },
  };

  const parsed = eventEnvelopeSchema.safeParse(primaryEnvelope);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    const errorDetails = Object.entries(errors)
      .map(([k, v]) => `${k}: ${v?.join(', ')}`)
      .join('; ');
    const dbOutcome = await getDbOutcome(merchantId, paymentId);
    return {
      requestId: reqId,
      paymentId,
      eventType: String(eventType),
      amountDisplay,
      amountMinor: amountMinorStr,
      currency,
      httpStatus: 400,
      status: 'ERROR',
      duplicate: false,
      duplicateType: 'NONE',
      message: `Invalid payment payload: ${errorDetails || 'Validation failed'}`,
      errorReason: errorDetails || 'Schema validation failure',
      databaseOutcome: dbOutcome,
    };
  }

  // 5. Ingest event(s)
  try {
    const processOpts = input.simulateCrash
      ? {
          afterApply: async () => {
            throw new Error('Simulated backend failure before transaction commit');
          },
        }
      : {};

    let ingestRes = await ingestEvent(
      parsed.data,
      JSON.stringify(parsed.data),
      processOpts,
    );

    // If full flow requested, also ingest payment.succeeded
    if (eventType === 'full_flow' && ingestRes.status === 'PROCESSED' && !input.simulateCrash) {
      const succEnvelope: EventEnvelope = {
        id: `evt_succ_${randomUUID().slice(0, 10)}`,
        type: 'payment.succeeded',
        merchantId: merchantGatewayId,
        data: {
          paymentId,
          amountMinor: amountMinorStr,
          currency,
        },
      };
      ingestRes = await ingestEvent(succEnvelope, JSON.stringify(succEnvelope));
    }

    const dbOutcome = await getDbOutcome(merchantId, paymentId);

    // 6. Determine duplicate status & human-friendly messaging
    let status: PaymentTestResult['status'] = 'PROCESSED';
    let isDuplicate = false;
    let duplicateType: PaymentTestResult['duplicateType'] = 'NONE';
    let message = '';
    let errorReason: string | null = null;
    let httpStatus = ingestRes.status === 'FAILED' ? 202 : 200;

    if (existingEventBefore) {
      // Exact same event ID replayed → idempotent no-op (this is fine, counts as DUPLICATE)
      isDuplicate = true;
      duplicateType = 'EXACT_EVENT_DUPLICATE';
      status = 'DUPLICATE';
      message = `Exact duplicate event ID (${customEventId}) detected. Acknowledged idempotently; no duplicate side effects executed.`;
    } else if (existingPaymentBefore) {
      // A different event ID arrived for a payment that already exists in the DB
      if (primaryEnvelope.type === 'payment.created') {
        if (
          existingPaymentBefore.amount_minor === amountMinorStr &&
          existingPaymentBefore.currency === currency
        ) {
          // Same details — payment.created for an already-existing payment.
          // The DB engine silently ignores it (idempotent), but from a testing
          // perspective this request FAILED: you cannot create the same payment twice.
          isDuplicate = true;
          duplicateType = 'PAYMENT_ALREADY_EXISTS';
          status = 'FAILED';
          httpStatus = 409;
          errorReason = `Payment ID "${paymentId}" already exists in the database (status: ${existingPaymentBefore.status}). Duplicate payment.created was rejected.`;
          message = `FAILED: Payment ID "${paymentId}" already exists. The second request was rejected — you cannot create the same payment twice.`;
        } else {
          // Conflicting details — hard failure
          isDuplicate = true;
          duplicateType = 'CONFLICTING_DETAILS';
          status = 'FAILED';
          httpStatus = 409;
          errorReason = `payment.created conflicts with existing payment: submitted amount ${amountMinorStr} (${currency}) vs stored ${existingPaymentBefore.amount_minor} (${existingPaymentBefore.currency})`;
          message = `FAILED: Conflicting duplicate — Payment "${paymentId}" already exists with different amount/currency. Request rejected permanently.`;
        }
      } else if (ingestRes.status === 'REJECTED') {
        status = 'REJECTED';
        const lastErr = dbOutcome.recentEvents[0]?.lastError;
        errorReason = lastErr ?? 'Permanent rejection';
        message = `Transition rejected: ${lastErr ?? 'Invalid status transition'}`;
      } else {
        status = dbOutcome.payment?.status === 'SUCCEEDED' ? 'PROCESSED' : 'PENDING';
        message = `Event applied to existing payment ${paymentId}. Current status: ${dbOutcome.payment?.status}.`;
      }
    } else {
      // New payment
      if (input.simulateCrash) {
        status = 'FAILED';
        httpStatus = 202;
        errorReason = 'Simulated backend crash before transaction commit';
        message = 'Simulated crash: Transaction rolled back before commit. Database changes reverted.';
      } else if (ingestRes.status === 'FAILED') {
        status = 'FAILED';
        httpStatus = 202;
        const lastErr = dbOutcome.recentEvents[0]?.lastError;
        errorReason = lastErr ?? 'Processing failed (queued for retry)';
        message = `Processing failed: ${errorReason}. Backoff timer scheduled for background worker.`;
      } else if (ingestRes.status === 'REJECTED') {
        status = 'REJECTED';
        const lastErr = dbOutcome.recentEvents[0]?.lastError;
        errorReason = lastErr ?? 'Permanent rejection';
        message = `Rejected: ${errorReason}`;
      } else {
        status = dbOutcome.payment?.status === 'SUCCEEDED' ? 'PROCESSED' : 'PENDING';
        message = `Payment ${paymentId} successfully processed and stored in DB (Status: ${dbOutcome.payment?.status ?? 'PROCESSED'}).`;
      }
    }

    return {
      requestId: reqId,
      paymentId,
      eventType: String(eventType),
      amountDisplay,
      amountMinor: amountMinorStr,
      currency,
      httpStatus,
      status,
      duplicate: isDuplicate,
      duplicateType,
      message,
      errorReason,
      databaseOutcome: dbOutcome,
      rawResponse: {
        ingestResult: ingestRes,
        signature: signatureHeader(env.WEBHOOK_SECRET, JSON.stringify(parsed.data)),
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const dbOutcome = await getDbOutcome(merchantId, paymentId);
    return {
      requestId: reqId,
      paymentId,
      eventType: String(eventType),
      amountDisplay,
      amountMinor: amountMinorStr,
      currency,
      httpStatus: 500,
      status: 'ERROR',
      duplicate: false,
      duplicateType: 'NONE',
      message: `Internal processing error: ${errorMsg}`,
      errorReason: errorMsg,
      databaseOutcome: dbOutcome,
    };
  }
}

/** POST /api/testing/send - Send a single test payment */
testingRouter.post('/send', requireRole('ADMIN'), async (req, res) => {
  const merchantId = req.user!.merchantId;
  const merchant = (
    await pool.query<{ gateway_merchant_id: string }>(
      'SELECT gateway_merchant_id FROM merchants WHERE id = $1',
      [merchantId],
    )
  ).rows[0];

  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found for current session' });
    return;
  }

  const result = await executeTestPayment(
    req.body as PaymentTestRequestInput,
    merchantId,
    merchant.gateway_merchant_id,
  );
  res.json(result);
});

/** POST /api/testing/batch - Send a batch of payment requests (sequential or concurrent) */
testingRouter.post('/batch', requireRole('ADMIN'), async (req, res) => {
  const merchantId = req.user!.merchantId;
  const merchant = (
    await pool.query<{ gateway_merchant_id: string }>(
      'SELECT gateway_merchant_id FROM merchants WHERE id = $1',
      [merchantId],
    )
  ).rows[0];

  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found for current session' });
    return;
  }

  const { requests = [], concurrent = false } = req.body as {
    requests: PaymentTestRequestInput[];
    concurrent?: boolean;
  };

  if (!Array.isArray(requests) || requests.length === 0) {
    res.status(400).json({ error: 'requests array must not be empty' });
    return;
  }

  let results: PaymentTestResult[];

  if (concurrent) {
    // Concurrent execution to test simultaneous duplicate race conditions
    results = await Promise.all(
      requests.map((item) =>
        executeTestPayment(item, merchantId, merchant.gateway_merchant_id),
      ),
    );
  } else {
    // Sequential execution to test deterministic order (e.g. Request 1 -> Request 2 Duplicate -> Request 3)
    results = [];
    for (const item of requests) {
      const resItem = await executeTestPayment(
        item,
        merchantId,
        merchant.gateway_merchant_id,
      );
      results.push(resItem);
    }
  }

  const summary = {
    total: results.length,
    processed: results.filter((r) => r.status === 'PROCESSED').length,
    duplicates: results.filter((r) => r.status === 'DUPLICATE').length,
    rejected: results.filter((r) => r.status === 'REJECTED').length,
    failed: results.filter((r) => r.status === 'FAILED').length,
    errors: results.filter((r) => r.status === 'ERROR').length,
  };

  res.json({ summary, results });
});

/** POST /api/testing/reset - Cleans up test payments and events for the current merchant */
testingRouter.post('/reset', requireRole('ADMIN'), async (req, res) => {
  const merchantId = req.user!.merchantId;

  await pool.query('DELETE FROM audit_logs WHERE merchant_id = $1', [merchantId]);
  await pool.query('DELETE FROM webhook_events WHERE merchant_id = $1', [merchantId]);
  await pool.query('DELETE FROM payments WHERE merchant_id = $1', [merchantId]);

  res.json({
    success: true,
    message: 'Test data reset: payments, webhook events, and audit logs cleared for current merchant.',
  });
});

/** GET /api/testing/db-status/:paymentId - Live inspect a payment ID in DB */
testingRouter.get('/db-status/:paymentId', async (req, res) => {
  const merchantId = req.user!.merchantId;
  const paymentId = req.params.paymentId;
  const outcome = await getDbOutcome(merchantId, paymentId);
  res.json(outcome);
});
