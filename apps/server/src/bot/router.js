import { logger } from '../logger.js';
import { cv2Payload, errorPanel } from '../lib/ui.js';
import { handleAutocomplete, handleCommand } from './commands.js';
import { handleButton, handleModal, handleSelectMenu } from './interactions.js';

function logAndReply(interaction, error) {
  logger.error(
    { err: error, command: interaction.commandName, customId: interaction.customId },
    'Interaction handler failed',
  );
  if (interaction.isAutocomplete?.()) {
    interaction.respond([]).catch(() => null);
    return;
  }
  const payload = cv2Payload(errorPanel(error.message || 'Something went wrong. Please try again.'), {
    ephemeral: true,
  });
  const send = interaction.deferred || interaction.replied ? interaction.followUp.bind(interaction) : interaction.reply.bind(interaction);
  send(payload).catch(() => null);
}

export function registerInteractionRouter(client) {
  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isAutocomplete()) return await handleAutocomplete(interaction);
      if (interaction.isChatInputCommand()) return await handleCommand(interaction);
      if (interaction.isButton()) return await handleButton(interaction);
      if (interaction.isAnySelectMenu()) return await handleSelectMenu(interaction);
      if (interaction.isModalSubmit()) return await handleModal(interaction);
    } catch (error) {
      logAndReply(interaction, error);
    }
  });
}

export default registerInteractionRouter;
