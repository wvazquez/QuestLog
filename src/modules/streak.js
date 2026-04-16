/**
 * Streak reset and shield logic.
 * Checks if the user missed a day and either uses a shield or resets the streak.
 */

import { sb } from '../lib/supabase.js';
import * as store from '../lib/store.js';
import { todayStr } from '../lib/utils.js';
import { showToast } from './ui.js';

export async function checkStreakReset() {
  const character = store.get('character');
  const lastActive = character.last_activity_date;
  if (!lastActive) return;
  const today = todayStr();
  if (lastActive >= today) return;
  const diff = Math.round((new Date(today) - new Date(lastActive)) / 86400000);
  if (diff <= 1) return;

  const USER_ID = store.get('USER_ID');
  if ((character.streak_shield || 0) > 0) {
    character.streak_shield = (character.streak_shield || 1) - 1;
    await sb.from('character').update({ streak_shield: character.streak_shield }).eq('user_id', USER_ID);
    store.set('character', { ...character });
    showToast('🛡️ Streak shield used! Streak protected.');
  } else if ((character.streak || 0) > 0) {
    character.streak = 0;
    await sb.from('character').update({ streak: 0 }).eq('user_id', USER_ID);
    store.set('character', { ...character });
    showToast('💔 Streak reset. Start again today!');
  }
}
