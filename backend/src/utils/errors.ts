export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'REFRESH_INVALID'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export type ErrorDetail = { path: string; message: string };

/**
 * An error that is safe to show to the client. Anything thrown that is *not* an
 * AppError is treated as a bug: it is logged in full and the client sees only a
 * generic 500.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: ErrorDetail[]) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);
export const unauthenticated = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email, username or password');
export const refreshInvalid = () =>
  new AppError(401, 'REFRESH_INVALID', 'Session expired. Please sign in again.');
export const forbidden = (message = 'You do not have permission to do that') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, details?: ErrorDetail[]) =>
  new AppError(409, 'CONFLICT', message, details);
export const payloadTooLarge = (message = 'File exceeds maximum allowed size') =>
  new AppError(413, 'PAYLOAD_TOO_LARGE', message);
export const unsupportedMediaType = (message = 'File type is not supported') =>
  new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message);
export const rateLimited = (message = 'Too many requests. Please try again shortly.') =>
  new AppError(429, 'RATE_LIMITED', message);
