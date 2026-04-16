/**
 * Task CRUD — create, edit, delete tasks. Modal management.
 */

import { sb } from '../lib/supabase.js';
import * as store from '../lib/store.js';
import * as events from '../lib/events.js';
import { showToast } from './ui.js';

const DIFF_DEFAULTS = {
  easy: { xp: 25, gold: 10 },
  med: { xp: 50, gold: 25 },
  hard: { xp: 100, gold: 50 },
};

let taskModalCat = 'daily';
let editingTaskId = null;
let selectedDiff = 'med';
let selectedPriority = 'P1';

export function openTaskModal(cat, task = null) {
  taskModalCat = cat;
  editingTaskId = task ? task.id : null;

  document.getElementById('taskModalTitle').textContent = task ? 'Edit Task' : 'Add Task';
  document.getElementById('taskName').value = task ? task.name : '';

  selectedDiff = task ? (task.difficulty || 'med') : 'med';
  renderDiffPicker();

  const def = DIFF_DEFAULTS[selectedDiff];
  document.getElementById('taskXP').value = task ? task.xp_reward : def.xp;
  document.getElementById('taskGold').value = task ? task.gold_reward : def.gold;

  const daysSection = document.getElementById('taskDaysSection');
  daysSection.style.display = cat === 'weekly' ? 'block' : 'none';
  if (cat === 'weekly') {
    const days = task?.days_of_week || [];
    document.querySelectorAll('#taskDaysSection input[type="checkbox"]').forEach(cb => {
      cb.checked = days.includes(parseInt(cb.value));
    });
  }

  const prioritySection = document.getElementById('taskPrioritySection');
  prioritySection.style.display = cat === 'backlog' ? 'block' : 'none';
  if (cat === 'backlog') {
    selectedPriority = task?.priority || 'P1';
    renderPriorityPicker();
  }

  document.getElementById('taskModalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('taskName').focus(), 300);
}

export function closeTaskModal(e) {
  if (e && e.target !== document.getElementById('taskModalOverlay')) return;
  document.getElementById('taskModalOverlay').classList.remove('open');
  editingTaskId = null;
}

export function selectDiff(diff) {
  selectedDiff = diff;
  renderDiffPicker();
  const def = DIFF_DEFAULTS[diff];
  document.getElementById('taskXP').value = def.xp;
  document.getElementById('taskGold').value = def.gold;
}

function renderDiffPicker() {
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.diff === selectedDiff);
  });
}

export function selectPriority(p) {
  selectedPriority = p;
  renderPriorityPicker();
}

function renderPriorityPicker() {
  document.querySelectorAll('.priority-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.p === selectedPriority);
  });
}

export async function saveTask() {
  const name = document.getElementById('taskName').value.trim();
  if (!name) { showToast('Please enter a task name.'); return; }

  const USER_ID = store.get('USER_ID');
  const xp = parseInt(document.getElementById('taskXP').value) || DIFF_DEFAULTS[selectedDiff].xp;
  const gold = parseFloat(document.getElementById('taskGold').value) || DIFF_DEFAULTS[selectedDiff].gold;

  let days_of_week = null;
  if (taskModalCat === 'weekly') {
    const checked = [...document.querySelectorAll('#taskDaysSection input[type="checkbox"]:checked')]
      .map(cb => parseInt(cb.value));
    days_of_week = checked.length > 0 ? checked : null;
  }

  const payload = {
    user_id: USER_ID,
    name,
    category: taskModalCat,
    difficulty: selectedDiff,
    xp_reward: xp,
    gold_reward: gold,
    is_active: true,
    days_of_week,
    priority: taskModalCat === 'backlog' ? selectedPriority : null,
  };

  const btn = document.getElementById('saveTaskBtn');
  btn.disabled = true;

  let error;
  if (editingTaskId) {
    ({ error } = await sb.from('tasks').update(payload).eq('id', editingTaskId).eq('user_id', USER_ID));
  } else {
    ({ error } = await sb.from('tasks').insert(payload));
  }

  btn.disabled = false;
  if (error) { showToast('❌ Failed to save task.'); return; }

  document.getElementById('taskModalOverlay').classList.remove('open');
  showToast(editingTaskId ? '✓ Task updated!' : '✓ Task added!');
  events.emit('state:reload');
}

export async function deleteTask(id) {
  const USER_ID = store.get('USER_ID');
  const { error } = await sb.from('tasks').update({ is_active: false }).eq('id', id).eq('user_id', USER_ID);
  if (error) { showToast('❌ Failed to delete task.'); return; }
  const todayCompletions = store.get('todayCompletions');
  todayCompletions.delete(id);
  store.set('todayCompletions', new Set(todayCompletions));
  events.emit('state:reload');
  showToast('Task removed.');
}

export function confirmDeleteTask(id, el) {
  const actions = el.querySelector('.task-actions');
  actions.innerHTML = `
    <span class="task-del-confirm">
      Delete?
      <button class="task-del-yes" onclick="window._deleteTask('${id}')">Yes</button>
      <button class="task-del-no" onclick="window._cancelDelete(this)">No</button>
    </span>`;
}

export function cancelDelete() {
  events.emit('render:all');
}

export function findTask(id) {
  const tasks = store.get('tasks');
  return [...tasks.daily, ...tasks.weekly, ...tasks.backlog].find(t => t.id === id);
}

export function taskById(id) {
  return findTask(id);
}
