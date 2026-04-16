/**
 * Centralized state store with per-key change subscriptions.
 * Modules read/write state through this store instead of shared globals.
 */

const listeners = new Map();

const state = {
  USER_ID: null,
  currentUser: null,
  userProfile: null,
  tasks: { daily: [], weekly: [], backlog: [] },
  archivedBacklog: [],
  habits: {},
  character: {},
  goals: [],
  rewards: [],
  todayCompletions: new Set(),
};

/** Get a single state value by key. */
export function get(key) {
  return state[key];
}

/** Get the full state object (read-only reference). */
export function getAll() {
  return state;
}

/** Set a state value and notify subscribers. */
export function set(key, value) {
  state[key] = value;
  notify(key);
}

/** Update a state value via transform function and notify subscribers. */
export function update(key, fn) {
  state[key] = fn(state[key]);
  notify(key);
}

/**
 * Subscribe to changes on a specific key.
 * @returns {Function} Unsubscribe function.
 */
export function subscribe(key, callback) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(callback);
  return () => listeners.get(key).delete(callback);
}

function notify(key) {
  const set = listeners.get(key);
  if (set) set.forEach(cb => cb(state[key]));
}
