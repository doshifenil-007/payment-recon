import type { PoolClient } from 'pg';
import {
  canTransition,
  EVENT_TARGET_STATUS,
  type EventEnvelope,
  type PaymentStatus,
  type WebhookEventStatus,
} from '@payment-recon/shared';
import { pool, withTransaction } from '../../lib/db';
import { writeAudit } from '../audit/audit.repo';
import { changeBus } from '../stream/bus';
import { PermanentError, RetryableError } from './errors';

export const MAX_ATTEMPTS = 5;

/** Exponential backoff with jitter: 30s, 60s, 120s, 240s, capped at 15 minutes. */
export function nextAttemptAt(attemptNo: number, now = Date.now()): Date {
  const base = Math.min(30_000 * 2 ** (attemptNo - 1), 15 * 60_000);
  const jitter = Math.random() * base * 0.2;
  return new Date(now + base + jitter);
}

type ClaimedEvent = { id: string; payload: EventEnvelope; attempt_count: number };
type PaymentRow = { id: string; status: PaymentStatus; amount_minor: string; currency: string };
type Effects = { merchantId: string; paymentId: string };

/** The business logic. Runs inside the processing transaction, so a throw rolls everything back. */
async function applyEvent(client: PoolClient, event: ClaimedEvent): Promise<Effects> {
  const env = event.payload;

  const merchantRes = await client.query<{ id: string }>(
    'SELECT id FROM merchants WHERE gateway_merchant_id = $1',
    [env.merchantId],
  );
  const merchant = merchantRes.rows[0];
  if (!merchant) throw new PermanentError(`Unknown merchant ${env.merchantId}`);
  const merchantId = merchant.id;

  const amountMinor = BigInt(env.data.amountMinor);
  const currency = env.data.currency;
  const target = EVENT_TARGET_STATUS[env.type];

  const paymentRes = await client.query<PaymentRow>(
    `SELECT id, status, amount_minor, currency FROM payments
      WHERE merchant_id = $1 AND gateway_payment_id = $2`,
    [merchantId, env.data.paymentId],
  );
  const payment = paymentRes.rows[0];

  if (env.type === 'payment.created') {
    if (payment) {
      // Same payment created again under a new event ID: nothing to change, unless the details differ.
      if (BigInt(payment.amount_minor) !== amountMinor || payment.currency !== currency) {
        throw new PermanentError('payment.created conflicts with existing payment');
      }
      return { merchantId, paymentId: payment.id };
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO payments (merchant_id, gateway_payment_id, amount_minor, currency, status, last_event_at)
       VALUES ($1, $2, $3, $4, 'PENDING', now()) RETURNING id`,
      [merchantId, env.data.paymentId, amountMinor.toString(), currency],
    );
    const paymentId = inserted.rows[0]!.id;
    await writeAudit(client, {
      merchantId,
      actor: 'gateway:mock',
      action: 'payment.created',
      entityType: 'payment',
      entityId: paymentId,
      after: { status: 'PENDING' },
    });
    return { merchantId, paymentId };
  }

  // Out of order: the event arrived before payment.created. Retry later.
  if (!payment) throw new RetryableError('Payment not created yet');

  if (BigInt(payment.amount_minor) !== amountMinor || payment.currency !== currency) {
    throw new PermanentError('Amount or currency does not match the stored payment');
  }
  if (!canTransition(payment.status, target)) {
    throw new PermanentError(`Invalid transition ${payment.status} -> ${target}`);
  }

  // Conditional update: succeeds only if the status is still what we read.
  // If another event changed it in the meantime, this matches zero rows.
  const updated = await client.query(
    `UPDATE payments SET status = $1, version = version + 1, last_event_at = now(), updated_at = now()
      WHERE id = $2 AND status = $3`,
    [target, payment.id, payment.status],
  );
  if (updated.rowCount !== 1) throw new RetryableError('Payment changed concurrently');

  await writeAudit(client, {
    merchantId,
    actor: 'gateway:mock',
    action: 'payment.status_changed',
    entityType: 'payment',
    entityId: payment.id,
    before: { status: payment.status },
    after: { status: target },
  });
  return { merchantId, paymentId: payment.id };
}

export type ProcessOptions = {
  /** Test hook: runs after the business change, before commit, to simulate a crash. */
  afterApply?: () => Promise<void>;
};

/**
 * Processes one stored event. Safe to call many times for the same event:
 * the claim below lets only one caller move the event forward at a time.
 */
export async function processWebhookEvent(
  webhookEventId: string,
  opts: ProcessOptions = {},
): Promise<WebhookEventStatus> {
  try {
    const effects = await withTransaction(async (client) => {
      // Claim: only one transaction can move the row out of RECEIVED, or out of FAILED once its backoff has passed.
      // PROCESSED here is provisional. If anything below throws, the transaction rolls back and the row returns to its old status.
      const claim = await client.query<ClaimedEvent>(
        `UPDATE webhook_events SET status = 'PROCESSED'
          WHERE id = $1
            AND (status = 'RECEIVED' OR (status = 'FAILED' AND next_attempt_at <= now()))
          RETURNING id, payload, attempt_count`,
        [webhookEventId],
      );
      const event = claim.rows[0];
      if (!event) return null; // already processed, in flight elsewhere, or not due yet

      const result = await applyEvent(client, event);
      if (opts.afterApply) await opts.afterApply();

      await client.query(
        `UPDATE webhook_events
            SET processed_at = now(), last_error = NULL, next_attempt_at = NULL,
                attempt_count = attempt_count + 1
          WHERE id = $1`,
        [webhookEventId],
      );
      await client.query(
        `INSERT INTO webhook_event_attempts (webhook_event_id, attempt_no, outcome)
         VALUES ($1, $2, 'SUCCEEDED')`,
        [webhookEventId, event.attempt_count + 1],
      );
      return result;
    });

    if (effects) {
      changeBus.emit('change', effects); // only after commit
      return 'PROCESSED';
    }
    return currentStatus(webhookEventId);
  } catch (err) {
    return recordFailure(webhookEventId, err);
  }
}

async function currentStatus(webhookEventId: string): Promise<WebhookEventStatus> {
  const res = await pool.query<{ status: WebhookEventStatus }>(
    'SELECT status FROM webhook_events WHERE id = $1',
    [webhookEventId],
  );
  return res.rows[0]!.status;
}

/** Records a failed attempt in its own transaction, after the processing one has rolled back. */
async function recordFailure(webhookEventId: string, err: unknown): Promise<WebhookEventStatus> {
  const message = err instanceof Error ? err.message : 'Unknown error';

  return withTransaction(async (client) => {
    const row = await client.query<{ attempt_count: number; attempt_base: number }>(
      'SELECT attempt_count, attempt_base FROM webhook_events WHERE id = $1 FOR UPDATE',
      [webhookEventId],
    );
    const { attempt_count, attempt_base } = row.rows[0]!;
    const attemptNo = attempt_count + 1;
    const attemptsInWindow = attemptNo - attempt_base; // resets after an admin force-retry

    let status: WebhookEventStatus;
    if (err instanceof PermanentError) status = 'REJECTED';
    else if (attemptsInWindow >= MAX_ATTEMPTS) status = 'DEAD';
    else status = 'FAILED';

    await client.query(
      `UPDATE webhook_events
          SET status = $1, attempt_count = $2, last_error = $3, next_attempt_at = $4
        WHERE id = $5`,
      [status, attemptNo, message, status === 'FAILED' ? nextAttemptAt(attemptNo) : null, webhookEventId],
    );
    await client.query(
      `INSERT INTO webhook_event_attempts (webhook_event_id, attempt_no, outcome, error)
       VALUES ($1, $2, 'FAILED', $3)`,
      [webhookEventId, attemptNo, message],
    );
    return status;
  });
}
