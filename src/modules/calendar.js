/**
 * Calendar view — monthly calendar with task/goal dots.
 * Self-contained with its own navigation state.
 */

import * as store from '../lib/store.js';
import { escapeHtml } from '../lib/utils.js';

let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let calSelectedDay = null;

// Transient per-routine expand state for the detail panel. Resets on day
// change, month change, and page reload — intentionally not persisted.
let expandedCalRoutines = new Set();

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
  if (day !== calSelectedDay) {
    expandedCalRoutines.clear();
  }
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
  const todayCompletions = store.get('todayCompletions');
  const dailies = isSelectedToday ? tasks.daily : [];
  const weeklies = tasks.weekly.filter(t => !t.days_of_week || t.days_of_week.length === 0 || t.days_of_week.includes(dow));

  // Split weekly routines into parents and subtasks keyed by parent_id.
  const weeklyParents = weeklies.filter(t => !t.parent_id);
  const weeklySubtaskMap = {};
  weeklies.filter(t => t.parent_id).forEach(t => {
    if (!weeklySubtaskMap[t.parent_id]) weeklySubtaskMap[t.parent_id] = [];
    weeklySubtaskMap[t.parent_id].push(t);
  });

  detail.classList.add('open');
  titleEl.textContent = new Date(calYear, calMonth, day)
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const hasAnything = dailies.length || weeklyParents.length || (goalsDue && goalsDue.length);

  if (!hasAnything) {
    itemsEl.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">No tasks or deadlines.</div>';
  } else {
    const renderFlatItem = (name, type, dot) => `
      <div class="cal-detail-item">
        <div class="cal-detail-dot cal-dot ${dot}"></div>
        <span>${escapeHtml(name)}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--muted)">${type}</span>
      </div>`;

    const renderRoutineParent = (parent) => {
      const children = weeklySubtaskMap[parent.id] || [];
      const hasSubtasks = children.length > 0;
      const isExpanded = expandedCalRoutines.has(parent.id);
      const progress = hasSubtasks && isSelectedToday
        ? ` <span class="subtask-progress">(${children.filter(c => todayCompletions.has(c.id)).length}/${children.length})</span>`
        : '';
      const chevron = hasSubtasks
        ? `<button class="cal-routine-chevron${isExpanded ? ' open' : ''}" title="${isExpanded ? 'Collapse' : 'Expand'}" onclick="event.stopPropagation();window.toggleCalRoutineExpand('${parent.id}')">▸</button>`
        : '';
      const parentRow = `
        <div class="cal-detail-item">
          <div class="cal-detail-dot cal-dot weekly"></div>
          <span>${escapeHtml(parent.name)}${progress}</span>
          <span style="margin-left:auto;font-size:11px;color:var(--muted)">weekly</span>
          ${chevron}
        </div>`;
      const subtaskRows = (hasSubtasks && isExpanded)
        ? children.map(sub => `
            <div class="cal-detail-item cal-detail-subtask">
              <div class="cal-detail-dot cal-dot weekly"></div>
              <span>${escapeHtml(sub.name)}</span>
            </div>`).join('')
        : '';
      return parentRow + subtaskRows;
    };

    let html = '';
    dailies.forEach(t => { html += renderFlatItem(t.name, 'daily', 'daily'); });
    if (weeklyParents.length) {
      html += `<div class="cal-routine-header" onclick="toggleCalRoutines()">
        <span>📅 Routines (${weeklyParents.length})</span>
        <span class="section-chevron open" id="chevron-cal-routines">▼</span>
      </div>`;
      html += `<div id="list-cal-routines">${weeklyParents.map(renderRoutineParent).join('')}</div>`;
    }
    (goalsDue || []).forEach(g => { html += renderFlatItem(g.title, 'goal deadline', 'goal'); });
    itemsEl.innerHTML = html;
  }
}

export function calPrev() {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  calSelectedDay = null;
  expandedCalRoutines.clear();
  document.getElementById('calDetail').classList.remove('open');
  renderCalendar();
}

export function calNext() {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  calSelectedDay = null;
  expandedCalRoutines.clear();
  document.getElementById('calDetail').classList.remove('open');
  renderCalendar();
}

export function toggleCalRoutineExpand(parentId) {
  if (expandedCalRoutines.has(parentId)) {
    expandedCalRoutines.delete(parentId);
  } else {
    expandedCalRoutines.add(parentId);
  }
  if (calSelectedDay !== null) {
    calSelectDay(calSelectedDay, null, null, null);
  }
}
