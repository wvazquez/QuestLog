import './styles/app.css'
import { sb, SUPABASE_URL } from './lib/supabase.js'

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════
let USER_ID = null; // set after auth check
const CIRC = 176;

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let tasks = { daily: [], weekly: [], backlog: [] };
let habits = {};      // task_id → habit row
let character = {};
let goals = [];
let rewards = [];
let todayCompletions = new Set(); // task_ids completed today
let currentUser = null;   // auth user object
let userProfile = null;   // profiles table row

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
async function boot() {
  setLoading('Checking authentication...');

  // ── Auth guard ──────────────────────────────────────────
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = 'landing.html';
    return;
  }
  currentUser = session.user;
  USER_ID = session.user.id;

  // Load profile (display name, admin flag)
  await loadProfile();

  // Sign-out redirect
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.href = 'landing.html';
  });

  setLoading('Connecting to database...');
  try {
    await loadAll();
    setSyncState('live', 'Live');
    subscribeRealtime();
    startCountdown();
    renderAll();
    setLoading(null);
    syncCompletionState();
  } catch(e) {
    setLoading('Connection error — working offline');
    setSyncState('error', 'Offline');
    loadFromCache();
    setTimeout(() => setLoading(null), 1500);
  }
}

async function loadAll() {
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

  character = charRes.data;
  goals = goalsRes.data || [];
  rewards = rewardsRes.data || [];

  // Index habits by task_id
  habits = {};
  (habitsRes.data || []).forEach(h => { habits[h.task_id] = h; });

  // Today's completions set
  todayCompletions = new Set((completionsRes.data || []).map(c => c.task_id));

  // Sort tasks into categories
  const all = tasksRes.data || [];
  tasks.daily   = all.filter(t => t.category === 'daily');
  tasks.weekly  = all.filter(t => t.category === 'weekly');
  tasks.backlog = all.filter(t => t.category === 'backlog');

  saveToCache();
}

// ═══════════════════════════════════════════════════════════
// REALTIME SUBSCRIPTION
// ═══════════════════════════════════════════════════════════
function subscribeRealtime() {
  sb.channel('questlog')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'character' }, payload => {
      if (payload.new && payload.new.user_id === USER_ID) {
        character = payload.new;
        renderChar();
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'completions' }, () => {
      loadAll().then(renderAll);
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') setSyncState('live', 'Live sync');
    });
}

// ═══════════════════════════════════════════════════════════
// COMPLETE / UNDO TASK
// ═══════════════════════════════════════════════════════════
async function toggleTask(e, taskId, el) {
  const isDone = todayCompletions.has(taskId);
  const task = findTask(taskId);
  if (!task) return;

  setSyncState('saving', 'Saving...');

  if (!isDone) {
    // Mark complete
    todayCompletions.add(taskId);
    el.classList.add('done');
    spawnRipple(e, el);
    spawnXPPopup(e, task.xp_reward);

    // Optimistic UI update
    character.xp = (character.xp || 0) + task.xp_reward;
    character.gold = parseFloat(character.gold || 0) + parseFloat(task.gold_reward);
    character.total_completed = (character.total_completed || 0) + 1;
    checkLevelUp();
    renderChar();
    renderRings();
    renderCounts();

    // Persist to Supabase
    await Promise.all([
      sb.from('completions').insert({
        user_id: USER_ID, task_id: taskId,
        xp_earned: task.xp_reward, gold_earned: task.gold_reward,
        completed_date: todayStr()
      }),
      sb.from('character').update({
        xp: character.xp,
        gold: character.gold,
        total_completed: character.total_completed,
        last_active: todayStr()
      }).eq('user_id', USER_ID),
      sb.from('habits').update({
        current_streak: (habits[taskId]?.current_streak || 0) + 1,
        last_completed: todayStr(),
        total_completions: (habits[taskId]?.total_completions || 0) + 1
      }).eq('task_id', taskId).eq('user_id', USER_ID)
    ]);

    // Check if all dailies done → streak
    if (tasks.daily.every(t => todayCompletions.has(t.id))) {
      character.streak = (character.streak || 0) + 1;
      if (character.streak > (character.best_streak || 0)) character.best_streak = character.streak;
      await sb.from('character').update({ streak: character.streak, best_streak: character.best_streak }).eq('user_id', USER_ID);
      showToast('🔥 All dailies done! ' + character.streak + ' day streak!');
    }

  } else {
    // Undo
    todayCompletions.delete(taskId);
    el.classList.remove('done');
    character.xp = Math.max(0, (character.xp || 0) - task.xp_reward);
    character.gold = Math.max(0, parseFloat(character.gold || 0) - parseFloat(task.gold_reward));
    renderChar(); renderRings(); renderCounts();

    await Promise.all([
      sb.from('completions').delete().eq('user_id', USER_ID).eq('task_id', taskId).eq('completed_date', todayStr()),
      sb.from('character').update({ xp: character.xp, gold: character.gold }).eq('user_id', USER_ID)
    ]);
  }

  setSyncState('live', 'Live sync');
  saveToCache();
  syncCompletionState();
}

// ═══════════════════════════════════════════════════════════
// REWARDS
// ═══════════════════════════════════════════════════════════
async function buyReward(reward) {
  if (parseFloat(character.gold) < reward.gold_cost) {
    showToast('❌ Need ' + reward.gold_cost + ' gold — you have ' + Math.floor(character.gold));
    return;
  }
  character.gold = parseFloat(character.gold) - reward.gold_cost;
  renderChar();
  await Promise.all([
    sb.from('character').update({ gold: character.gold }).eq('user_id', USER_ID),
    sb.from('reward_redemptions').insert({ user_id: USER_ID, reward_id: reward.id, gold_spent: reward.gold_cost })
  ]);
  showToast(reward.icon + ' Unlocked: ' + reward.name + '!');
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function renderAll() {
  renderHeader();
  renderChar();
  renderStreak();
  renderRings();
  renderTaskList('daily');
  renderTaskList('weekly');
  renderTaskList('backlog');
  renderCounts();
  renderStats();
  renderGoals();
  renderRewards();
}

function renderHeader() {
  const d = new Date();
  document.getElementById('dayLabel').textContent =
    d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
}

function renderChar() {
  const xpInLevel = (character.xp || 0) % 100;
  const lvl = Math.floor((character.xp || 0) / 100) + 1;
  character.level = lvl;
  document.getElementById('levelBadge').textContent = 'Lv ' + lvl;
  document.getElementById('statXP').textContent = character.xp || 0;
  document.getElementById('statHP').textContent = character.hp || 100;
  document.getElementById('statGold').textContent = Math.floor(character.gold || 0);
  document.getElementById('goldDisplay').textContent = Math.floor(character.gold || 0);
  document.getElementById('xpLabel').textContent = xpInLevel + ' / 100';
  document.getElementById('xpBarFill').style.width = xpInLevel + '%';
  const classes = ['Warrior of Habits','Guardian of Goals','Champion of Streaks','Master of Consistency','Legendary Hero'];
  document.getElementById('charClass').textContent = classes[Math.min(lvl - 1, classes.length - 1)];
  if (userProfile) document.getElementById('charName').textContent = userProfile.display_name || 'Hero';
}

function renderStreak() {
  document.getElementById('streakCount').textContent = character.streak || 0;
  const msgs = ['Complete all dailies to start your streak!','Keep it up — you\'re building momentum!','Crushing it! Stay consistent!','Unstoppable streak incoming!','You are a habit legend!'];
  const idx = Math.min(Math.floor((character.streak || 0) / 3), msgs.length - 1);
  document.getElementById('streakMsg').textContent = msgs[idx];
}

function renderRings() {
  const dDone = tasks.daily.filter(t => todayCompletions.has(t.id)).length;
  const wDone = tasks.weekly.filter(t => todayCompletions.has(t.id)).length;
  const dPct = tasks.daily.length ? Math.round(dDone / tasks.daily.length * 100) : 0;
  const wPct = tasks.weekly.length ? Math.round(wDone / tasks.weekly.length * 100) : 0;
  setRing('ring-daily', 'ring-daily-pct', dPct);
  setRing('ring-weekly', 'ring-weekly-pct', wPct);
}

function setRing(id, pctId, pct) {
  document.getElementById(id).style.strokeDashoffset = CIRC - (CIRC * pct / 100);
  document.getElementById(pctId).textContent = pct + '%';
}

function renderCounts() {
  ['daily','weekly','backlog'].forEach(cat => {
    const done = tasks[cat].filter(t => todayCompletions.has(t.id)).length;
    document.getElementById('count-' + cat).textContent = done + '/' + tasks[cat].length;
  });
}

function renderTaskList(cat) {
  const el = document.getElementById('list-' + cat);
  el.innerHTML = '';
  tasks[cat].forEach(task => {
    const done = todayCompletions.has(task.id);
    const habit = habits[task.id] || {};
    const div = document.createElement('div');
    div.className = 'task' + (done ? ' done' : '');
    div.innerHTML = `
      <div class="task-check"><div class="check-icon">✓</div></div>
      <div class="task-body">
        <div class="task-name">${task.name}</div>
        <div class="task-meta">
          <span class="pill pill-xp">+${task.xp_reward} XP</span>
          <span class="pill pill-gold">+${task.gold_reward}g</span>
          ${task.priority ? `<span class="pill pill-${task.priority.toLowerCase()}">${task.priority}</span>` : ''}
          ${habit.current_streak > 0 ? `<span class="pill pill-streak">🔥${habit.current_streak}</span>` : ''}
        </div>
      </div>
      <div class="diff-dot diff-${task.difficulty}"></div>
    `;
    div.onclick = (e) => toggleTask(e, task.id, div);
    el.appendChild(div);
  });
}

function renderStats() {
  // Week row
  const row = document.getElementById('weekRow');
  if (!row) return;
  row.innerHTML = '';
  const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const todayIdx = new Date().getDay();
  names.forEach((n, i) => {
    const isToday = i === todayIdx;
    const d = document.createElement('div');
    d.className = 'day-col';
    d.innerHTML = `<div class="day-circle${isToday?' today':''}">${isToday?'⚡':''}</div><div class="day-name">${n}</div>`;
    row.appendChild(d);
  });

  // All-time
  document.getElementById('statTotal').textContent = character.total_completed || 0;
  document.getElementById('statBest').textContent = character.best_streak || 0;
  document.getElementById('statLvl').textContent = character.level || 1;

  // Bars
  const bars = document.getElementById('statBars');
  const cats = [
    { label: 'Daily habits',    cat: 'daily',   color: 'var(--accent)' },
    { label: 'Weekly routines', cat: 'weekly',  color: 'var(--accent3)' },
    { label: 'Backlog tasks',   cat: 'backlog', color: 'var(--accent2)' },
  ];
  bars.innerHTML = cats.map(c => {
    const done = tasks[c.cat].filter(t => todayCompletions.has(t.id)).length;
    const total = tasks[c.cat].length || 1;
    const pct = Math.round(done / total * 100);
    return `<div class="bar-row">
      <div class="bar-label-row"><span>${c.label}</span><span class="bar-pct" style="color:${c.color}">${pct}%</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${c.color}"></div></div>
    </div>`;
  }).join('');
}

function renderGoals() {
  const el = document.getElementById('goalsList');
  if (!el) return;
  if (!goals.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;font-size:13px">No active goals yet.<br>We\'ll add these in our next check-in.</div>';
    return;
  }
  el.innerHTML = goals.map(g => `
    <div class="goal-card">
      <div class="goal-title">${g.title}</div>
      ${g.description ? `<div class="goal-desc">${g.description}</div>` : ''}
      <div class="goal-bar"><div class="goal-bar-fill" style="width:${g.progress}%"></div></div>
      <div class="goal-footer">
        <span>${g.progress}% complete</span>
        ${g.target_date ? `<span>Due ${new Date(g.target_date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>` : ''}
      </div>
    </div>
  `).join('');
}

function renderRewards() {
  const el = document.getElementById('rewardGrid');
  if (!el) return;
  el.innerHTML = rewards.map(r => `
    <div class="reward-card" onclick="window._buyReward(${JSON.stringify(r).replace(/"/g,'&quot;')})">
      <div class="reward-icon">${r.icon}</div>
      <div class="reward-name">${r.name}</div>
      <div class="reward-desc">${r.description || ''}</div>
      <div class="reward-cost">💰 ${r.gold_cost}g</div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function findTask(id) {
  return [...tasks.daily, ...tasks.weekly, ...tasks.backlog].find(t => t.id === id);
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function checkLevelUp() {
  const newLevel = Math.floor((character.xp || 0) / 100) + 1;
  if (newLevel > (character.level || 1)) {
    character.level = newLevel;
    showToast('🎉 Level Up! You are now level ' + newLevel + '!');
  }
}

function spawnRipple(e, el) {
  const r = document.createElement('div');
  r.className = 'ripple';
  const rect = el.getBoundingClientRect();
  r.style.left = (e.clientX - rect.left) + 'px';
  r.style.top = (e.clientY - rect.top) + 'px';
  el.appendChild(r);
  setTimeout(() => r.remove(), 600);
}

function spawnXPPopup(e, xp) {
  const p = document.createElement('div');
  p.className = 'xp-popup';
  p.textContent = '+' + xp + ' XP';
  p.style.left = e.clientX + 'px';
  p.style.top = (e.clientY - 10) + 'px';
  document.body.appendChild(p);
  setTimeout(() => p.remove(), 900);
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2900);
}

function setSyncState(state, msg) {
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncMsg');
  dot.className = 'sync-dot ' + state;
  txt.textContent = msg;
}

function setLoading(msg) {
  const overlay = document.getElementById('loadingOverlay');
  if (!msg) {
    overlay.classList.add('hidden');
  } else {
    overlay.classList.remove('hidden');
    document.getElementById('loadingMsg').textContent = msg;
  }
}

function switchTab(tab) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById('pane-' + tab);
  if (pane) {
    pane.style.display = '';
    pane.classList.add('active');
  }
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'admin') loadAdminData();
}

// ═══════════════════════════════════════════════════════════
// COUNTDOWN + DAILY RESET
// ═══════════════════════════════════════════════════════════
function startCountdown() {
  setInterval(() => {
    const now = new Date();
    const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
    const diff = midnight - now;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    document.getElementById('countdown').textContent =
      String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  }, 1000);
}

// ═══════════════════════════════════════════════════════════
// LOCAL CACHE (offline fallback)
// ═══════════════════════════════════════════════════════════
function saveToCache() {
  try {
    localStorage.setItem('ql_cache', JSON.stringify({ tasks, habits, character, goals, rewards, completions: [...todayCompletions], date: todayStr() }));
  } catch(e) {}
}

function loadFromCache() {
  try {
    const c = JSON.parse(localStorage.getItem('ql_cache') || 'null');
    if (!c) return;
    tasks = c.tasks || tasks;
    habits = c.habits || habits;
    character = c.character || character;
    goals = c.goals || goals;
    rewards = c.rewards || rewards;
    todayCompletions = new Set(c.date === todayStr() ? (c.completions || []) : []);
    renderAll();
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
// AUTH / PROFILE
// ═══════════════════════════════════════════════════════════
async function loadProfile() {
  const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  userProfile = data;

  // Update user menu
  const name = userProfile?.display_name || currentUser.email?.split('@')[0] || 'Hero';
  const initial = name.charAt(0).toUpperCase();
  document.getElementById('userBtn').textContent = initial;
  document.getElementById('menuName').textContent = name;
  document.getElementById('menuEmail').textContent = currentUser.email || '';

  // Show admin tab if admin
  if (userProfile?.is_admin) {
    document.getElementById('tab-admin').style.display = '';
    document.getElementById('pane-admin').style.display = 'none'; // hidden until tab clicked
  }
}

// ─── User menu ───────────────────────────────────────────
function toggleUserMenu() {
  const menu = document.getElementById('userMenu');
  menu.classList.toggle('open');
}

document.addEventListener('click', (e) => {
  const btn  = document.getElementById('userBtn');
  const menu = document.getElementById('userMenu');
  if (!btn.contains(e.target) && !menu.contains(e.target)) {
    menu.classList.remove('open');
  }
});

// ─── Logout ──────────────────────────────────────────────
function confirmLogout() {
  document.getElementById('userMenu').classList.remove('open');
  if (confirm('Log out of QuestLog?')) logout();
}

async function logout() {
  await sb.auth.signOut();
  window.location.href = 'landing.html';
}

// ─── Settings modal ──────────────────────────────────────
function openSettings() {
  document.getElementById('userMenu').classList.remove('open');
  document.getElementById('settingsName').value = userProfile?.display_name || '';
  document.getElementById('settingsOverlay').classList.add('open');
}

function closeSettings(e) {
  if (e && e.target !== document.getElementById('settingsOverlay')) return;
  document.getElementById('settingsOverlay').classList.remove('open');
}

async function saveSettings() {
  const name = document.getElementById('settingsName').value.trim();
  if (!name) { showToast('Please enter a name.'); return; }
  const { error } = await sb.from('profiles').update({ display_name: name }).eq('id', currentUser.id);
  if (error) { showToast('❌ Failed to save.'); return; }
  userProfile.display_name = name;
  document.getElementById('charName').textContent = name;
  document.getElementById('userBtn').textContent = name.charAt(0).toUpperCase();
  document.getElementById('menuName').textContent = name;
  document.getElementById('settingsOverlay').classList.remove('open');
  showToast('✓ Profile updated!');
}

// ─── Delete account modal ────────────────────────────────
function openDeleteAccount() {
  document.getElementById('settingsOverlay').classList.remove('open');
  document.getElementById('deleteConfirmInput').value = '';
  document.getElementById('deleteOverlay').classList.add('open');
}

function closeDeleteAccount(e) {
  if (e && e.target !== document.getElementById('deleteOverlay')) return;
  document.getElementById('deleteOverlay').classList.remove('open');
}

async function handleDeleteAccount() {
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

  // Call edge function to delete auth user + all data
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

// ═══════════════════════════════════════════════════════════
// ADMIN PANEL
// ═══════════════════════════════════════════════════════════
let adminData = { profiles: [], characters: [] };

async function loadAdminData() {
  const el = document.getElementById('adminUserList');
  el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px">Loading...</div>';

  const [profilesRes, charsRes] = await Promise.all([
    sb.from('profiles').select('*').order('created_at'),
    sb.from('character').select('*'),
  ]);

  adminData.profiles  = profilesRes.data || [];
  adminData.characters = charsRes.data || [];
  document.getElementById('adminUserCount').textContent = adminData.profiles.length;
  renderAdmin();
}

function renderAdmin() {
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
            <div class="admin-user-name">${p.display_name || '—'}${p.is_admin ? '<span class="admin-badge">Admin</span>' : ''}</div>
            <div class="admin-user-email">${p.email || '—'}</div>
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

// ═══════════════════════════════════════════════════════════
// SERVICE WORKER + SMART NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
let swReg = null;

async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register('sw.js');
    console.log('SW registered');

    // Request notification permission automatically on first install
    await requestNotificationPermission();

  } catch(e) {
    console.warn('SW registration failed:', e);
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      notifyServiceWorker({ type: 'PERMISSION_GRANTED' });
      showToast('🔔 Reminders enabled! We\'ll keep you on track.');
    }
  } else if (Notification.permission === 'granted') {
    notifyServiceWorker({ type: 'PERMISSION_GRANTED' });
  }
}

function notifyServiceWorker(msg) {
  if (!swReg || !swReg.active) return;
  swReg.active.postMessage(msg);
}

// Called every time a task is toggled — keeps SW in sync with real state
function syncCompletionState() {
  const allDailyDone  = tasks.daily.length > 0  && tasks.daily.every(t  => todayCompletions.has(t.id));
  const allWeeklyDone = tasks.weekly.length > 0 && tasks.weekly.every(t => todayCompletions.has(t.id));
  const dailyRemaining  = tasks.daily.filter(t  => !todayCompletions.has(t.id)).length;
  const weeklyRemaining = tasks.weekly.filter(t => !todayCompletions.has(t.id)).length;

  notifyServiceWorker({
    type: 'COMPLETION_UPDATE',
    payload: { allDailyDone, allWeeklyDone, dailyRemaining, weeklyRemaining }
  });
}

initServiceWorker();

// ═══════════════════════════════════════════════════════════
// EXPOSE GLOBALS for inline HTML onclick handlers
// ═══════════════════════════════════════════════════════════
Object.assign(window, {
  switchTab,
  toggleUserMenu,
  openSettings,
  closeSettings,
  saveSettings,
  openDeleteAccount,
  closeDeleteAccount,
  handleDeleteAccount,
  confirmLogout,
  _buyReward: buyReward,
});

// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════
boot();
