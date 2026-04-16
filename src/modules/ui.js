/**
 * UI utility functions — toasts, sync indicators, loading, animations, tab switching.
 * These are pure side-effects with no state dependencies.
 */

export function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2900);
}

export function setSyncState(state, msg) {
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncMsg');
  dot.className = 'sync-dot ' + state;
  txt.textContent = msg;
}

export function setLoading(msg) {
  const overlay = document.getElementById('loadingOverlay');
  if (!msg) {
    overlay.classList.add('hidden');
  } else {
    overlay.classList.remove('hidden');
    document.getElementById('loadingMsg').textContent = msg;
  }
}

export function spawnRipple(e, el) {
  const r = document.createElement('div');
  r.className = 'ripple';
  const rect = el.getBoundingClientRect();
  r.style.left = (e.clientX - rect.left) + 'px';
  r.style.top = (e.clientY - rect.top) + 'px';
  el.appendChild(r);
  setTimeout(() => r.remove(), 600);
}

export function spawnXPPopup(e, xp) {
  const p = document.createElement('div');
  p.className = 'xp-popup';
  p.textContent = '+' + xp + ' XP';
  p.style.left = e.clientX + 'px';
  p.style.top = (e.clientY - 10) + 'px';
  document.body.appendChild(p);
  setTimeout(() => p.remove(), 900);
}

import { getCharTitle } from '../lib/utils.js';

export function showLevelUpFlash(level) {
  const el = document.createElement('div');
  el.className = 'levelup-flash';
  el.innerHTML = `<div class="levelup-text">⬆️ Level ${level}!<br><span style="font-size:22px">${getCharTitle(level)}</span></div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

/**
 * Toggle collapse/expand of a section by ID.
 * Uses the list element's display style to track state.
 * @param {string} sectionId - Section identifier (daily, weekly, backlog, completed, cal-routines)
 */
export function toggleSectionCollapse(sectionId) {
  const list = document.getElementById('list-' + sectionId);
  const chevron = document.getElementById('chevron-' + sectionId);
  if (!list) return;
  const isHidden = list.style.display === 'none';
  list.style.display = isHidden ? '' : 'none';
  if (chevron) chevron.classList.toggle('open', isHidden);
}

/**
 * Switch between tab panes. Emits lazy-load calls for specific tabs.
 * @param {string} tab - Tab name (today, stats, goals, calendar, leaderboard, rewards, admin)
 * @param {Object} callbacks - Optional callbacks for lazy-loaded tabs
 */
export function switchTab(tab, callbacks = {}) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById('pane-' + tab);
  if (pane) {
    pane.style.display = '';
    pane.classList.add('active');
  }
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'admin' && callbacks.onAdmin)           callbacks.onAdmin();
  if (tab === 'calendar' && callbacks.onCalendar)      callbacks.onCalendar();
  if (tab === 'leaderboard' && callbacks.onLeaderboard) callbacks.onLeaderboard();
}
