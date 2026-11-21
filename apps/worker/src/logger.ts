import pino from 'pino';

/** JSON logs in production; pretty logs in development. Never log tokens, keys or code. */
export function createLogger(level: string, pretty: boolean) {
  return pino({
    name: 'revo-worker',
    level,
    redact: {
      paths: ['*.token', '*.apiKey', '*.privateKey', '*.authorization', 'headers.authorization'],
      censor: '[redacted]',
    },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
      : {}),
  });
}
export type Logger = ReturnType<typeof createLogger>;
