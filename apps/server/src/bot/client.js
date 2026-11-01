import { Client, GatewayIntentBits, Partials } from 'discord.js';

export function createDiscordClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildScheduledEvents,
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.User],
    allowedMentions: { parse: ['users'], repliedUser: false },
  });
}

export default createDiscordClient;
