import { EventEmitter } from 'node:events';

/**
 * In-process event bus. The bot engine publishes domain events here and the
 * WebSocket hub fans them out to authenticated dashboard clients. Keeping the
 * bus in-process is intentional: the bot and API run in the same supervised
 * process, so there is no pub/sub infrastructure to operate.
 */
export const events = new EventEmitter();
events.setMaxListeners(50);

export function publish(type, payload = {}) {
  events.emit('domain', { type, payload, at: new Date().toISOString() });
}

export function onDomainEvent(handler) {
  events.on('domain', handler);
  return () => events.off('domain', handler);
}

export default events;
