/** An error with an HTTP status, turned into a JSON response by the error handler. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
