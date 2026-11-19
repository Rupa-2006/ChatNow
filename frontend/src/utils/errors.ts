import axios from 'axios';
import type { ApiErrorDetail, ApiErrorEnvelope } from '@/types/api';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: ApiErrorDetail[];
  readonly requestId?: string;

  constructor(params: {
    code: string;
    message: string;
    status: number;
    details?: ApiErrorDetail[];
    requestId?: string;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details ?? [];
    this.requestId = params.requestId;
  }
}

export function normalizeApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (axios.isAxiosError(err)) {
    const status = err.response?.status ?? 0;
    const data = err.response?.data as Partial<ApiErrorEnvelope> | undefined;
    if (data?.error && typeof data.error.message === 'string') {
      return new ApiError({
        code: data.error.code ?? 'UNKNOWN_ERROR',
        message: data.error.message,
        status,
        details: Array.isArray(data.error.details) ? data.error.details : [],
        requestId: data.error.requestId,
      });
    }

    if (err.code === 'ERR_NETWORK' || status === 0) {
      return new ApiError({
        code: 'NETWORK_ERROR',
        message: 'Unable to reach the ChatNow server. Check your connection and try again.',
        status: 0,
      });
    }

    return new ApiError({
      code: 'HTTP_ERROR',
      message: err.message || 'Request failed. Please try again.',
      status,
    });
  }

  if (err instanceof Error) {
    return new ApiError({ code: 'UNKNOWN_ERROR', message: err.message, status: 0 });
  }

  return new ApiError({ code: 'UNKNOWN_ERROR', message: 'Something went wrong.', status: 0 });
}

export function extractFieldErrors(err: ApiError): Record<string, string> {
  const map: Record<string, string> = {};
  for (const detail of err.details) {
    if (detail.path && !map[detail.path]) {
      map[detail.path] = detail.message;
    }
  }
  return map;
}
