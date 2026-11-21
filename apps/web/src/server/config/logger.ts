import 'server-only';
import pino from 'pino';
import { env } from './env';

/** JSON logs. Never log tokens, keys, or code. */
export const logger = pino({
  name: 'revo-web',
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.apiKey',
      '*.authorization',
      'headers.authorization',
      'headers.cookie',
    ],
    censor: '[redacted]',
  },
});
