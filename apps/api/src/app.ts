import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { pool } from './lib/db';
import { HttpError } from './lib/http';
import { logger } from './lib/logger';
import { requestId } from './middleware/request-id';
import { authRouter } from './modules/auth/auth.routes';
import { auditRouter } from './modules/audit/audit.routes';
import { eventsRouter } from './modules/events/events.routes';
import { paymentsRouter } from './modules/payments/payments.routes';
import { streamRouter } from './modules/stream/stream.routes';
import { testingRouter } from './modules/testing/testing.routes';
import { webhookRouter } from './modules/webhooks/webhook.routes';

/** Builds the Express app without starting a listener, so tests can drive it directly. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));

  // MUST come before express.json(): the webhook route needs the raw bytes for the signature.
  app.use('/api/webhooks', webhookRouter);

  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db_unavailable' });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/stream', streamRouter);
  app.use('/api/testing', testingRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // Body-parser errors (bad JSON, too large) carry their own 4xx status.
    const status = (err as { status?: number }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({ error: 'Bad request' });
      return;
    }
    logger.error('unhandled error', { requestId: req.id, message: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
