import { pool } from './lib/db';
import { logger } from './lib/logger';
import { processWebhookEvent } from './modules/webhooks/process-event';

/**
 * Finds FAILED events whose backoff has passed and processes them.
 * Uses the same claim as the API, so running this alongside the API is safe.
 */
export async function retryDueEvents(limit = 20): Promise<number> {
  const due = await pool.query<{ id: string }>(
    `SELECT id FROM webhook_events
      WHERE status = 'FAILED' AND next_attempt_at <= now()
      ORDER BY next_attempt_at LIMIT $1`,
    [limit],
  );
  for (const row of due.rows) {
    const status = await processWebhookEvent(row.id);
    logger.info('retry attempted', { eventId: row.id, status });
  }
  return due.rows.length;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  let stopping = false;
  process.on('SIGTERM', () => (stopping = true));
  process.on('SIGINT', () => (stopping = true));
  logger.info('retry worker started');
  while (!stopping) {
    try {
      await retryDueEvents();
    } catch (err) {
      logger.error('retry worker error', { message: err instanceof Error ? err.message : String(err) });
    }
    await sleep(2000);
  }
  await pool.end();
}

if (require.main === module) {
  main();
}
