import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/lib/db';
import { receiveEvent } from '../src/modules/webhooks/ingest-event';
import { processWebhookEvent } from '../src/modules/webhooks/process-event';
import { signatureHeader } from '../src/modules/webhooks/signature';
import {
  ADMIN,
  count,
  makeDue,
  makeEvent,
  MERCHANT_GATEWAY_ID,
  payment,
  resetDb,
  sendSigned,
  setupDb,
  SECRET,
  VIEWER,
} from './helpers';

const app = createApp();
const M = MERCHANT_GATEWAY_ID;

beforeAll(async () => {
  await setupDb();
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetDb();
});

async function eventRow(gatewayEventId: string) {
  return (
    await pool.query(
      'SELECT id, status, attempt_count, last_error, next_attempt_at FROM webhook_events WHERE gateway_event_id = $1',
      [gatewayEventId],
    )
  ).rows[0];
}

describe('idempotent webhook processing', () => {
  it('applies a duplicate delivery exactly once', async () => {
    const created = makeEvent('payment.created', 'pay_dup', M, 4990, 'INR');

    const first = await sendSigned(app, created);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('PROCESSED');

    const dup = await sendSigned(app, created);
    expect(dup.status).toBe(200);
    expect(dup.body.duplicate).toBe(true);

    expect(await count('payments')).toBe(1);
    expect(await count('webhook_events')).toBe(1);
    expect(await count('audit_logs')).toBe(1); // the change was recorded once, not twice
  });

  it('handles concurrent identical deliveries exactly once', async () => {
    const created = makeEvent('payment.created', 'pay_race', M, 1000, 'USD');

    const responses = await Promise.all(Array.from({ length: 8 }, () => sendSigned(app, created)));

    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(await count('payments')).toBe(1);
    expect(await count('webhook_events')).toBe(1);
    const attempts = await pool.query("SELECT count(*)::int AS n FROM webhook_event_attempts WHERE outcome = 'SUCCEEDED'");
    expect(attempts.rows[0].n).toBe(1);
  });

  it('rejects an invalid state transition permanently', async () => {
    const id = 'pay_bad';
    await sendSigned(app, makeEvent('payment.created', id, M, 500, 'INR'));
    await sendSigned(app, makeEvent('payment.succeeded', id, M, 500, 'INR'));

    const failedAfterSuccess = makeEvent('payment.failed', id, M, 500, 'INR');
    const res = await sendSigned(app, failedAfterSuccess);

    expect(res.status).toBe(200); // permanent: the gateway should stop retrying
    expect(res.body.status).toBe('REJECTED');
    expect((await payment(id)).status).toBe('SUCCEEDED'); // unchanged
    const row = await eventRow(failedAfterSuccess.id);
    expect(row.last_error).toContain('Invalid transition SUCCEEDED -> FAILED');
  });

  it('retries an event that arrives before its payment, then applies it once the payment exists', async () => {
    const succeeded = makeEvent('payment.succeeded', 'pay_late', M, 1000, 'USD');
    const created = makeEvent('payment.created', 'pay_late', M, 1000, 'USD');

    const early = await sendSigned(app, succeeded);
    expect(early.status).toBe(202); // retryable: the system will retry it, so the gateway should not
    expect(early.body.status).toBe('FAILED');
    const eventId = early.body.eventId as string;

    // Backoff has not passed yet, so processing must leave it alone.
    expect(await processWebhookEvent(eventId)).toBe('FAILED');
    expect(await payment('pay_late')).toBeUndefined();

    await sendSigned(app, created);
    await makeDue(eventId);

    expect(await processWebhookEvent(eventId)).toBe('PROCESSED');
    expect((await payment('pay_late')).status).toBe('SUCCEEDED');
  });

  it('rolls back the payment change when processing fails before commit', async () => {
    await sendSigned(app, makeEvent('payment.created', 'pay_roll', M, 700, 'INR'));
    const succeeded = makeEvent('payment.succeeded', 'pay_roll', M, 700, 'INR');
    const { id } = await receiveEvent(succeeded, JSON.stringify(succeeded)); // stored, not yet processed

    const status = await processWebhookEvent(id, {
      afterApply: async () => {
        throw new Error('simulated crash after the payment was updated');
      },
    });

    expect(status).toBe('FAILED');
    expect((await payment('pay_roll')).status).toBe('PENDING'); // the update was rolled back
    const attempt = await pool.query('SELECT outcome, error FROM webhook_event_attempts WHERE webhook_event_id = $1', [id]);
    expect(attempt.rows[0]).toEqual({ outcome: 'FAILED', error: 'simulated crash after the payment was updated' });
  });

  it('marks an event DEAD after repeated failures', async () => {
    const created = makeEvent('payment.created', 'pay_dead', M, 900, 'INR');
    const { id } = await receiveEvent(created, JSON.stringify(created));
    const boom = { afterApply: async () => { throw new Error('downstream outage'); } };

    let status = 'RECEIVED';
    for (let i = 0; i < 5; i++) {
      await makeDue(id);
      status = await processWebhookEvent(id, boom);
    }

    expect(status).toBe('DEAD');
    const row = await pool.query('SELECT attempt_count FROM webhook_events WHERE id = $1', [id]);
    expect(row.rows[0].attempt_count).toBe(5);
    expect(await payment('pay_dead')).toBeUndefined(); // every attempt rolled back
  });

  it('rejects the same event ID sent with a different payload', async () => {
    await sendSigned(app, makeEvent('payment.created', 'pay_conf', M, 4990, 'INR', 'evt_fixed'));

    const tampered = makeEvent('payment.created', 'pay_conf', M, 9999, 'INR', 'evt_fixed');
    const res = await sendSigned(app, tampered);

    expect(res.status).toBe(409);
    expect((await payment('pay_conf')).amount_minor).toBe('4990');
    expect(await count('webhook_events')).toBe(1);
  });
});

describe('webhook request validation', () => {
  it('rejects a request without a signature and writes nothing', async () => {
    const env = makeEvent('payment.created', 'pay_nosig', M, 100, 'INR');
    const res = await request(app)
      .post('/api/webhooks/mock-gateway')
      .set('content-type', 'application/json')
      .send(JSON.stringify(env));
    expect(res.status).toBe(401);
    expect(await count('webhook_events')).toBe(0);
  });

  it('rejects a signed request whose body was changed in transit', async () => {
    const env = makeEvent('payment.created', 'pay_tamper', M, 100, 'INR');
    const header = signatureHeader(SECRET, JSON.stringify(env));
    const altered = JSON.stringify({ ...env, data: { ...env.data, amountMinor: '1' } });
    const res = await sendSigned(app, env, { body: altered, header });
    expect(res.status).toBe(401);
    expect(await count('webhook_events')).toBe(0);
  });

  it('rejects an expired signature (replay protection)', async () => {
    const env = makeEvent('payment.created', 'pay_old', M, 100, 'INR');
    const raw = JSON.stringify(env);
    const oldHeader = signatureHeader(SECRET, raw, Math.floor(Date.now() / 1000) - 600);
    const res = await sendSigned(app, env, { body: raw, header: oldHeader });
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('EXPIRED');
    expect(await count('webhook_events')).toBe(0);
  });

  it('returns 400 for malformed JSON even when it is correctly signed', async () => {
    const raw = '{not json';
    const res = await sendSigned(app, makeEvent('payment.created', 'x', M, 1, 'INR'), { body: raw });
    expect(res.status).toBe(400);
    expect(await count('webhook_events')).toBe(0);
  });
});

describe('admin force-retry', () => {
  it('lets an admin retry a failed event, records it in the audit log, and blocks viewers', async () => {
    const succeeded = makeEvent('payment.succeeded', 'pay_force', M, 2500, 'INR');
    const early = await sendSigned(app, succeeded);
    const eventId = early.body.eventId as string;
    await sendSigned(app, makeEvent('payment.created', 'pay_force', M, 2500, 'INR'));

    const viewer = request.agent(app);
    await viewer.post('/api/auth/login').send(VIEWER).expect(200);
    const denied = await viewer.post(`/api/events/${eventId}/force-retry`);
    expect(denied.status).toBe(403);

    const admin = request.agent(app);
    await admin.post('/api/auth/login').send(ADMIN).expect(200);
    const res = await admin.post(`/api/events/${eventId}/force-retry`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PROCESSED');
    expect((await payment('pay_force')).status).toBe('SUCCEEDED');

    const audit = await pool.query("SELECT actor, entity_id FROM audit_logs WHERE action = 'webhook.force_retry'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].entity_id).toBe(eventId);
  });
});
