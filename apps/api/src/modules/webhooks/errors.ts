/** Retrying cannot help (for example, an invalid state transition). The event is REJECTED. */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

/** The situation may resolve later (for example, the payment does not exist yet). The event is retried. */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}
