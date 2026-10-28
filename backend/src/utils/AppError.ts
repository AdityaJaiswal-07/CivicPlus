export type ErrorCode =
  | 'BAD_REQUEST'
  | 'INVALID_JSON'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CORS_ORIGIN_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'SERVICE_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Resource not found') {
    return new AppError(404, 'NOT_FOUND', message);
  }
  static unavailable(message = 'Service temporarily unavailable') {
    return new AppError(503, 'SERVICE_UNAVAILABLE', message);
  }
  static conflict(message = 'Conflict', details?: unknown) {
    return new AppError(409, 'CONFLICT', message, details);
  }
}
