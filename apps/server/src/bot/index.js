import { ActivityType } from 'discord.js';
import config, { botConfigured } from '../config.js';
import { botLogger as logger } from '../logger.js';
import { markOffline, markOnline, setClient } from '../lib/botState.js';
import { createDiscordClient } from './client.js';
import { commandData } from './commands.js';
import { registerInteractionRouter } from './router.js';
import { registerGatewayEvents } from './gateway.js';
import { startScheduler } from './scheduler.js';
import { syncGuildsFromClient } from '../services/guildService.js';
import { recoverActiveRooms, refreshLobby } from '../services/roomService.js';

let schedulerStop = null;

async function deployCommands(client) {
  try {
    await client.application.commands.set(commandData);
    logger.info({ count: commandData.length }, 'Slash commands deployed');
  } catch (error) {
    logger.warn({ err: error }, 'Slash command deployment failed — check the applications.commands scope');
  }
}

async function onReady(client) {
  markOnline(client);
  logger.info({ tag: client.user?.tag, guilds: client.guilds.cache.size }, 'Discord bot connected');
  client.user?.setPresence({
    activities: [{ name: 'temporary rooms', type: ActivityType.Watching }],
    status: 'online',
  });
  try {
    await syncGuildsFromClient(client);
    await deployCommands(client);
    const recovery = await recoverActiveRooms(client);
    logger.info(recovery, 'Temporary room recovery finished');
    for (const guild of client.guilds.cache.values()) {
      refreshLobby(client, guild.id).catch(() => null);
    }
    schedulerStop = startScheduler(client);
  } catch (error) {
    logger.error({ err: error }, 'Post-ready initialization failed');
  }
}

export async function startBot() {
  if (!botConfigured) {
    logger.warn('DISCORD_TOKEN or DISCORD_CLIENT_ID is not set — running in bot-offline mode.');
    return null;
  }
  const client = createDiscordClient();
  setClient(client);
  registerInteractionRouter(client);
  registerGatewayEvents(client);

  client.once('ready', () => {
    void onReady(client);
  });

  try {
    await client.login(config.discord.token);
  } catch (error) {
    markOffline();
    logger.error({ err: error }, 'Discord login failed — dashboard remains available in bot-offline mode');
    return null;
  }

  return {
    client,
    stop: async () => {
      schedulerStop?.();
      schedulerStop = null;
      markOffline();
      client.destroy();
    },
  };
}

export default startBot;
