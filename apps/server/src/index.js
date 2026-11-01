import config, { validateConfig } from './config.js';
import { logger } from './logger.js';
import { createHttpServer } from './api/app.js';
import { startBot } from './bot/index.js';
import prisma from '@chamber/db';
import { getBotState } from './lib/botState.js';

async function main() {
  validateConfig();
  const { server, app, ws } = createHttpServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  logger.info(
    { url: `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`, env: config.env },
    'Chamber API is listening',
  );

  let botHandle = null;
  try {
    botHandle = await startBot();
  } catch (error) {
    logger.error({ err: error }, 'Bot startup failed — continuing in bot-offline mode');
  }
  app.locals.botTag = getBotState().tag;

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    try {
      await botHandle?.stop?.();
    } catch (error) {
      logger.warn({ err: error }, 'Bot shutdown error');
    }
    ws.close();
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect().catch(() => null);
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    void shutdown('uncaughtException');
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Fatal startup error');
  process.exit(1);
});
