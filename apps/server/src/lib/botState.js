let state = {
  client: null,
  online: false,
  tag: null,
  id: null,
  startedAt: null,
  guildCount: 0,
};

export function setClient(client) {
  state.client = client;
}

export function getClient() {
  return state.client;
}

export function markOnline(client) {
  state.client = client;
  state.online = true;
  state.tag = client.user?.tag ?? null;
  state.id = client.user?.id ?? null;
  state.startedAt = new Date().toISOString();
  state.guildCount = client.guilds?.cache?.size ?? 0;
}

export function markOffline() {
  state.online = false;
  state.tag = null;
  state.id = null;
  state.guildCount = 0;
}

export function getBotState() {
  return { ...state };
}

export function isBotOnline() {
  return state.online && Boolean(state.client);
}
