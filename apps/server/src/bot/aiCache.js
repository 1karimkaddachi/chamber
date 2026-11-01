const cache = new Map();
const TTL = 15 * 60 * 1000;

export function setSuggestion(roomId, userId, suggestion) {
  cache.set(`${roomId}:${userId}`, { suggestion, at: Date.now() });
}

export function getSuggestion(roomId, userId) {
  const key = `${roomId}:${userId}`;
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL) {
    cache.delete(key);
    return null;
  }
  return entry.suggestion;
}

export function clearSuggestions() {
  cache.clear();
}
