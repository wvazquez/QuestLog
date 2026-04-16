/**
 * Task CRUD — create, edit, delete tasks. Modal management.
 * Includes subtask support for weekly routines (parent-child hierarchy).
 */

import { sb } from '../lib/supabase.js';
import * as store from '../lib/store.js';
import * as events from '../lib/events.js';
import { escapeHtml } from '../lib/utils.js';
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

// Subtask state for the modal
let modalSubtasks = []; // [{name, id?}] — id present for existing subtasks

export function openTaskModal(cat, task = null) {
  taskModalCat = cat;
  editingTaskId = task ? task.id : null;

  const titleMap = {
    daily: { add: 'Add To-Do Item', edit: 'Edit To-Do Item', label: 'To-Do Name' },
    weekly: { add: 'Add Weekly Routine', edit: 'Edit Weekly Routine', label: 'Routine Name' },
    backlog: { add: 'Add Task', edit: 'Edit Task', label: 'Task Name' },
  };
  const labels = titleMap[cat] || titleMap.backlog;
  document.getElementById('taskModalTitle').textContent = task ? labels.edit : labels.add;
  document.getElementById('taskNameLabel').textContent = labels.label;
  document.getElementById('taskName').value = task ? task.name : '';

  selectedDiff = task ? (task.difficulty || 'med') : 'med';
  renderDiffPicker();

  const daysSection = document.getElementById('taskDaysSection');
  daysSection.style.display = cat === 'weekly' ? 'block' : 'none';
  if (cat === 'weekly') {
    const days = task?.days_of_week || [];
    document.querySelectorAll('#taskDaysSection input[type="checkbox"]').forEach(cb => {
      cb.checked = days.includes(parseInt(cb.value));
    });
  }

  // Subtasks section — show for weekly parent tasks (not subtasks themselves)
  const subtasksSection = document.getElementById('taskSubtasksSection');
  const isSubtask = task?.parent_id;
  const showSubtasks = cat === 'weekly' && !isSubtask;
  subtasksSection.style.display = showSubtasks ? 'block' : 'none';
  modalSubtasks = [];
  if (showSubtasks && editingTaskId) {
    // Load existing subtasks from store
    const tasks = store.get('tasks');
    const children = tasks.weekly.filter(t => t.parent_id === editingTaskId);
    modalSubtasks = children.map(t => ({ name: t.name, id: t.id }));
  }
  renderModalSubtasks();
  const subtaskInput = document.getElementById('newSubtaskInput');
  if (subtaskInput) subtaskInput.value = '';

  // Notes section — show for daily tasks
  const notesSection = document.getElementById('taskNotesSection');
  notesSection.style.display = cat === 'daily' ? 'block' : 'none';
  if (cat === 'daily') {
    document.getElementById('taskNotes').value = task?.notes || '';
  }

  const prioritySection = document.getElementById('taskPrioritySection');
  prioritySection.style.display = cat === 'backlog' ? 'block' : 'none';
  if (cat === 'backlog') {
    selectedPriority = task?.priority || 'P1';
    renderPriorityPicker();
  }

  // Show delete button only when editing an existing task
  const deleteBtn = document.getElementById('deleteTaskFromModalBtn');
  if (deleteBtn) deleteBtn.style.display = editingTaskId ? 'block' : 'none';

  // Show "Move to Today" button only when editing a backlog task
  const moveBtn = document.getElementById('moveToTodayBtn');
  if (moveBtn) moveBtn.style.display = (cat === 'backlog' && editingTaskId) ? 'block' : 'none';

  document.getElementById('taskModalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('taskName').focus(), 300);
}

export function closeTaskModal(e) {
  if (e && e.target !== document.getElementById('taskModalOverlay')) return;
  document.getElementById('taskModalOverlay').classList.remove('open');
  editingTaskId = null;
  modalSubtasks = [];
}

export function selectDiff(diff) {
  selectedDiff = diff;
  renderDiffPicker();
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

// ── Subtask modal helpers ──

export function addSubtaskToModal() {
  const input = document.getElementById('newSubtaskInput');
  const name = input.value.trim();
  if (!name) return;
  modalSubtasks.push({ name });
  input.value = '';
  renderModalSubtasks();
  input.focus();
}

export function removeSubtaskFromModal(index) {
  modalSubtasks.splice(index, 1);
  renderModalSubtasks();
}

export function renderModalSubtasks() {
  const list = document.getElementById('subtaskList');
  if (!list) return;
  if (modalSubtasks.length === 0) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = modalSubtasks.map((st, i) => `
    <div class="modal-subtask-row">
      <span class="modal-subtask-name">${escapeHtml(st.name)}</span>
      <button class="task-action-btn danger" title="Remove" onclick="removeSubtaskFromModal(${i})">✕</button>
    </div>
  `).join('');
}

// ── Save task ──

export async function saveTask() {
  const name = document.getElementById('taskName').value.trim();
  if (!name) { showToast('Please enter a task name.'); return; }

  const USER_ID = store.get('USER_ID');
  const xp = DIFF_DEFAULTS[selectedDiff].xp;
  const gold = DIFF_DEFAULTS[selectedDiff].gold;

  let days_of_week = null;
  if (taskModalCat === 'weekly') {
    const checked = [...document.querySelectorAll('#taskDaysSection input[type="checkbox"]:checked')]
      .map(cb => parseInt(cb.value));
    days_of_week = checked.length > 0 ? checked : null;
  }

  const notes = taskModalCat === 'daily' ? (document.getElementById('taskNotes').value.trim() || null) : null;

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
    notes,
  };

  const btn = document.getElementById('saveTaskBtn');
  btn.disabled = true;

  let error;
  let parentId = editingTaskId;

  if (editingTaskId) {
    ({ error } = await sb.from('tasks').update(payload).eq('id', editingTaskId).eq('user_id', USER_ID));
  } else {
    const { data, error: insertErr } = await sb.from('tasks').insert(payload).select('id').single();
    error = insertErr;
    if (data) parentId = data.id;
  }

  btn.disabled = false;
  if (error) { showToast('❌ Failed to save task.'); return; }

  // Handle subtasks for weekly parent tasks
  if (taskModalCat === 'weekly' && parentId) {
    await syncSubtasks(parentId, USER_ID, days_of_week);
  }

  document.getElementById('taskModalOverlay').classList.remove('open');
  showToast(editingTaskId ? '✓ Task updated!' : '✓ Task added!');
  events.emit('state:reload');
}

/**
 * Sync subtasks: create new ones, soft-delete removed ones.
 */
async function syncSubtasks(parentId, userId, daysOfWeek) {
  const tasks = store.get('tasks');
  const existingChildren = tasks.weekly.filter(t => t.parent_id === parentId);
  const existingIds = new Set(existingChildren.map(t => t.id));
  const keptIds = new Set(modalSubtasks.filter(st => st.id).map(st => st.id));

  // Soft-delete removed subtasks
  const toRemove = [...existingIds].filter(id => !keptIds.has(id));
  if (toRemove.length > 0) {
    await sb.from('tasks').update({ is_active: false }).in('id', toRemove).eq('user_id', userId);
  }

  // Insert new subtasks
  const toInsert = modalSubtasks
    .filter(st => !st.id)
    .map(st => ({
      user_id: userId,
      name: st.name,
      category: 'weekly',
      difficulty: selectedDiff,
      xp_reward: DIFF_DEFAULTS[selectedDiff].xp,
      gold_reward: DIFF_DEFAULTS[selectedDiff].gold,
      is_active: true,
      parent_id: parentId,
      days_of_week: daysOfWeek,
    }));

  if (toInsert.length > 0) {
    await sb.from('tasks').insert(toInsert);
  }
}

export async function deleteTask(id) {
  const USER_ID = store.get('USER_ID');
  // Also deactivate child subtasks
  const tasks = store.get('tasks');
  const children = tasks.weekly.filter(t => t.parent_id === id);
  const idsToDelete = [id, ...children.map(t => t.id)];

  const { error } = await sb.from('tasks').update({ is_active: false }).in('id', idsToDelete).eq('user_id', USER_ID);
  if (error) { showToast('❌ Failed to delete task.'); return; }
  const todayCompletions = store.get('todayCompletions');
  idsToDelete.forEach(tid => todayCompletions.delete(tid));
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

export async function moveBacklogToDaily() {
  if (!editingTaskId) return;
  const USER_ID = store.get('USER_ID');
  const { error } = await sb.from('tasks').update({
    category: 'daily',
    priority: null,
  }).eq('id', editingTaskId).eq('user_id', USER_ID);
  if (error) { showToast('❌ Failed to move task.'); return; }
  document.getElementById('taskModalOverlay').classList.remove('open');
  editingTaskId = null;
  events.emit('state:reload');
  showToast("⚡ Moved to Today's To-Do!");
}

export function deleteTaskFromModal() {
  if (!editingTaskId) return;
  document.getElementById('taskModalOverlay').classList.remove('open');
  deleteTask(editingTaskId);
  editingTaskId = null;
}
