import pino from 'pino';
import { env } from '../config/env';

/** Structured logs with secrets and personal data redacted. Never log tokens, passwords or message bodies. */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.secret',
      '*.clientSecret',
      '*.appPassword',
      '*.authPassEnc',
      '*.body',
    ],
    censor: '[redacted]',
  },
});
