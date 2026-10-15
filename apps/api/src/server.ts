import { createApp } from './app';
import { env } from './config/env';
import { pool } from './lib/db';
import { logger } from './lib/logger';

const app = createApp();
const server = app.listen(env.PORT, () => logger.info('api listening', { port: env.PORT }));

// Stop taking requests, let in-flight work finish, then close the database pool.
function shutdown() {
  logger.info('shutting down');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
