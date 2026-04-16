/**
 * Goal CRUD — create, edit, delete, complete goals.
 */

import { sb } from '../lib/supabase.js';
import * as store from '../lib/store.js';
import * as events from '../lib/events.js';
import { showToast } from './ui.js';

const GOAL_DIFF_DEFAULTS = {
  easy: { xp: 200, gold: 100 },
  med: { xp: 500, gold: 250 },
  hard: { xp: 1000, gold: 500 },
  epic: { xp: 1500, gold: 750 },
};

let editingGoalId = null;
let selectedGoalDiff = 'med';

export function openGoalModal(goal = null) {
  editingGoalId = goal ? goal.id : null;
  selectedGoalDiff = goal?.difficulty || 'med';

  document.getElementById('goalModalTitle').textContent = goal ? 'Edit Goal' : 'Add Goal';
  document.getElementById('goalTitle').value = goal?.title || '';
  document.getElementById('goalDesc').value = goal?.description || '';
  document.getElementById('goalCat').value = goal?.category || 'personal';
  document.getElementById('goalHorizon').value = goal?.time_horizon || 'monthly';
  document.getElementById('goalDeadline').value = (goal?.target_date || goal?.deadline || '').slice(0, 10);

  const def = GOAL_DIFF_DEFAULTS[selectedGoalDiff];
  document.getElementById('goalXP').value = goal?.xp_reward ?? def.xp;
  document.getElementById('goalGold').value = goal?.gold_reward ?? def.gold;

  renderGoalDiffPicker();
  document.getElementById('goalModalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('goalTitle').focus(), 300);
}

export function closeGoalModal(e) {
  if (e && e.target !== document.getElementById('goalModalOverlay')) return;
  document.getElementById('goalModalOverlay').classList.remove('open');
  editingGoalId = null;
}

export function selectGoalDiff(diff) {
  selectedGoalDiff = diff;
  renderGoalDiffPicker();
  const def = GOAL_DIFF_DEFAULTS[diff];
  document.getElementById('goalXP').value = def.xp;
  document.getElementById('goalGold').value = def.gold;
}

function renderGoalDiffPicker() {
  document.querySelectorAll('#goalDiffPicker .diff-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.diff === selectedGoalDiff);
  });
}

export async function saveGoal() {
  const title = document.getElementById('goalTitle').value.trim();
  if (!title) { showToast('Please enter a goal title.'); return; }

  const USER_ID = store.get('USER_ID');
  const payload = {
    user_id: USER_ID,
    title,
    description: document.getElementById('goalDesc').value.trim() || null,
    category: document.getElementById('goalCat').value,
    time_horizon: document.getElementById('goalHorizon').value,
    difficulty: selectedGoalDiff,
    xp_reward: parseInt(document.getElementById('goalXP').value) || GOAL_DIFF_DEFAULTS[selectedGoalDiff].xp,
    gold_reward: parseFloat(document.getElementById('goalGold').value) || GOAL_DIFF_DEFAULTS[selectedGoalDiff].gold,
    target_date: document.getElementById('goalDeadline').value || null,
    status: 'active',
  };

  const btn = document.getElementById('saveGoalBtn');
  btn.disabled = true;
  let error;
  if (editingGoalId) {
    ({ error } = await sb.from('goals').update(payload).eq('id', editingGoalId).eq('user_id', USER_ID));
  } else {
    ({ error } = await sb.from('goals').insert(payload));
  }
  btn.disabled = false;
  if (error) { showToast('❌ Failed to save goal.'); return; }

  document.getElementById('goalModalOverlay').classList.remove('open');
  showToast(editingGoalId ? '✓ Goal updated!' : '✓ Goal added!');
  events.emit('state:reload');
}

export async function deleteGoal(id) {
  if (!confirm('Delete this goal?')) return;
  const USER_ID = store.get('USER_ID');
  const { error } = await sb.from('goals').update({ status: 'deleted' }).eq('id', id).eq('user_id', USER_ID);
  if (error) { showToast('❌ Failed to delete goal.'); return; }
  const goals = store.get('goals').filter(g => g.id !== id);
  store.set('goals', goals);
  showToast('Goal removed.');
}

export async function completeGoal(id) {
  const goals = store.get('goals');
  const goal = goals.find(g => g.id === id);
  if (!goal) return;

  const diff = goal.difficulty || 'med';
  const xpR = goal.xp_reward ?? GOAL_DIFF_DEFAULTS[diff].xp;
  const goldR = goal.gold_reward ?? GOAL_DIFF_DEFAULTS[diff].gold;

  const character = store.get('character');
  character.xp = (character.xp || 0) + xpR;
  character.gold = (parseFloat(character.gold) || 0) + goldR;
  store.set('character', { ...character });

  events.emit('level:check');

  const USER_ID = store.get('USER_ID');
  await Promise.all([
    sb.from('goals').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', id).eq('user_id', USER_ID),
    sb.from('character').update({ xp: character.xp, gold: character.gold }).eq('user_id', USER_ID),
  ]);

  store.set('goals', goals.filter(g => g.id !== id));
  showToast(`🏆 Goal complete! +${xpR} XP, +${goldR}g rewarded!`);
}

export function goalById(id) {
  return store.get('goals').find(g => g.id === id) || null;
}
