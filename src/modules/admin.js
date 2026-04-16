/**
 * Admin panel — user management view (admin-only).
 * Self-contained with its own local state.
 */

import { sb } from '../lib/supabase.js';
import { escapeHtml } from '../lib/utils.js';

let adminData = { profiles: [], characters: [] };

export async function loadAdminData() {
  const el = document.getElementById('adminUserList');
  el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px">Loading...</div>';

  const [profilesRes, charsRes] = await Promise.all([
    sb.from('profiles').select('*').order('created_at'),
    sb.from('character').select('*'),
  ]);

  adminData.profiles = profilesRes.data || [];
  adminData.characters = charsRes.data || [];
  document.getElementById('adminUserCount').textContent = adminData.profiles.length;
  renderAdmin();
}

export function renderAdmin() {
  const el = document.getElementById('adminUserList');
  if (!adminData.profiles.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;font-size:13px">No users yet.</div>';
    return;
  }
  el.innerHTML = adminData.profiles.map(p => {
    const char = adminData.characters.find(c => c.user_id === p.id);
    const joined = new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `
      <div class="admin-user-card">
        <div class="admin-user-row">
          <div class="admin-avatar">${p.avatar_emoji || '⚔️'}</div>
          <div style="flex:1;min-width:0">
            <div class="admin-user-name">${escapeHtml(p.display_name || '—')}${p.is_admin ? '<span class="admin-badge">Admin</span>' : ''}</div>
            <div class="admin-user-email">${escapeHtml(p.email || '—')}</div>
          </div>
        </div>
        <div class="admin-user-stats">
          <div class="admin-stat">Level <strong>${char ? char.level || 1 : '—'}</strong></div>
          <div class="admin-stat">XP <strong>${char ? char.xp || 0 : '—'}</strong></div>
          <div class="admin-stat">Streak <strong>${char ? char.streak || 0 : '—'}🔥</strong></div>
          <div class="admin-stat">Completed <strong>${char ? char.total_completed || 0 : '—'}</strong></div>
          <div class="admin-stat">Joined <strong>${joined}</strong></div>
        </div>
      </div>
    `;
  }).join('');
}
