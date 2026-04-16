/**
 * Calendar view — monthly calendar with task/goal dots.
 * Self-contained with its own navigation state.
 */

import * as store from '../lib/store.js';
import { escapeHtml } from '../lib/utils.js';

let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let calSelectedDay = null;

export function renderCalendar() {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  document.getElementById('calMonthLabel').textContent = months[calMonth] + ' ' + calYear;

  const grid = document.getElementById('calGrid');
  const today = new Date();
  const first = new Date(calYear, calMonth, 1);
  const days = new Date(calYear, calMonth + 1, 0).getDate();
  const startDow = first.getDay();

  const tasks = store.get('tasks');
  const goals = store.get('goals');

  grid.innerHTML = '';

  for (let i = 0; i < startDow; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day other-month';
    grid.appendChild(cell);
  }

  for (let d = 1; d <= days; d++) {
    const date = new Date(calYear, calMonth, d);
    const dow = date.getDay();
    const dateStr = date.toISOString().split('T')[0];
    const isToday = date.toDateString() === today.toDateString();
    const dailyTasks = isToday ? tasks.daily : [];
    const weeklyTasks = tasks.weekly.filter(t => !t.days_of_week || t.days_of_week.length === 0 || t.days_of_week.includes(dow));
    const goalsDue = goals.filter(g => (g.target_date || g.deadline || '').slice(0, 10) === dateStr);

    const hasDots = dailyTasks.length || weeklyTasks.length || goalsDue.length;

    const cell = document.createElement('div');
    cell.className = 'cal-day' + (isToday ? ' today' : '') + (hasDots ? ' has-events' : '');
    cell.innerHTML = `
      <div class="cal-day-num">${d}</div>
      <div class="cal-dots">
        ${dailyTasks.length ? '<div class="cal-dot daily"></div>' : ''}
        ${weeklyTasks.length ? '<div class="cal-dot weekly"></div>' : ''}
        ${goalsDue.length ? '<div class="cal-dot goal"></div>' : ''}
      </div>`;
    cell.onclick = () => calSelectDay(d, dateStr, dow, goalsDue);
    grid.appendChild(cell);
  }

  if (calSelectedDay !== null) calSelectDay(calSelectedDay, null, null, null);
}

export function calSelectDay(day, dateStr, dow, goalsDue) {
  calSelectedDay = day;
  const detail = document.getElementById('calDetail');
  const titleEl = document.getElementById('calDetailTitle');
  const itemsEl = document.getElementById('calDetailItems');
  if (!detail) return;

  const tasks = store.get('tasks');
  const goals = store.get('goals');

  if (!dateStr) {
    const date = new Date(calYear, calMonth, day);
    dow = date.getDay();
    dateStr = date.toISOString().split('T')[0];
    goalsDue = goals.filter(g => (g.target_date || g.deadline || '').slice(0, 10) === dateStr);
  }

  const selectedDate = new Date(calYear, calMonth, day);
  const isSelectedToday = selectedDate.toDateString() === new Date().toDateString();
  const dailies = isSelectedToday ? tasks.daily : [];
  const weeklies = tasks.weekly.filter(t => !t.days_of_week || t.days_of_week.length === 0 || t.days_of_week.includes(dow));
  const allItems = [
    ...dailies.map(t => ({ name: escapeHtml(t.name), type: 'daily', dot: 'daily' })),
    ...weeklies.map(t => ({ name: escapeHtml(t.name), type: 'weekly', dot: 'weekly' })),
    ...(goalsDue || []).map(g => ({ name: escapeHtml(g.title), type: 'goal deadline', dot: 'goal' })),
  ];

  detail.classList.add('open');
  titleEl.textContent = new Date(calYear, calMonth, day)
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  if (!allItems.length) {
    itemsEl.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">No tasks or deadlines.</div>';
  } else {
    const dailyItems = allItems.filter(i => i.type === 'daily');
    const weeklyItems = allItems.filter(i => i.type === 'weekly');
    const goalItems = allItems.filter(i => i.type === 'goal deadline');

    const renderItems = (items) => items.map(i => `
      <div class="cal-detail-item">
        <div class="cal-detail-dot cal-dot ${i.dot}"></div>
        <span>${escapeHtml(i.name)}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--muted)">${i.type}</span>
      </div>`).join('');

    let html = '';
    if (dailyItems.length) html += renderItems(dailyItems);
    if (weeklyItems.length) {
      html += `<div class="cal-routine-header" onclick="toggleCalRoutines()">
        <span>📅 Routines (${weeklyItems.length})</span>
        <span class="section-chevron" id="chevron-cal-routines">▼</span>
      </div>`;
      html += `<div id="list-cal-routines">${renderItems(weeklyItems)}</div>`;
    }
    if (goalItems.length) html += renderItems(goalItems);
    itemsEl.innerHTML = html;
  }
}

export function calPrev() {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  calSelectedDay = null;
  document.getElementById('calDetail').classList.remove('open');
  renderCalendar();
}

export function calNext() {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  calSelectedDay = null;
  document.getElementById('calDetail').classList.remove('open');
  renderCalendar();
}
