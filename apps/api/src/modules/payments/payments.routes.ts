import { Router } from 'express';
import { z } from 'zod';
import { PAYMENT_STATUSES } from '@payment-recon/shared';
import { pool } from '../../lib/db';
import { requireAuth } from '../../middleware/auth';

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const listQuery = z.object({
  status: z.enum(PAYMENT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

type PaymentRow = {
  id: string;
  gateway_payment_id: string;
  amount_minor: string;
  currency: string;
  status: string;
  version: number;
  last_event_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

// BIGINT comes back as a string from pg, so it reaches the browser without losing precision.
function toPaymentDto(r: PaymentRow) {
  return {
    id: r.id,
    gatewayPaymentId: r.gateway_payment_id,
    amountMinor: r.amount_minor,
    currency: r.currency,
    status: r.status,
    version: r.version,
    lastEventAt: r.last_event_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

paymentsRouter.get('/', async (req, res) => {
  const q = listQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: 'Invalid query', details: q.error.flatten() });
    return;
  }
  const { status, page, pageSize } = q.data;
  const merchantId = req.user!.merchantId;
  const statusParam = status ?? null;

  const rows = await pool.query<PaymentRow>(
    `SELECT id, gateway_payment_id, amount_minor, currency, status, version, last_event_at, created_at, updated_at
       FROM payments
      WHERE merchant_id = $1 AND ($2::text IS NULL OR status = $2)
      ORDER BY created_at DESC, id DESC
      LIMIT $3 OFFSET $4`,
    [merchantId, statusParam, pageSize, (page - 1) * pageSize],
  );
  const count = await pool.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM payments WHERE merchant_id = $1 AND ($2::text IS NULL OR status = $2)',
    [merchantId, statusParam],
  );
  res.json({ items: rows.rows.map(toPaymentDto), page, pageSize, total: Number(count.rows[0]!.n) });
});

paymentsRouter.get('/:id', async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ error: 'Payment not found' });
    return;
  }
  const merchantId = req.user!.merchantId;

  const payment = (
    await pool.query<PaymentRow>(
      `SELECT id, gateway_payment_id, amount_minor, currency, status, version, last_event_at, created_at, updated_at
         FROM payments WHERE id = $1 AND merchant_id = $2`,
      [id.data, merchantId],
    )
  ).rows[0];
  if (!payment) {
    res.status(404).json({ error: 'Payment not found' });
    return;
  }

  // Every webhook event that refers to this payment, in the order received.
  const events = await pool.query(
    `SELECT id, gateway_event_id, event_type, status, attempt_count, last_error, received_at, processed_at
       FROM webhook_events
      WHERE merchant_id = $1 AND payload->'data'->>'paymentId' = $2
      ORDER BY received_at`,
    [merchantId, payment.gateway_payment_id],
  );

  res.json({
    payment: toPaymentDto(payment),
    events: events.rows.map((e) => ({
      id: e.id,
      gatewayEventId: e.gateway_event_id,
      eventType: e.event_type,
      status: e.status,
      attemptCount: e.attempt_count,
      lastError: e.last_error,
      receivedAt: e.received_at,
      processedAt: e.processed_at,
    })),
  });
});
