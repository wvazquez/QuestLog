/**
 * Leaderboard — shows opted-in users ranked by XP.
 * Self-contained with its own cache.
 */

import { sb } from '../lib/supabase.js';
import * as store from '../lib/store.js';
import { getCharLevel, getCharTitle, escapeHtml } from '../lib/utils.js';
import { showToast } from './ui.js';

let leaderboardCache = null;
let leaderboardCacheTime = 0;

export async function loadLeaderboard() {
  const el = document.getElementById('leaderboardList');
  if (!el) return;

  // Cache for 5 minutes
  if (leaderboardCache && Date.now() - leaderboardCacheTime < 300000) {
    renderLeaderboard(leaderboardCache);
    return;
  }

  el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px">Loading...</div>';

  const { data, error } = await sb
    .from('profiles')
    .select('id, display_name, avatar_emoji, show_on_leaderboard')
    .eq('show_on_leaderboard', true);

  if (error || !data?.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;font-size:13px">No one on the leaderboard yet.<br>Enable the toggle above to appear!</div>';
    return;
  }

  const userIds = data.map(p => p.id);
  const { data: chars } = await sb.from('character').select('user_id,xp,streak,level').in('user_id', userIds);

  const rows = data.map(p => {
    const char = (chars || []).find(c => c.user_id === p.id) || {};
    return { ...p, xp: char.xp || 0, streak: char.streak || 0, level: char.level || getCharLevel(char.xp || 0) };
  }).sort((a, b) => b.xp - a.xp);

  leaderboardCache = rows;
  leaderboardCacheTime = Date.now();
  renderLeaderboard(rows);
}

export function renderLeaderboard(rows) {
  const el = document.getElementById('leaderboardList');
  if (!el) return;
  const USER_ID = store.get('USER_ID');
  el.innerHTML = rows.map((row, i) => {
    const rank = i + 1;
    const rankCls = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';
    const isMe = row.id === USER_ID;
    return `
      <div class="leaderboard-row${isMe ? ' me' : ''}">
        <div class="lb-rank ${rankCls}">${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}</div>
        <div class="lb-avatar">${row.avatar_emoji || '⚔️'}</div>
        <div class="lb-info">
          <div class="lb-name">${escapeHtml(row.display_name || 'Hero')}${isMe ? ' <span style="color:var(--accent);font-size:11px">(you)</span>' : ''}</div>
          <div class="lb-sub">${getCharTitle(row.level)} · Lv ${row.level}</div>
        </div>
        <div class="lb-stats">
          <div class="lb-stat"><strong>${row.xp.toLocaleString()}</strong>XP</div>
          <div class="lb-stat"><strong>${row.streak}🔥</strong>streak</div>
        </div>
      </div>`;
  }).join('');
}

export async function toggleLeaderboard(checked) {
  const userProfile = store.get('userProfile');
  if (!userProfile) return;
  const USER_ID = store.get('USER_ID');
  const { error } = await sb.from('profiles').update({ show_on_leaderboard: checked }).eq('id', USER_ID);
  if (error) { showToast('❌ Failed to update leaderboard setting.'); return; }
  userProfile.show_on_leaderboard = checked;
  store.set('userProfile', userProfile);
  leaderboardCache = null; // bust cache
  showToast(checked ? '🏅 You\'re now on the leaderboard!' : 'Removed from leaderboard.');
}
