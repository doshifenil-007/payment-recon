import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import request from 'supertest';
import { runMigrations } from '../src/db/migrate';
import { pool } from '../src/lib/db';
import { makeEvent } from '../src/mock-gateway/events';
import { signatureHeader } from '../src/modules/webhooks/signature';
import type { EventEnvelope } from '@payment-recon/shared';

export const MERCHANT_GATEWAY_ID = 'merchant_test';
export const SECRET = process.env.WEBHOOK_SECRET!;
export const ADMIN = { email: 'admin@test.local', password: 'password123' };
export const VIEWER = { email: 'viewer@test.local', password: 'password123' };
export { makeEvent };

export async function setupDb() {
  await runMigrations();
}

/** Wipes all data and seeds one merchant with an admin and a viewer. */
export async function resetDb() {
  await pool.query('TRUNCATE audit_logs, webhook_event_attempts, webhook_events, payments, users, merchants CASCADE');
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (name, gateway_merchant_id) VALUES ('Test Store', $1) RETURNING id`,
    [MERCHANT_GATEWAY_ID],
  );
  const hash = await bcrypt.hash('password123', 4); // low cost: tests only
  for (const [u, role] of [
    [ADMIN, 'ADMIN'],
    [VIEWER, 'VIEWER'],
  ] as const) {
    await pool.query('INSERT INTO users (merchant_id, email, password_hash, role) VALUES ($1, $2, $3, $4)', [
      merchant.rows[0]!.id,
      u.email,
      hash,
      role,
    ]);
  }
}

/** Sends an event the way the gateway does: signed, with the exact bytes that were signed. */
export function sendSigned(app: Express, envelope: EventEnvelope, opts: { body?: string; header?: string } = {}) {
  const raw = opts.body ?? JSON.stringify(envelope);
  return request(app)
    .post('/api/webhooks/mock-gateway')
    .set('content-type', 'application/json')
    .set('x-gateway-signature', opts.header ?? signatureHeader(SECRET, raw))
    .send(raw);
}

const TABLES = ['payments', 'webhook_events', 'webhook_event_attempts', 'audit_logs'] as const;
export async function count(table: (typeof TABLES)[number]): Promise<number> {
  const res = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return res.rows[0]!.n;
}

export async function payment(gatewayPaymentId: string) {
  const res = await pool.query(
    `SELECT p.status, p.amount_minor, p.currency FROM payments p
       JOIN merchants m ON m.id = p.merchant_id
      WHERE m.gateway_merchant_id = $1 AND p.gateway_payment_id = $2`,
    [MERCHANT_GATEWAY_ID, gatewayPaymentId],
  );
  return res.rows[0];
}

/** Makes a FAILED event due right now, so a test does not have to wait out the backoff. */
export async function makeDue(webhookEventId: string) {
  await pool.query(`UPDATE webhook_events SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [
    webhookEventId,
  ]);
}
