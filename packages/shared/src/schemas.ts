import { z } from 'zod';
import { EVENT_TYPES } from './payments';

// The contract for a webhook body. Business fields live under `data`.
export const eventEnvelopeSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(EVENT_TYPES),
  merchantId: z.string().min(1).max(200),
  data: z.object({
    paymentId: z.string().min(1).max(200),
    amountMinor: z.string().regex(/^\d+$/, 'amountMinor must be an integer string'),
    currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be an ISO 4217 code'),
  }),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
