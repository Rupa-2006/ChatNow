import 'express';

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware from a verified access token. */
      auth?: { userId: string; sessionId: string };
    }
  }
}

export {};
