/**
 * Rewards — spend gold to unlock rewards.
 */

import { sb } from '../lib/supabase.js';
import * as store from '../lib/store.js';
import { escapeHtml } from '../lib/utils.js';
import { showToast } from './ui.js';

export async function buyReward(reward) {
  const character = store.get('character');
  if (parseFloat(character.gold) < reward.gold_cost) {
    showToast('❌ Need ' + reward.gold_cost + ' gold — you have ' + Math.floor(character.gold));
    return;
  }
  character.gold = parseFloat(character.gold) - reward.gold_cost;
  store.set('character', { ...character });

  const USER_ID = store.get('USER_ID');
  await Promise.all([
    sb.from('character').update({ gold: character.gold }).eq('user_id', USER_ID),
    sb.from('reward_redemptions').insert({ user_id: USER_ID, reward_id: reward.id, gold_spent: reward.gold_cost })
  ]);
  showToast(reward.icon + ' Unlocked: ' + reward.name + '!');
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
