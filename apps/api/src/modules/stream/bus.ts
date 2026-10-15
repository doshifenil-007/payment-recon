import { EventEmitter } from 'node:events';

export type ChangeMessage = { merchantId: string; paymentId: string };

/**
 * In-process bus. Emitted only AFTER a processing transaction commits, so
 * browsers never hear about a change that was rolled back.
 * Works for one API process; LISTEN/NOTIFY would be needed for several.
 */
export const changeBus = new EventEmitter();
changeBus.setMaxListeners(0);
