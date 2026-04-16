/**
 * Local cache (offline fallback).
 * Subscribes to store changes for auto-save; provides loadFromCache for boot.
 */

import * as store from '../lib/store.js';
import { todayStr } from '../lib/utils.js';

export function saveToCache() {
  try {
    const { tasks, archivedBacklog, habits, character, goals, rewards, todayCompletions } = store.getAll();
    localStorage.setItem('ql_cache', JSON.stringify({
      tasks, archivedBacklog, habits, character, goals, rewards,
      completions: [...todayCompletions],
      date: todayStr(),
    }));
  } catch (e) { /* quota exceeded — silently fail */ }
}

export function loadFromCache() {
  try {
    const c = JSON.parse(localStorage.getItem('ql_cache') || 'null');
    if (!c) return;
    store.set('tasks', c.tasks || { daily: [], weekly: [], backlog: [] });
    store.set('archivedBacklog', c.archivedBacklog || []);
    store.set('habits', c.habits || {});
    store.set('character', c.character || {});
    store.set('goals', c.goals || []);
    store.set('rewards', c.rewards || []);
    store.set('todayCompletions', new Set(c.date === todayStr() ? (c.completions || []) : []));
  } catch (e) { /* corrupted cache — silently fail */ }
}

/** Wire up auto-save on any state change. Call once during init. */
export function init() {
  ['tasks', 'archivedBacklog', 'habits', 'character', 'goals', 'rewards', 'todayCompletions']
    .forEach(key => store.subscribe(key, saveToCache));
}
