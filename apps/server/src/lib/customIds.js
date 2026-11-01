export const ids = {
  room: (action, roomId) => `room:${action}:${roomId}`,
  settings: (action, roomId) => `settings:${action}:${roomId}`,
  select: (action, roomId) => `sel:${action}:${roomId}`,
  modal: (action, roomId, extra = '') => `modal:${action}:${roomId}${extra ? `:${extra}` : ''}`,
  confirm: (action, roomId, extra = '') => `confirm:${action}:${roomId}${extra ? `:${extra}` : ''}`,
  cancel: (roomId) => `cancel:${roomId}`,
  waiting: (action, requestId) => `wait:${action}:${requestId}`,
  queue: (action, roomId) => `queue:${action}:${roomId}`,
  merge: (action, mergeId) => `merge:${action}:${mergeId}`,
  event: (action, eventId) => `event:${action}:${eventId}`,
  lobby: (action) => `lobby:${action}`,
  password: (action, roomId) => `pwd:${action}:${roomId}`,
  config: (action, guildId) => `cfg:${action}:${guildId}`,
};

export function parseId(customId) {
  return String(customId || '').split(':');
}

export const ID_PREFIXES = Object.freeze({
  ROOM: 'room',
  SETTINGS: 'settings',
  SELECT: 'sel',
  MODAL: 'modal',
  CONFIRM: 'confirm',
  CANCEL: 'cancel',
  WAITING: 'wait',
  QUEUE: 'queue',
  MERGE: 'merge',
  EVENT: 'event',
  LOBBY: 'lobby',
  PASSWORD: 'pwd',
  CONFIG: 'cfg',
});
