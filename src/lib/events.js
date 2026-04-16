/**
 * Simple pub/sub event bus for cross-module communication.
 * Modules emit and listen to events without importing each other.
 */

const handlers = new Map();

/**
 * Subscribe to an event.
 * @returns {Function} Unsubscribe function.
 */
export function on(event, handler) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(handler);
  return () => handlers.get(event).delete(handler);
}

/** Emit an event to all subscribers. */
export function emit(event, payload) {
  const set = handlers.get(event);
  if (set) set.forEach(h => h(payload));
}
