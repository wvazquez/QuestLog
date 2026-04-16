/**
 * Boot sequence — auth check, data loading, realtime subscription.
 * Populates the store and kicks off the app.
 */

import { sb } from '../lib/supabase.js';
import * as store from '../lib/store.js';
import * as events from '../lib/events.js';
import { todayStr } from '../lib/utils.js';
import { setLoading, setSyncState } from './ui.js';
import { loadProfile } from './auth.js';
import { checkStreakReset } from './streak.js';
import { startCountdown } from './countdown.js';
import { renderAll } from './render.js';
import { loadFromCache } from './cache.js';
import { syncCompletionState } from './service-worker.js';

export async function boot() {
  setLoading('Checking authentication...');

  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = 'landing.html';
    return;
  }
  store.set('currentUser', session.user);
  store.set('USER_ID', session.user.id);

  await loadProfile();

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.href = 'landing.html';
  });

  setLoading('Connecting to database...');
  try {
    await loadAll();
    await checkStreakReset();
    setSyncState('live', 'Live');
    subscribeRealtime();
    startCountdown();
    renderAll();
    setLoading(null);
    syncCompletionState();

    // Restore leaderboard toggle state
    const lbEl = document.getElementById('lbToggle');
    const userProfile = store.get('userProfile');
    if (lbEl && userProfile) lbEl.checked = !!userProfile.show_on_leaderboard;
  } catch (e) {
    setLoading('Connection error — working offline');
    setSyncState('error', 'Offline');
    loadFromCache();
    renderAll();
    setTimeout(() => setLoading(null), 1500);
  }
}

export async function loadAll() {
  const USER_ID = store.get('USER_ID');
  const today = todayStr();
  const [charRes, tasksRes, habitsRes, completionsRes, goalsRes, rewardsRes] = await Promise.all([
    sb.from('character').select('*').eq('user_id', USER_ID).single(),
    sb.from('tasks').select('*').eq('user_id', USER_ID).eq('is_active', true).order('sort_order'),
    sb.from('habits').select('*').eq('user_id', USER_ID),
    sb.from('completions').select('task_id').eq('user_id', USER_ID).eq('completed_date', today),
    sb.from('goals').select('*').eq('user_id', USER_ID).eq('status', 'active').order('created_at'),
    sb.from('rewards').select('*').eq('user_id', USER_ID).eq('is_active', true).order('sort_order'),
  ]);

  if (charRes.error) throw charRes.error;

  store.set('character', charRes.data);
  store.set('goals', goalsRes.data || []);
  store.set('rewards', rewardsRes.data || []);

  const habits = {};
  (habitsRes.data || []).forEach(h => { habits[h.task_id] = h; });
  store.set('habits', habits);

  store.set('todayCompletions', new Set((completionsRes.data || []).map(c => c.task_id)));

  const all = tasksRes.data || [];
  store.set('tasks', {
    daily: all.filter(t => t.category === 'daily'),
    weekly: all.filter(t => t.category === 'weekly'),
    backlog: all.filter(t => t.category === 'backlog' && !t.archived_at),
  });
  store.set('archivedBacklog',
    all.filter(t => t.category === 'backlog' && t.archived_at)
      .sort((a, b) => new Date(b.archived_at) - new Date(a.archived_at))
  );
}

function subscribeRealtime() {
  const USER_ID = store.get('USER_ID');
  sb.channel('questlog')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'character' }, payload => {
      if (payload.new && payload.new.user_id === USER_ID) {
        store.set('character', payload.new);
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'completions' }, () => {
      loadAll().then(renderAll);
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') setSyncState('live', 'Live sync');
    });
}

// Listen for reload requests from other modules (e.g., after task/goal CRUD)
events.on('state:reload', async () => {
  await loadAll();
  renderAll();
});

// Listen for render:all requests
events.on('render:all', renderAll);
