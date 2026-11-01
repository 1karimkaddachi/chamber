import pino from 'pino';
import config from './config.js';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'chamber' },
  redact: {
    paths: [
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'req.headers.authorization',
      'req.headers.cookie',
      'apiKey',
    ],
    censor: '[redacted]',
  },
  transport: config.isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname,service',
          singleLine: false,
        },
      },
});

export const botLogger = logger.child({ scope: 'bot' });
export const apiLogger = logger.child({ scope: 'api' });
export const roomLogger = logger.child({ scope: 'room' });

export default logger;
