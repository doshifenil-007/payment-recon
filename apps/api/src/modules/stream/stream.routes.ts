import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { changeBus, type ChangeMessage } from './bus';

export const streamRouter = Router();
streamRouter.use(requireAuth);

/**
 * Server-Sent Events. The browser's EventSource reconnects by itself.
 * Messages are hints only: the dashboard reloads from the database on reconnect.
 */
streamRouter.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const merchantId = req.user!.merchantId;
  const onChange = (msg: ChangeMessage) => {
    if (msg.merchantId === merchantId) {
      res.write(`event: change\ndata: ${JSON.stringify(msg)}\n\n`);
    }
  };
  changeBus.on('change', onChange);

  // Heartbeat keeps proxies from closing an idle connection.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    changeBus.off('change', onChange);
  });
});
