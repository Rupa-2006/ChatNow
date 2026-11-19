import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';
import { AppError, type ErrorCode, type ErrorDetail } from '../utils/errors.js';

function send(
  req: Request,
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: ErrorDetail[],
): void {
  res.status(status).json({
    error: { code, message, ...(details ? { details } : {}), requestId: String(req.id ?? '') },
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  send(req, res, 404, 'NOT_FOUND', 'Route not found');
}

/**
 * The single place where errors become HTTP responses. Known error types are mapped
 * to the documented envelope; anything else is a bug, so it is logged with its stack
 * and the client receives a generic message with no internal detail.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return send(req, res, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }

  if (err instanceof AppError) {
    return send(req, res, err.status, err.code, err.message, err.details);
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = err.meta?.target;
      const fields = Array.isArray(target) ? target.map(String) : [];
      return send(
        req,
        res,
        409,
        'CONFLICT',
        'That value is already in use',
        fields.map((f) => ({ path: f, message: 'Already in use' })),
      );
    }
    if (err.code === 'P2025') return send(req, res, 404, 'NOT_FOUND', 'Resource not found');
  }

  // Errors raised by express.json(): malformed JSON or an oversized body.
  const bodyError = err as { type?: string; status?: number };
  if (bodyError?.type === 'entity.parse.failed') {
    return send(req, res, 400, 'VALIDATION_ERROR', 'Request body is not valid JSON');
  }
  if (bodyError?.type === 'entity.too.large') {
    return send(req, res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }

  (req.log ?? logger).error({ event: 'api.error', err }, 'Unhandled error');
  send(req, res, 500, 'INTERNAL_ERROR', 'Something went wrong');
}
