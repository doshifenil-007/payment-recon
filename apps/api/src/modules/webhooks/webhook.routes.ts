import express, { Router } from 'express';
import { eventEnvelopeSchema } from '@payment-recon/shared';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { ingestEvent } from './ingest-event';
import { verifySignature } from './signature';

export const webhookRouter = Router();

// Raw body parser. This route must be mounted BEFORE any global express.json() in app.ts,
// because the signature is computed over the exact bytes received.
webhookRouter.post(
  '/mock-gateway',
  express.raw({ type: 'application/json', limit: '64kb' }),
  async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';

    // 1. Signature first. A forged request costs one HMAC and writes nothing.
    const check = verifySignature({
      secret: env.WEBHOOK_SECRET,
      rawBody,
      header: req.header('x-gateway-signature'),
    });
    if (!check.ok) {
      res.status(401).json({ error: 'Invalid signature', reason: check.reason });
      return;
    }

    // 2. Parse and validate. Malformed JSON is a permanent client error, so the gateway should not retry it.
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      res.status(400).json({ error: 'Malformed JSON' });
      return;
    }
    const parsed = eventEnvelopeSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid event payload', details: parsed.error.flatten() });
      return;
    }

    // 3. Ingest: receipt, then processing.
    const result = await ingestEvent(parsed.data, rawBody);
    logger.info('webhook handled', {
      requestId: req.id,
      eventId: parsed.data.id,
      status: result.status,
      duplicate: result.duplicate,
    });

    if (result.conflict) {
      res.status(409).json({ error: 'Event ID reused with a different payload' });
      return;
    }
    // 202: the system will retry this itself, so the gateway should not resend.
    // 200: processed, duplicate, or permanently rejected. Resending will not help.
    const httpStatus = result.status === 'FAILED' ? 202 : 200;
    res.status(httpStatus).json({
      eventId: result.webhookEventId,
      status: result.status,
      duplicate: result.duplicate,
    });
  },
);
