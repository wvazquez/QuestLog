/**
 * Auth, profile, settings, and account deletion.
 */

import { sb, SUPABASE_URL } from '../lib/supabase.js';
import * as store from '../lib/store.js';
import { showToast } from './ui.js';

export async function loadProfile() {
  const currentUser = store.get('currentUser');
  const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  store.set('userProfile', data);

  const name = data?.display_name || currentUser.email?.split('@')[0] || 'Hero';
  const initial = name.charAt(0).toUpperCase();
  document.getElementById('userBtn').textContent = initial;
  document.getElementById('menuName').textContent = name;
  document.getElementById('menuEmail').textContent = currentUser.email || '';

  // Show admin tab if admin
  if (data?.is_admin) {
    document.getElementById('tab-admin').style.display = '';
    document.getElementById('pane-admin').style.display = 'none';
  }
}

export function toggleUserMenu() {
  const menu = document.getElementById('userMenu');
  menu.classList.toggle('open');
}

// Close user menu on outside click
document.addEventListener('click', (e) => {
  const btn = document.getElementById('userBtn');
  const menu = document.getElementById('userMenu');
  if (btn && menu && !btn.contains(e.target) && !menu.contains(e.target)) {
    menu.classList.remove('open');
  }
});

export function confirmLogout() {
  document.getElementById('userMenu').classList.remove('open');
  if (confirm('Log out of QuestLog?')) logout();
}

export async function logout() {
  await sb.auth.signOut();
  window.location.href = 'landing.html';
}

export function openSettings() {
  const userProfile = store.get('userProfile');
  document.getElementById('userMenu').classList.remove('open');
  document.getElementById('settingsName').value = userProfile?.display_name || '';
  document.getElementById('settingsOverlay').classList.add('open');
}

export function closeSettings(e) {
  if (e && e.target !== document.getElementById('settingsOverlay')) return;
  document.getElementById('settingsOverlay').classList.remove('open');
}

export async function saveSettings() {
  const currentUser = store.get('currentUser');
  const name = document.getElementById('settingsName').value.trim();
  if (!name) { showToast('Please enter a name.'); return; }
  const { error } = await sb.from('profiles').update({ display_name: name }).eq('id', currentUser.id);
  if (error) { showToast('❌ Failed to save.'); return; }

  const userProfile = store.get('userProfile');
  userProfile.display_name = name;
  store.set('userProfile', { ...userProfile });

  document.getElementById('charName').textContent = name;
  document.getElementById('userBtn').textContent = name.charAt(0).toUpperCase();
  document.getElementById('menuName').textContent = name;
  document.getElementById('settingsOverlay').classList.remove('open');
  showToast('✓ Profile updated!');
}

export function openDeleteAccount() {
  document.getElementById('settingsOverlay').classList.remove('open');
  document.getElementById('deleteConfirmInput').value = '';
  document.getElementById('deleteOverlay').classList.add('open');
}

export function closeDeleteAccount(e) {
  if (e && e.target !== document.getElementById('deleteOverlay')) return;
  document.getElementById('deleteOverlay').classList.remove('open');
}

export async function handleDeleteAccount() {
  const val = document.getElementById('deleteConfirmInput').value.trim().toLowerCase();
  if (val !== 'delete') {
    showToast('Type "delete" to confirm.');
    return;
  }
  const btn = document.getElementById('btnDeleteAccount');
  btn.disabled = true;
  btn.textContent = 'Deleting...';

  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  });
  const json = await res.json();

  if (!res.ok || json.error) {
    btn.disabled = false;
    btn.textContent = 'Delete Everything';
    showToast('❌ ' + (json.error || 'Deletion failed.'));
    return;
  }

  await sb.auth.signOut();
  window.location.href = 'landing.html';
}
