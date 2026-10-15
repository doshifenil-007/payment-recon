import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { listAudit } from './audit.repo';

export const auditRouter = Router();
auditRouter.use(requireAuth);

const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

auditRouter.get('/', async (req, res) => {
  const q = query.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: 'Invalid query' });
    return;
  }
  res.json({ items: await listAudit(req.user!.merchantId, q.data.limit) });
});
