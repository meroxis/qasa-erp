/** An error the API returns to the client with a stable machine-readable code. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, details?: unknown) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', { what });
export const invalid = (details: unknown) => new AppError(400, 'validation', details);
export const conflict = (reason: string, details?: unknown) => new AppError(409, reason, details);
