/**
 * Game engine — core task completion loop, XP/streak logic, archive.
 * Emits events for side-effects; updates store for state changes.
 */

import { sb } from '../lib/supabase.js';
import * as store from '../lib/store.js';
import * as events from '../lib/events.js';
import { getStreakMultiplier, todayStr, getCharLevel } from '../lib/utils.js';
import { showToast, setSyncState, spawnRipple, spawnXPPopup, showLevelUpFlash } from './ui.js';
import { findTask } from './tasks.js';

let archiveOpen = false;

function checkLevelUp() {
  const character = store.get('character');
  const newLevel = getCharLevel(character.xp || 0);
  if (newLevel > (character.level || 1)) {
    character.level = newLevel;
    store.set('character', { ...character });
    showLevelUpFlash(newLevel);
  }
}

// Listen for level:check events from other modules (e.g., goals)
events.on('level:check', checkLevelUp);

export async function toggleTask(e, taskId, el) {
  const todayCompletions = store.get('todayCompletions');
  const isDone = todayCompletions.has(taskId);
  const task = findTask(taskId);
  if (!task) return;

  setSyncState('saving', 'Saving...');

  // Backlog tasks: complete -> archive (one-way)
  if (task.category === 'backlog' && !isDone) {
    await archiveBacklogTask(e, task, el);
    return;
  }

  const character = store.get('character');
  const tasks = store.get('tasks');
  const habits = store.get('habits');
  const USER_ID = store.get('USER_ID');

  if (!isDone) {
    const mult = getStreakMultiplier(character.streak || 0);
    const earnedXP = Math.round(task.xp_reward * mult);

    todayCompletions.add(taskId);
    store.set('todayCompletions', new Set(todayCompletions));
    el.classList.add('done');
    spawnRipple(e, el);
    spawnXPPopup(e, earnedXP);

    character.xp = (character.xp || 0) + earnedXP;
    character.gold = parseFloat(character.gold || 0) + parseFloat(task.gold_reward);
    character.total_completed = (character.total_completed || 0) + 1;
    checkLevelUp();
    store.set('character', { ...character });

    const today = todayStr();
    await Promise.all([
      sb.from('completions').insert({
        user_id: USER_ID, task_id: taskId,
        xp_earned: earnedXP, gold_earned: task.gold_reward,
        completed_date: today
      }),
      sb.from('character').update({
        xp: character.xp, gold: character.gold,
        total_completed: character.total_completed,
        last_active: today, last_activity_date: today,
      }).eq('user_id', USER_ID),
      sb.from('habits').update({
        current_streak: (habits[taskId]?.current_streak || 0) + 1,
        last_completed: today,
        total_completions: (habits[taskId]?.total_completions || 0) + 1
      }).eq('task_id', taskId).eq('user_id', USER_ID)
    ]);

    // Check if all dailies done -> streak + bonus
    if (tasks.daily.length > 0 && tasks.daily.every(t => todayCompletions.has(t.id))) {
      character.streak = (character.streak || 0) + 1;
      if (character.streak > (character.best_streak || 0)) character.best_streak = character.streak;

      character.xp = (character.xp || 0) + 50;

      const shieldMilestones = [7, 14, 30];
      const awardedMilestones = character.awarded_shield_milestones || [];
      let shieldAwarded = false;
      for (const m of shieldMilestones) {
        if (character.streak >= m && !awardedMilestones.includes(m)) {
          awardedMilestones.push(m);
          character.streak_shield = (character.streak_shield || 0) + 1;
          shieldAwarded = true;
        }
      }
      character.awarded_shield_milestones = awardedMilestones;

      await sb.from('character').update({
        streak: character.streak, best_streak: character.best_streak,
        xp: character.xp, streak_shield: character.streak_shield || 0,
        awarded_shield_milestones: awardedMilestones
      }).eq('user_id', USER_ID);

      store.set('character', { ...character });
      showToast('🔥 All dailies done! ' + character.streak + ' day streak!' + (shieldAwarded ? ' 🛡️ Shield earned!' : '') + ' +50 XP bonus!');
    } else if (mult > 1) {
      showToast('✨ ' + mult + '× streak bonus! +' + earnedXP + ' XP');
    }

  } else {
    // Undo (daily/weekly only)
    todayCompletions.delete(taskId);
    store.set('todayCompletions', new Set(todayCompletions));
    el.classList.remove('done');
    character.xp = Math.max(0, (character.xp || 0) - task.xp_reward);
    character.gold = Math.max(0, parseFloat(character.gold || 0) - parseFloat(task.gold_reward));
    store.set('character', { ...character });

    await Promise.all([
      sb.from('completions').delete().eq('user_id', USER_ID).eq('task_id', taskId).eq('completed_date', todayStr()),
      sb.from('character').update({ xp: character.xp, gold: character.gold }).eq('user_id', USER_ID)
    ]);
  }

  setSyncState('live', 'Live sync');
  events.emit('task:completed');
}

async function archiveBacklogTask(e, task, el) {
  const now = new Date();
  const archiveMonth = now.toISOString().slice(0, 7);
  const character = store.get('character');
  const mult = getStreakMultiplier(character.streak || 0);
  const earnedXP = Math.round(task.xp_reward * mult);
  const today = todayStr();
  const USER_ID = store.get('USER_ID');

  const todayCompletions = store.get('todayCompletions');
  todayCompletions.add(task.id);
  store.set('todayCompletions', new Set(todayCompletions));
  el.classList.add('done');
  spawnRipple(e, el);
  spawnXPPopup(e, earnedXP);

  character.xp = (character.xp || 0) + earnedXP;
  character.gold = parseFloat(character.gold || 0) + parseFloat(task.gold_reward);
  character.total_completed = (character.total_completed || 0) + 1;
  checkLevelUp();
  store.set('character', { ...character });

  // Move from active to archived
  const tasks = store.get('tasks');
  tasks.backlog = tasks.backlog.filter(t => t.id !== task.id);
  store.set('tasks', { ...tasks });

  const archived = { ...task, archived_at: now.toISOString(), archive_month: archiveMonth, completed_at: now.toISOString() };
  const archivedBacklog = store.get('archivedBacklog');
  archivedBacklog.unshift(archived);
  store.set('archivedBacklog', [...archivedBacklog]);

  await Promise.all([
    sb.from('completions').insert({
      user_id: USER_ID, task_id: task.id,
      xp_earned: earnedXP, gold_earned: task.gold_reward,
      completed_date: today,
    }),
    sb.from('character').update({
      xp: character.xp, gold: character.gold,
      total_completed: character.total_completed,
      last_active: today, last_activity_date: today,
    }).eq('user_id', USER_ID),
    sb.from('tasks').update({
      completed_at: now.toISOString(),
      archived_at: now.toISOString(),
      archive_month: archiveMonth,
    }).eq('id', task.id).eq('user_id', USER_ID),
  ]);

  setSyncState('live', 'Live sync');
  events.emit('task:completed');
  showToast('✅ Quest complete! Archived to history.');
}

export function toggleArchive() {
  archiveOpen = !archiveOpen;
  const listEl = document.getElementById('archiveList');
  const chevron = document.getElementById('archiveChevron');
  if (listEl) listEl.style.display = archiveOpen ? 'block' : 'none';
  if (chevron) chevron.classList.toggle('open', archiveOpen);
}

export async function permanentDeleteTask(id) {
  if (!confirm('Permanently delete this archived task? This cannot be undone.')) return;
  const USER_ID = store.get('USER_ID');
  const { error } = await sb.from('tasks').delete().eq('id', id).eq('user_id', USER_ID);
  if (error) { showToast('❌ Failed to delete.'); return; }
  const archivedBacklog = store.get('archivedBacklog').filter(t => t.id !== id);
  store.set('archivedBacklog', archivedBacklog);
  showToast('Task permanently deleted.');
}
