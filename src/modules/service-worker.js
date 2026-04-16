/**
 * Service worker registration and smart notifications.
 * Subscribes to events to keep SW in sync with completion state.
 */

import * as store from '../lib/store.js';
import * as events from '../lib/events.js';
import { showToast } from './ui.js';

let swReg = null;

export async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register('sw.js');
    console.log('SW registered');
    await requestNotificationPermission();
  } catch (e) {
    console.warn('SW registration failed:', e);
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      notifyServiceWorker({ type: 'PERMISSION_GRANTED' });
      showToast('🔔 Reminders enabled! We\'ll keep you on track.');
    }
  } else if (Notification.permission === 'granted') {
    notifyServiceWorker({ type: 'PERMISSION_GRANTED' });
  }
}

function notifyServiceWorker(msg) {
  if (!swReg || !swReg.active) return;
  swReg.active.postMessage(msg);
}

export function syncCompletionState() {
  const tasks = store.get('tasks');
  const todayCompletions = store.get('todayCompletions');

  const allDailyDone = tasks.daily.length > 0 && tasks.daily.every(t => todayCompletions.has(t.id));
  const allWeeklyDone = tasks.weekly.length > 0 && tasks.weekly.every(t => todayCompletions.has(t.id));
  const dailyRemaining = tasks.daily.filter(t => !todayCompletions.has(t.id)).length;
  const weeklyRemaining = tasks.weekly.filter(t => !todayCompletions.has(t.id)).length;

  notifyServiceWorker({
    type: 'COMPLETION_UPDATE',
    payload: { allDailyDone, allWeeklyDone, dailyRemaining, weeklyRemaining }
  });
}

/** Wire up event listeners. Call once during init. */
export function init() {
  events.on('task:completed', syncCompletionState);
  initServiceWorker();
}
