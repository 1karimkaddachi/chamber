import { cv2Payload, sendCv2 } from './ui.js';
import { fetchChannelById } from './discord.js';

export async function sendUserPanel(client, userId, components) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(cv2Payload(components));
    return true;
  } catch {
    return false;
  }
}

export async function sendChannelPanel(guild, channelId, components) {
  try {
    const channel = await fetchChannelById(guild, channelId);
    if (!channel?.isTextBased?.()) return null;
    return await sendCv2(channel, components);
  } catch {
    return null;
  }
}
