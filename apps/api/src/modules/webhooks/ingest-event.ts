import { createHash } from 'node:crypto';
import type { EventEnvelope, WebhookEventStatus } from '@payment-recon/shared';
import { pool } from '../../lib/db';
import { processWebhookEvent, type ProcessOptions } from './process-event';

export const GATEWAY = 'mock';

export function hashPayload(rawBody: string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

/**
 * Step 1, durable receipt. Commits on its own, immediately.
 * ON CONFLICT DO NOTHING makes the unique index the deduplication point: if two
 * requests race, the second waits for the first to commit, then sees the conflict.
 */
export async function receiveEvent(envelope: EventEnvelope, rawBody: string) {
  const payloadHash = hashPayload(rawBody);
  const inserted = await pool.query<{ id: string; status: WebhookEventStatus }>(
    `INSERT INTO webhook_events (gateway, gateway_event_id, merchant_id, event_type, payload_hash, payload, status)
     VALUES ($1, $2, (SELECT id FROM merchants WHERE gateway_merchant_id = $3), $4, $5, $6::jsonb, 'RECEIVED')
     ON CONFLICT (gateway, gateway_event_id) DO NOTHING
     RETURNING id, status`,
    [GATEWAY, envelope.id, envelope.merchantId, envelope.type, payloadHash, JSON.stringify(envelope)],
  );
  if (inserted.rows[0]) {
    return { id: inserted.rows[0].id, isNew: true, status: inserted.rows[0].status, storedPayloadHash: payloadHash };
  }
  const existing = await pool.query<{ id: string; status: WebhookEventStatus; payload_hash: string }>(
    'SELECT id, status, payload_hash FROM webhook_events WHERE gateway = $1 AND gateway_event_id = $2',
    [GATEWAY, envelope.id],
  );
  const row = existing.rows[0]!;
  return { id: row.id, isNew: false, status: row.status, storedPayloadHash: row.payload_hash };
}

export type IngestResult = {
  webhookEventId: string;
  status: WebhookEventStatus;
  duplicate: boolean;
  conflict: boolean;
};

export async function ingestEvent(
  envelope: EventEnvelope,
  rawBody: string,
  opts: ProcessOptions = {},
): Promise<IngestResult> {
  const receipt = await receiveEvent(envelope, rawBody);

  // Same event ID, different bytes: never apply it. Reusing an ID for a different payload is a gateway bug or an attack.
  if (receipt.storedPayloadHash !== hashPayload(rawBody)) {
    return { webhookEventId: receipt.id, status: receipt.status, duplicate: true, conflict: true };
  }

  // Processing runs for new events, crashed-earlier events, and failed events whose backoff has passed.
  // For a PROCESSED duplicate it changes nothing and returns the current status.
  const status = await processWebhookEvent(receipt.id, opts);
  return { webhookEventId: receipt.id, status, duplicate: !receipt.isNew, conflict: false };
}
