import { Router } from 'express';
import { z } from 'zod';
import { WEBHOOK_EVENT_STATUSES, type WebhookEventStatus } from '@payment-recon/shared';
import { pool, withTransaction } from '../../lib/db';
import { HttpError } from '../../lib/http';
import { writeAudit } from '../audit/audit.repo';
import { requireAuth, requireRole } from '../../middleware/auth';
import { processWebhookEvent } from '../webhooks/process-event';

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

const listQuery = z.object({
  status: z.enum(WEBHOOK_EVENT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const idParam = z.string().uuid();

eventsRouter.get('/', async (req, res) => {
  const q = listQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: 'Invalid query', details: q.error.flatten() });
    return;
  }
  const { status, page, pageSize } = q.data;
  const statusParam = status ?? null;
  const merchantId = req.user!.merchantId;

  const rows = await pool.query(
    `SELECT id, gateway_event_id, event_type, status, attempt_count, last_error, next_attempt_at, received_at, processed_at
       FROM webhook_events
      WHERE merchant_id = $1 AND ($2::text IS NULL OR status = $2)
      ORDER BY received_at DESC, id DESC
      LIMIT $3 OFFSET $4`,
    [merchantId, statusParam, pageSize, (page - 1) * pageSize],
  );
  const count = await pool.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM webhook_events WHERE merchant_id = $1 AND ($2::text IS NULL OR status = $2)',
    [merchantId, statusParam],
  );
  res.json({
    items: rows.rows.map((e) => ({
      id: e.id,
      gatewayEventId: e.gateway_event_id,
      eventType: e.event_type,
      status: e.status,
      attemptCount: e.attempt_count,
      lastError: e.last_error,
      nextAttemptAt: e.next_attempt_at,
      receivedAt: e.received_at,
      processedAt: e.processed_at,
    })),
    page,
    pageSize,
    total: Number(count.rows[0]!.n),
  });
});

eventsRouter.get('/:id', async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  const merchantId = req.user!.merchantId;

  const event = (
    await pool.query(
      `SELECT id, gateway_event_id, event_type, status, attempt_count, attempt_base, last_error,
              next_attempt_at, received_at, processed_at, payload
         FROM webhook_events WHERE id = $1 AND merchant_id = $2`,
      [id.data, merchantId],
    )
  ).rows[0];
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  const attempts = await pool.query(
    `SELECT attempt_no, outcome, error, created_at FROM webhook_event_attempts
      WHERE webhook_event_id = $1 ORDER BY attempt_no`,
    [id.data],
  );
  res.json({ ...event, attempts: attempts.rows });
});

// Admin only. Moves a FAILED or DEAD event back into the queue and processes it now.
eventsRouter.post('/:id/force-retry', requireRole('ADMIN'), async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) throw new HttpError(404, 'Event not found');
  const merchantId = req.user!.merchantId;

  await withTransaction(async (client) => {
    const row = (
      await client.query<{ merchant_id: string; status: WebhookEventStatus }>(
        'SELECT merchant_id, status FROM webhook_events WHERE id = $1 FOR UPDATE',
        [id.data],
      )
    ).rows[0];
    if (!row || row.merchant_id !== merchantId) throw new HttpError(404, 'Event not found');
    if (row.status !== 'FAILED' && row.status !== 'DEAD') {
      throw new HttpError(409, `Only FAILED or DEAD events can be retried (current: ${row.status})`);
    }

    // attempt_base resets the attempt budget, so the event gets a fresh set of tries.
    await client.query(
      `UPDATE webhook_events SET status = 'FAILED', next_attempt_at = now(), attempt_base = attempt_count
        WHERE id = $1`,
      [id.data],
    );
    await writeAudit(client, {
      merchantId,
      actor: req.user!.id,
      action: 'webhook.force_retry',
      entityType: 'webhook_event',
      entityId: id.data,
      before: { status: row.status },
      after: { status: 'FAILED' },
      requestId: req.id ?? null,
    });
  });

  const status = await processWebhookEvent(id.data);
  res.json({ status });
});
