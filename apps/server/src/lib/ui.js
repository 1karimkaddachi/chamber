import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
} from 'discord.js';

export const CV2_FLAG = MessageFlags.IsComponentsV2;
export const MAX_CUSTOM_ID = 100;

export function accentInt(hex, fallback = 0x7c6cff) {
  if (typeof hex !== 'string') return fallback;
  const parsed = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

export function separator(spacing = 1) {
  return new SeparatorBuilder().setSpacing(spacing).setDivider(true);
}

export function button({ id, label, emoji, style = ButtonStyle.Secondary, disabled = false }) {
  if (id.length > MAX_CUSTOM_ID) throw new Error(`Custom id too long: ${id}`);
  const builder = new ButtonBuilder().setCustomId(id).setStyle(style).setDisabled(disabled);
  if (label) builder.setLabel(label);
  if (emoji) builder.setEmoji(emoji);
  return builder;
}

export function linkButton({ url, label, emoji }) {
  const builder = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url);
  if (label) builder.setLabel(label);
  if (emoji) builder.setEmoji(emoji);
  return builder;
}

export function row(...components) {
  const actionRow = new ActionRowBuilder();
  actionRow.addComponents(...components);
  return actionRow;
}

export function selectRow(menu) {
  return new ActionRowBuilder().addComponents(menu);
}

export function stringSelect({ id, placeholder, options, min = 1, max = 1, disabled = false }) {
  return new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(placeholder)
    .setMinValues(min)
    .setMaxValues(max)
    .setDisabled(disabled)
    .addOptions(options);
}

export function userSelect({ id, placeholder, min = 1, max = 1, disabled = false }) {
  return new UserSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(placeholder)
    .setMinValues(min)
    .setMaxValues(max)
    .setDisabled(disabled);
}

export function roleSelect({ id, placeholder, min = 1, max = 1, disabled = false }) {
  return new RoleSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(placeholder)
    .setMinValues(min)
    .setMaxValues(max)
    .setDisabled(disabled);
}

export function channelSelect({ id, placeholder, channelTypes, min = 1, max = 1, disabled = false }) {
  return new ChannelSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(placeholder)
    .setChannelTypes(channelTypes)
    .setMinValues(min)
    .setMaxValues(max)
    .setDisabled(disabled);
}

/**
 * Compose a Components V2 container. Blocks are either strings (text display),
 * `{ separator: true }`, or raw component builders.
 */
export function panel({ accentColor = '#7c6cff', blocks = [], rows = [] } = {}) {
  const container = new ContainerBuilder().setAccentColor(accentInt(accentColor));
  for (const block of blocks) {
    if (typeof block === 'string') container.addTextDisplayComponents(text(block));
    else if (block && block.separator) container.addSeparatorComponents(separator(block.spacing ?? 1));
    else if (block) container.addComponents(block);
  }
  for (const actionRow of rows) container.addActionRowComponents(actionRow);
  return container;
}

export function successPanel(message, extra = null) {
  return panel({
    accentColor: '#34d399',
    blocks: [`### ✅ ${message}`, ...(extra ? [extra] : [])],
  });
}

export function errorPanel(message, hint = null) {
  return panel({
    accentColor: '#fb7185',
    blocks: [`### ⚠️ ${message}`, ...(hint ? [hint] : [])],
  });
}

export function infoPanel(title, body) {
  return panel({ accentColor: '#7c6cff', blocks: [`### ${title}`, body] });
}

export function cv2Payload(components, { ephemeral = false } = {}) {
  return {
    components: Array.isArray(components) ? components : [components],
    flags: CV2_FLAG | (ephemeral ? MessageFlags.Ephemeral : 0),
  };
}

export async function replyCv2(interaction, components, { ephemeral = false } = {}) {
  const payload = cv2Payload(components, { ephemeral });
  if (interaction.deferred || interaction.replied) {
    const edit = { components: payload.components, flags: CV2_FLAG };
    return interaction.editReply(edit);
  }
  return interaction.reply(payload);
}

export async function updateCv2(interaction, components) {
  return interaction.update({ components: Array.isArray(components) ? components : [components], flags: CV2_FLAG });
}

export async function editReplyCv2(interaction, components) {
  return interaction.editReply({
    components: Array.isArray(components) ? components : [components],
    flags: CV2_FLAG,
  });
}

export async function followUpCv2(interaction, components, { ephemeral = false } = {}) {
  return interaction.followUp(cv2Payload(components, { ephemeral }));
}

export async function sendCv2(channel, components) {
  return channel.send(cv2Payload(components));
}

export async function editCv2(message, components) {
  return message.edit(cv2Payload(components));
}

export async function respond(interaction, components, { ephemeral = true } = {}) {
  try {
    return await replyCv2(interaction, components, { ephemeral });
  } catch (error) {
    if (error?.code === 40060 || error?.code === 10062) return null;
    throw error;
  }
}

export async function reactSafe(interaction, emoji) {
  try {
    await interaction.react(emoji);
  } catch {
    // Reactions are a nicety, never a failure path.
  }
}
