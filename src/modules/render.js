/**
 * Render pipeline — all DOM rendering functions.
 * Reads from store, never writes. init() sets up reactive subscriptions.
 */

import * as store from '../lib/store.js';
import {
  xpForLevel, getCharLevel, getCharTitle, escapeHtml, todayStr,
} from '../lib/utils.js';

const CIRC = 176;

let showAllWeekly = false;

const COLLAPSED_ROUTINES_KEY = 'questlog:collapsedRoutines';

function loadCollapsedRoutines() {
  try {
    const raw = localStorage.getItem(COLLAPSED_ROUTINES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedRoutines(set) {
  try {
    localStorage.setItem(COLLAPSED_ROUTINES_KEY, JSON.stringify([...set]));
  } catch {
    // quota / private mode — silently ignore, collapse state is non-critical
  }
}

let collapsedRoutines = loadCollapsedRoutines();

export function toggleRoutineCollapse(parentId) {
  if (collapsedRoutines.has(parentId)) {
    collapsedRoutines.delete(parentId);
  } else {
    collapsedRoutines.add(parentId);
  }
  saveCollapsedRoutines(collapsedRoutines);
  renderTaskList('weekly');
}

export function toggleShowAllWeekly() {
  showAllWeekly = !showAllWeekly;
  const btn = document.getElementById('showAllWeeklyBtn');
  if (btn) {
    btn.textContent = showAllWeekly ? 'Today Only' : 'Show All';
    btn.classList.toggle('active', showAllWeekly);
  }
  renderTaskList('weekly');
  renderCounts();
}

export function renderAll() {
  renderHeader();
  renderChar();
  renderStreak();
  renderRings();
  renderTaskList('daily');
  renderTaskList('weekly');
  renderTaskList('backlog');
  renderCompleted();
  renderCounts();
  renderStats();
  renderGoals();
  renderRewards();
}

export function renderHeader() {
  const d = new Date();
  document.getElementById('dayLabel').textContent =
    d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export function renderChar() {
  const character = store.get('character');
  const userProfile = store.get('userProfile');
  const totalXP = character.xp || 0;
  const lvl = getCharLevel(totalXP);
  character.level = lvl;
  const xpThisLevel = totalXP - xpForLevel(lvl);
  const xpNextLevel = xpForLevel(lvl + 1) - xpForLevel(lvl);
  const pct = lvl >= 50 ? 100 : Math.min(100, Math.round(xpThisLevel / xpNextLevel * 100));

  document.getElementById('levelBadge').textContent = 'Lv ' + lvl;
  document.getElementById('statXP').textContent = totalXP;
  document.getElementById('statHP').textContent = character.hp || 100;
  document.getElementById('statGold').textContent = Math.floor(character.gold || 0);
  document.getElementById('goldDisplay').textContent = Math.floor(character.gold || 0);
  document.getElementById('xpLabel').textContent = xpThisLevel + ' / ' + (lvl >= 50 ? 'MAX' : xpNextLevel);
  document.getElementById('xpBarFill').style.width = pct + '%';
  document.getElementById('charClass').textContent = getCharTitle(lvl);
  if (userProfile) document.getElementById('charName').textContent = userProfile.display_name || 'Hero';
}

export function renderStreak() {
  const character = store.get('character');
  const streak = character.streak || 0;
  const shield = character.streak_shield || 0;
  document.getElementById('streakCount').textContent = streak;
  const msgs = ['Complete all to-do items to start your streak!', 'Keep it up — you\'re building momentum!', 'Crushing it! Stay consistent!', 'Unstoppable streak incoming!', 'You are a habit legend!'];
  const idx = Math.min(Math.floor(streak / 3), msgs.length - 1);
  document.getElementById('streakMsg').textContent = msgs[idx];
  const shieldEl = document.getElementById('streakShield');
  const shieldCount = document.getElementById('shieldCount');
  if (shieldEl) {
    shieldEl.style.display = shield > 0 ? 'inline-flex' : 'none';
    if (shieldCount) shieldCount.textContent = shield;
  }
}

export function renderRings() {
  const tasks = store.get('tasks');
  const todayCompletions = store.get('todayCompletions');
  const dDone = tasks.daily.filter(t => todayCompletions.has(t.id)).length;
  const wDone = tasks.weekly.filter(t => todayCompletions.has(t.id)).length;
  const dPct = tasks.daily.length ? Math.round(dDone / tasks.daily.length * 100) : 0;
  const wPct = tasks.weekly.length ? Math.round(wDone / tasks.weekly.length * 100) : 0;
  setRing('ring-daily', 'ring-daily-pct', dPct);
  setRing('ring-weekly', 'ring-weekly-pct', wPct);
}

function setRing(id, pctId, pct) {
  document.getElementById(id).style.strokeDashoffset = CIRC - (CIRC * pct / 100);
  document.getElementById(pctId).textContent = pct + '%';
}

export function renderCounts() {
  const tasks = store.get('tasks');
  const todayCompletions = store.get('todayCompletions');
  const todayDow = new Date().getDay();
  ['daily', 'weekly', 'backlog'].forEach(cat => {
    let visible = tasks[cat];
    if (cat === 'weekly' && !showAllWeekly) {
      visible = tasks[cat].filter(t =>
        !t.days_of_week || t.days_of_week.length === 0 || t.days_of_week.includes(todayDow)
      );
    }
    const done = visible.filter(t => todayCompletions.has(t.id)).length;
    document.getElementById('count-' + cat).textContent = done + '/' + visible.length;
  });
}

export function renderTaskList(cat) {
  const tasks = store.get('tasks');
  const todayCompletions = store.get('todayCompletions');
  const habits = store.get('habits');

  const el = document.getElementById('list-' + cat);
  el.innerHTML = '';
  const todayDow = new Date().getDay();

  let visibleTasks = tasks[cat];

  if (cat === 'weekly' && !showAllWeekly) {
    visibleTasks = tasks[cat].filter(t => {
      if (!t.days_of_week || t.days_of_week.length === 0) return true;
      return t.days_of_week.includes(todayDow);
    });
  }

  if (cat === 'backlog') {
    const pOrder = { P1: 1, P2: 2, P3: 3, P4: 4 };
    visibleTasks = [...visibleTasks].sort((a, b) =>
      (pOrder[a.priority] || 5) - (pOrder[b.priority] || 5)
    );
  }

  // For weekly: separate parents from subtasks
  let parentTasks = visibleTasks;
  let subtaskMap = {};
  if (cat === 'weekly') {
    parentTasks = visibleTasks.filter(t => !t.parent_id);
    const subtasks = visibleTasks.filter(t => t.parent_id);
    subtasks.forEach(t => {
      if (!subtaskMap[t.parent_id]) subtaskMap[t.parent_id] = [];
      subtaskMap[t.parent_id].push(t);
    });
  }

  parentTasks.forEach(task => {
    const children = subtaskMap[task.id] || [];
    const hasSubtasks = children.length > 0;
    const childrenDone = children.filter(t => todayCompletions.has(t.id)).length;
    const done = todayCompletions.has(task.id);
    const habit = habits[task.id] || {};
    const isCollapsed = hasSubtasks && collapsedRoutines.has(task.id);
    const div = document.createElement('div');
    div.className = 'task' + (done ? ' done' : '');
    div.innerHTML = `
      <div class="task-check"><div class="check-icon">✓</div></div>
      <div class="task-body">
        <div class="task-name">${escapeHtml(task.name)}${hasSubtasks ? `<span class="subtask-progress">(${childrenDone}/${children.length})</span>` : ''}</div>
        <div class="task-meta">
          <span class="pill pill-xp">+${task.xp_reward} XP</span>
          <span class="pill pill-gold">+${task.gold_reward}g</span>
          ${task.priority ? `<span class="pill pill-${task.priority.toLowerCase()}">${task.priority}</span>` : ''}
          ${habit.current_streak > 0 ? `<span class="pill pill-streak">🔥${habit.current_streak}</span>` : ''}
        </div>
        ${task.notes ? `<div class="task-notes">${escapeHtml(task.notes)}</div>` : ''}
      </div>
      <div class="diff-dot diff-${task.difficulty}"></div>
      <div class="task-actions">
        ${hasSubtasks ? `<button class="task-action-btn routine-chevron${isCollapsed ? '' : ' open'}" title="${isCollapsed ? 'Expand' : 'Collapse'}" onclick="event.stopPropagation();window._toggleRoutineCollapse('${task.id}')">▸</button>` : ''}
        <button class="task-action-btn task-edit-btn" title="Edit" onclick="event.stopPropagation();window.openTaskModal('${cat}',window._taskById('${task.id}'))">✏️</button>
        <button class="task-action-btn danger task-delete-btn" title="Delete" onclick="event.stopPropagation();window._confirmDeleteTask('${task.id}',this.closest('.task'))">🗑️</button>
      </div>
    `;
    // Only allow direct toggle if no subtasks (subtask-driven tasks auto-complete)
    div.onclick = (e) => {
      if (e.target.closest('.task-actions')) return;
      if (!hasSubtasks) window._toggleTask(e, task.id, div);
    };
    el.appendChild(div);

    // Render subtasks indented below parent (unless collapsed)
    if (hasSubtasks && !isCollapsed) {
      const wrap = document.createElement('div');
      wrap.className = 'task-subtask-wrap';
      children.forEach(sub => {
        const subDone = todayCompletions.has(sub.id);
        const subDiv = document.createElement('div');
        subDiv.className = 'task subtask' + (subDone ? ' done' : '');
        subDiv.innerHTML = `
          <div class="task-check"><div class="check-icon">✓</div></div>
          <div class="task-body">
            <div class="task-name">${escapeHtml(sub.name)}</div>
          </div>
        `;
        subDiv.onclick = (e) => {
          window._toggleTask(e, sub.id, subDiv);
        };
        wrap.appendChild(subDiv);
      });
      el.appendChild(wrap);
    }
  });
}

export function renderStats() {
  const character = store.get('character');
  const tasks = store.get('tasks');
  const todayCompletions = store.get('todayCompletions');

  const row = document.getElementById('weekRow');
  if (!row) return;
  row.innerHTML = '';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayIdx = new Date().getDay();
  names.forEach((n, i) => {
    const isToday = i === todayIdx;
    const d = document.createElement('div');
    d.className = 'day-col';
    d.innerHTML = `<div class="day-circle${isToday ? ' today' : ''}">${isToday ? '⚡' : ''}</div><div class="day-name">${n}</div>`;
    row.appendChild(d);
  });

  document.getElementById('statTotal').textContent = character.total_completed || 0;
  document.getElementById('statBest').textContent = character.best_streak || 0;
  document.getElementById('statLvl').textContent = character.level || 1;

  const bars = document.getElementById('statBars');
  const cats = [
    { label: "Today's To-Do", cat: 'daily', color: 'var(--accent)' },
    { label: 'Weekly routines', cat: 'weekly', color: 'var(--accent3)' },
    { label: 'Backlog tasks', cat: 'backlog', color: 'var(--accent2)' },
  ];
  bars.innerHTML = cats.map(c => {
    const done = tasks[c.cat].filter(t => todayCompletions.has(t.id)).length;
    const total = tasks[c.cat].length || 1;
    const pct = Math.round(done / total * 100);
    return `<div class="bar-row">
      <div class="bar-label-row"><span>${c.label}</span><span class="bar-pct" style="color:${c.color}">${pct}%</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${c.color}"></div></div>
    </div>`;
  }).join('');
}

export function renderGoals() {
  const el = document.getElementById('goalsList');
  if (!el) return;
  const goals = store.get('goals');
  const tasks = store.get('tasks');
  const archivedBacklog = store.get('archivedBacklog');
  const todayCompletions = store.get('todayCompletions');

  if (!goals.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;font-size:13px">No active goals yet.<br>Tap + to add your first goal!</div>';
    return;
  }
  const GOAL_DIFF_REWARDS = { easy: { xp: 200, gold: 100 }, med: { xp: 500, gold: 250 }, hard: { xp: 1000, gold: 500 }, epic: { xp: 1500, gold: 750 } };
  el.innerHTML = goals.map(g => {
    const diff = g.difficulty || 'med';
    const rew = GOAL_DIFF_REWARDS[diff];
    const xpR = g.xp_reward ?? rew.xp;
    const goldR = g.gold_reward ?? rew.gold;
    const pct = g.progress || 0;
    const due = g.target_date || g.deadline;
    const linked = [...tasks.daily, ...tasks.weekly, ...tasks.backlog, ...archivedBacklog]
      .filter(t => t.goal_id === g.id);
    const subtaskHTML = linked.length ? `
      <div class="goal-subtasks">
        <div class="goal-subtask-title">Sub-tasks (${linked.filter(t => t.archived_at || todayCompletions.has(t.id)).length}/${linked.length})</div>
        ${linked.map(t => {
      const done = t.archived_at || todayCompletions.has(t.id);
      return `<div class="subtask-row${done ? ' done' : ''}">
            <div class="subtask-dot"></div>
            <span>${escapeHtml(t.name)}</span>
          </div>`;
    }).join('')}
      </div>` : '';
    return `
    <div class="goal-card">
      <div class="goal-top">
        <div class="goal-title">${escapeHtml(g.title)}</div>
        <div class="goal-actions">
          <button class="task-action-btn" title="Edit" onclick="window.openGoalModal(window._goalById('${g.id}'))">✏️</button>
          <button class="task-action-btn danger" title="Delete" onclick="window._deleteGoal('${g.id}')">🗑️</button>
        </div>
      </div>
      <div class="goal-badges">
        <span class="goal-badge cat">${g.category || 'personal'}</span>
        <span class="goal-badge diff-${diff}">${diff}</span>
        <span class="goal-badge horizon">${g.time_horizon || 'monthly'}</span>
      </div>
      ${g.description ? `<div class="goal-desc">${escapeHtml(g.description)}</div>` : ''}
      <div class="goal-bar"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
      <div class="goal-footer">
        <span>${pct}% complete</span>
        ${due ? `<span>Due ${new Date(due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>` : ''}
      </div>
      <div class="goal-rewards">
        <span class="goal-reward-pill xp">⚡ ${xpR} XP</span>
        <span class="goal-reward-pill gold">💰 ${goldR}g</span>
      </div>
      ${subtaskHTML}
      ${pct >= 100 ? `<button class="goal-complete-btn" onclick="window._completeGoal('${g.id}')">🏆 Claim Reward</button>` : ''}
    </div>`;
  }).join('');
}

export function renderRewards() {
  const el = document.getElementById('rewardGrid');
  if (!el) return;
  const rewards = store.get('rewards');
  el.innerHTML = rewards.map(r => `
    <div class="reward-card" onclick="window._buyReward(${JSON.stringify(r).replace(/"/g, '&quot;')})">
      <div class="reward-icon">${r.icon}</div>
      <div class="reward-name">${r.name}</div>
      <div class="reward-desc">${r.description || ''}</div>
      <div class="reward-cost">💰 ${r.gold_cost}g</div>
    </div>
  `).join('');
}

export function renderCompleted() {
  const archivedBacklog = store.get('archivedBacklog');
  const listEl = document.getElementById('list-completed');
  if (!listEl) return;

  if (archivedBacklog.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;color:var(--muted);padding:16px;font-size:13px">No completed items yet.</div>';
    return;
  }

  const groups = {};
  archivedBacklog.forEach(t => {
    const key = t.archive_month || t.archived_at?.slice(0, 7) || 'Unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });
  const months = Object.keys(groups).sort().reverse();

  listEl.innerHTML = months.map(month => {
    const [y, m] = month.split('-');
    const label = isNaN(+m) ? month : new Date(+y, +m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return `
      <div class="archive-month-header">${label}</div>
      ${groups[month].map(t => `
        <div class="archive-task">
          <div class="archive-task-check">✓</div>
          <div class="archive-task-body">
            <div class="archive-task-name">${escapeHtml(t.name)}</div>
            <div class="task-meta">
              <span class="pill pill-xp">+${t.xp_reward} XP</span>
              <span class="pill pill-gold">+${t.gold_reward}g</span>
              ${t.priority ? `<span class="pill pill-${t.priority.toLowerCase()}">${t.priority}</span>` : ''}
            </div>
          </div>
          <div class="archive-task-actions">
            <button class="task-action-btn archive-restore-btn" title="Restore to active" onclick="window._restoreArchivedTask('${t.id}')">↩</button>
            <button class="task-action-btn danger" title="Permanently delete" onclick="window._permanentDeleteTask('${t.id}')">🗑️</button>
          </div>
        </div>`).join('')}`;
  }).join('');
}

/** Wire up store subscriptions for reactive rendering. Call once during init. */
export function init() {
  store.subscribe('character', () => { renderChar(); renderStreak(); renderStats(); });
  store.subscribe('todayCompletions', () => { renderRings(); renderCounts(); });
  store.subscribe('tasks', () => {
    renderTaskList('daily');
    renderTaskList('weekly');
    renderTaskList('backlog');
    renderRings();
    renderCounts();
    renderStats();
  });
  store.subscribe('goals', renderGoals);
  store.subscribe('rewards', renderRewards);
  store.subscribe('archivedBacklog', renderCompleted);
}
