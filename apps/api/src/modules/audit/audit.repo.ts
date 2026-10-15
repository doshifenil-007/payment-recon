import type { PoolClient } from 'pg';
import { pool } from '../../lib/db';

export type AuditEntry = {
  merchantId: string;
  actor: string; // user ID, "gateway:mock", or "system"
  action: string; // e.g. "webhook.force_retry", "payment.status_changed"
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
};

/** Must be called with the same client as the change it records, so both commit or neither does. */
export async function writeAudit(client: PoolClient, e: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (merchant_id, actor, action, entity_type, entity_id, before, after, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      e.merchantId,
      e.actor,
      e.action,
      e.entityType,
      e.entityId,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
      e.requestId ?? null,
    ],
  );
}

export async function listAudit(merchantId: string, limit: number) {
  const res = await pool.query(
    `SELECT id, actor, action, entity_type, entity_id, before, after, request_id, created_at
       FROM audit_logs WHERE merchant_id = $1
      ORDER BY created_at DESC, id DESC LIMIT $2`,
    [merchantId, limit],
  );
  return res.rows;
}
