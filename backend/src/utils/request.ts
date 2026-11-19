import type { Request } from 'express';
import type { ClientMeta } from '../services/audit.service.js';

/** Where a request came from, for session records and the audit trail. */
export function clientMeta(req: Request): ClientMeta {
  return {
    // req.ip honours the `trust proxy` setting, so behind Nginx this is the real
    // client address rather than the proxy's.
    ip: req.ip?.slice(0, 64) ?? null,
    userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
  };
}
