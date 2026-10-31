/**
 * Typed application errors.
 *
 * `code` is a stable machine-readable string the client maps to copy; `message`
 * is always safe to display and never contains a filesystem path, token, or
 * stack trace.
 */
export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'BLOCKED_ADDRESS'
  | 'UNSUPPORTED_MEDIA'
  | 'UNAVAILABLE'
  | 'RANGE_UNSUPPORTED'
  | 'TOO_LARGE'
  | 'TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'DISK_FULL'
  | 'ENGINE_UNAVAILABLE'
  | 'INTERNAL';

const STATUS: Record<AppErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  BLOCKED_ADDRESS: 403,
  UNSUPPORTED_MEDIA: 415,
  UNAVAILABLE: 409,
  RANGE_UNSUPPORTED: 416,
  TOO_LARGE: 413,
  TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  DISK_FULL: 507,
  ENGINE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS[code];
    this.details = details;
  }

  toBody() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError('BAD_REQUEST', m, d);
export const notFound = (m: string) => new AppError('NOT_FOUND', m);
export const unsupported = (m: string, d?: unknown) => new AppError('UNSUPPORTED_MEDIA', m, d);
export const blocked = (m: string, d?: unknown) => new AppError('BLOCKED_ADDRESS', m, d);
export const upstream = (m: string, d?: unknown) => new AppError('UPSTREAM_ERROR', m, d);
export const conflict = (m: string) => new AppError('CONFLICT', m);

/** Convert anything thrown into an AppError without leaking internals. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOSPC') return new AppError('DISK_FULL', 'The download drive is full. Free space and retry.');
    if (code === 'ENOENT') return new AppError('NOT_FOUND', 'That file no longer exists on disk.');
    if (code === 'EACCES' || code === 'EPERM') return new AppError('FORBIDDEN', 'The server lacks permission for that path.');
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      return new AppError('TIMEOUT', 'The remote server did not respond in time.');
    }
    return new AppError('INTERNAL', 'An unexpected server error occurred.');
  }
  return new AppError('INTERNAL', 'An unexpected server error occurred.');
}
