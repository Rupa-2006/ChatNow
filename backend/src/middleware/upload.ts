import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { badRequest, payloadTooLarge } from '../utils/errors.js';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

function makeSingleFileMiddleware(maxBytes: number, fieldName = 'file'): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
  }).single(fieldName);

  return (req: Request, res: Response, next: NextFunction) => {
    upload(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          const mb = Math.round(maxBytes / (1024 * 1024));
          return next(payloadTooLarge(`File exceeds the ${mb} MB size limit`));
        }
        return next(badRequest(err.message));
      }
      return next(err);
    });
  };
}

export const uploadAttachmentMiddleware = makeSingleFileMiddleware(MAX_ATTACHMENT_BYTES, 'file');
export const uploadAvatarMiddleware = makeSingleFileMiddleware(MAX_AVATAR_BYTES, 'file');
