import { randomUUID } from 'node:crypto';
import type { EventEnvelope, GatewayEventType } from '@payment-recon/shared';

export function makeEvent(
  type: GatewayEventType,
  paymentId: string,
  merchantId: string,
  amountMinor: number | string,
  currency: string,
  id: string = `evt_${randomUUID()}`,
): EventEnvelope {
  return { id, type, merchantId, data: { paymentId, amountMinor: String(amountMinor), currency } };
}
