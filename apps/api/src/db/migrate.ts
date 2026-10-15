import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { env } from '../config/env';
import { logger } from '../lib/logger';

/** Applies every .sql file in migrations/ once, in name order, each in its own transaction. */
export async function runMigrations(): Promise<void> {
  // Neon recommends a direct connection for schema migrations. Normal API
  // traffic continues to use DATABASE_URL, which may be the pooled endpoint.
  const migrationPool = new Pool({
    connectionString: env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL,
  });

  try {
    await migrationPool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const done = await migrationPool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (done.rowCount) continue;

      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const client = await migrationPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info('migration applied', { file });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  } finally {
    await migrationPool.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => undefined)
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
