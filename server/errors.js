/**
 * Errors that are the caller's fault, not the server's.
 *
 * The HTTP layer maps `err.status` straight onto the response code, so a
 * request that names a bad project id or an out-of-tree file comes back as a
 * 4xx instead of a generic 500. Carrying the status on the error keeps that
 * mapping from depending on the wording of the message.
 */
export class HttpError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message, code) {
  return new HttpError(message, 400, code);
}

export function notFound(message, code) {
  return new HttpError(message, 404, code);
}
