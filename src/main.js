import './styles/app.css'
import { sb, SUPABASE_URL } from './lib/supabase.js'
import {
  xpForLevel, getCharLevel, getCharTitle, getStreakMultiplier,
  escapeHtml, todayStr,
} from './lib/utils.js'

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════
let USER_ID = null; // set after auth check
const CIRC = 176;

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let tasks = { daily: [], weekly: [], backlog: [] };
let archivedBacklog = [];  // completed backlog tasks (archived)
let archiveOpen = false;
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
    await checkStreakReset();
    setSyncState('live', 'Live');
    subscribeRealtime();
    startCountdown();
    renderAll();
    setLoading(null);
    syncCompletionState();
    // Restore leaderboard toggle state
    const lbEl = document.getElementById('lbToggle');
    if (lbEl && userProfile) lbEl.checked = !!userProfile.show_on_leaderboard;
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

  // Sort tasks into categories (archived backlog tasks are separated)
  const all = tasksRes.data || [];
  tasks.daily   = all.filter(t => t.category === 'daily');
  tasks.weekly  = all.filter(t => t.category === 'weekly');
  tasks.backlog = all.filter(t => t.category === 'backlog' && !t.archived_at);
  archivedBacklog = all
    .filter(t => t.category === 'backlog' && t.archived_at)
    .sort((a, b) => new Date(b.archived_at) - new Date(a.archived_at));

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

  // Backlog tasks: complete → archive (one-way, no toggle)
  if (task.category === 'backlog' && !isDone) {
    await archiveBacklogTask(e, task, el);
    return;
  }

  if (!isDone) {
    // Mark complete — apply streak multiplier (Phase 5)
    const mult = getStreakMultiplier(character.streak || 0);
    const earnedXP = Math.round(task.xp_reward * mult);

    todayCompletions.add(taskId);
    el.classList.add('done');
    spawnRipple(e, el);
    spawnXPPopup(e, earnedXP);

    // Optimistic UI update
    character.xp = (character.xp || 0) + earnedXP;
    character.gold = parseFloat(character.gold || 0) + parseFloat(task.gold_reward);
    character.total_completed = (character.total_completed || 0) + 1;
    checkLevelUp();
    renderChar();
    renderRings();
    renderCounts();

    const today = todayStr();
    // Persist to Supabase
    await Promise.all([
      sb.from('completions').insert({
        user_id: USER_ID, task_id: taskId,
        xp_earned: earnedXP, gold_earned: task.gold_reward,
        completed_date: today
      }),
      sb.from('character').update({
        xp: character.xp,
        gold: character.gold,
        total_completed: character.total_completed,
        last_active: today,
        last_activity_date: today,
      }).eq('user_id', USER_ID),
      sb.from('habits').update({
        current_streak: (habits[taskId]?.current_streak || 0) + 1,
        last_completed: today,
        total_completions: (habits[taskId]?.total_completions || 0) + 1
      }).eq('task_id', taskId).eq('user_id', USER_ID)
    ]);

    // Check if all dailies done → streak + daily bonus
    if (tasks.daily.length > 0 && tasks.daily.every(t => todayCompletions.has(t.id))) {
      character.streak = (character.streak || 0) + 1;
      if (character.streak > (character.best_streak || 0)) character.best_streak = character.streak;

      // Daily completion bonus: +50 XP (Phase 5)
      character.xp = (character.xp || 0) + 50;

      // Award streak shield at milestones (Phase 3)
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
        streak: character.streak,
        best_streak: character.best_streak,
        xp: character.xp,
        streak_shield: character.streak_shield || 0,
        awarded_shield_milestones: awardedMilestones
      }).eq('user_id', USER_ID);

      renderChar();
      renderStreak();
      showToast('🔥 All dailies done! ' + character.streak + ' day streak!' + (shieldAwarded ? ' 🛡️ Shield earned!' : '') + ' +50 XP bonus!');
    } else if (mult > 1) {
      showToast('✨ ' + mult + '× streak bonus! +' + earnedXP + ' XP');
    }

  } else {
    // Undo (daily/weekly only)
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
  renderArchive();
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
  const totalXP = character.xp || 0;
  const lvl = getCharLevel(totalXP);
  character.level = lvl;
  const xpThisLevel = totalXP - xpForLevel(lvl);
  const xpNextLevel = xpForLevel(lvl + 1) - xpForLevel(lvl);
  const pct = lvl >= 50 ? 100 : Math.min(100, Math.round(xpThisLevel / xpNextLevel * 100));

  document.getElementById('levelBadge').textContent = 'Lv ' + lvl;
  document.getElementById('statXP').textContent = totalXP;
  document.getElementById('statHP').textContent = character.hp || 100;
  document.getElementById('statGold').textContent = Math.floor(character.gold || 0);
  document.getElementById('goldDisplay').textContent = Math.floor(character.gold || 0);
  document.getElementById('xpLabel').textContent = xpThisLevel + ' / ' + (lvl >= 50 ? 'MAX' : xpNextLevel);
  document.getElementById('xpBarFill').style.width = pct + '%';
  document.getElementById('charClass').textContent = getCharTitle(lvl);
  if (userProfile) document.getElementById('charName').textContent = userProfile.display_name || 'Hero';
}

function renderStreak() {
  const streak = character.streak || 0;
  const shield = character.streak_shield || 0;
  document.getElementById('streakCount').textContent = streak;
  const msgs = ['Complete all dailies to start your streak!','Keep it up — you\'re building momentum!','Crushing it! Stay consistent!','Unstoppable streak incoming!','You are a habit legend!'];
  const idx = Math.min(Math.floor(streak / 3), msgs.length - 1);
  document.getElementById('streakMsg').textContent = msgs[idx];
  const shieldEl = document.getElementById('streakShield');
  const shieldCount = document.getElementById('shieldCount');
  if (shieldEl) {
    shieldEl.style.display = shield > 0 ? 'inline-flex' : 'none';
    if (shieldCount) shieldCount.textContent = shield;
  }
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
  const todayDow = new Date().getDay();
  ['daily','weekly','backlog'].forEach(cat => {
    let visible = tasks[cat];
    if (cat === 'weekly') {
      visible = tasks[cat].filter(t =>
        !t.days_of_week || t.days_of_week.length === 0 || t.days_of_week.includes(todayDow)
      );
    }
    const done = visible.filter(t => todayCompletions.has(t.id)).length;
    document.getElementById('count-' + cat).textContent = done + '/' + visible.length;
  });
}

function renderTaskList(cat) {
  const el = document.getElementById('list-' + cat);
  el.innerHTML = '';
  const todayDow = new Date().getDay(); // 0=Sun … 6=Sat

  let visibleTasks = tasks[cat];

  // For weekly tasks, filter by days_of_week if set
  if (cat === 'weekly') {
    visibleTasks = tasks[cat].filter(t => {
      if (!t.days_of_week || t.days_of_week.length === 0) return true;
      return t.days_of_week.includes(todayDow);
    });
  }

  // For backlog, sort by priority (P1→P4), then created_at
  if (cat === 'backlog') {
    const pOrder = { P1: 1, P2: 2, P3: 3, P4: 4 };
    visibleTasks = [...visibleTasks].sort((a, b) =>
      (pOrder[a.priority] || 5) - (pOrder[b.priority] || 5)
    );
  }

  visibleTasks.forEach(task => {
    const done = todayCompletions.has(task.id);
    const habit = habits[task.id] || {};
    const div = document.createElement('div');
    div.className = 'task' + (done ? ' done' : '');
    div.innerHTML = `
      <div class="task-check"><div class="check-icon">✓</div></div>
      <div class="task-body">
        <div class="task-name">${escapeHtml(task.name)}</div>
        <div class="task-meta">
          <span class="pill pill-xp">+${task.xp_reward} XP</span>
          <span class="pill pill-gold">+${task.gold_reward}g</span>
          ${task.priority ? `<span class="pill pill-${task.priority.toLowerCase()}">${task.priority}</span>` : ''}
          ${habit.current_streak > 0 ? `<span class="pill pill-streak">🔥${habit.current_streak}</span>` : ''}
        </div>
      </div>
      <div class="diff-dot diff-${task.difficulty}"></div>
      <div class="task-actions">
        <button class="task-action-btn" title="Edit" onclick="event.stopPropagation();window.openTaskModal('${cat}',window._taskById('${task.id}'))">✏️</button>
        <button class="task-action-btn danger" title="Delete" onclick="event.stopPropagation();window._confirmDeleteTask('${task.id}',this.closest('.task'))">🗑️</button>
      </div>
    `;
    div.onclick = (e) => {
      if (e.target.closest('.task-actions')) return;
      toggleTask(e, task.id, div);
    };
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
    el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;font-size:13px">No active goals yet.<br>Tap + to add your first goal!</div>';
    return;
  }
  const GOAL_DIFF_REWARDS = { easy:{xp:200,gold:100}, med:{xp:500,gold:250}, hard:{xp:1000,gold:500}, epic:{xp:1500,gold:750} };
  el.innerHTML = goals.map(g => {
    const diff   = g.difficulty || 'med';
    const rew    = GOAL_DIFF_REWARDS[diff];
    const xpR    = g.xp_reward  ?? rew.xp;
    const goldR  = g.gold_reward ?? rew.gold;
    const pct    = g.progress || 0;
    const due    = g.target_date || g.deadline;
    // Subtasks linked to this goal
    const linked = [...tasks.daily, ...tasks.weekly, ...tasks.backlog, ...archivedBacklog]
      .filter(t => t.goal_id === g.id);
    const subtaskHTML = linked.length ? `
      <div class="goal-subtasks">
        <div class="goal-subtask-title">Sub-tasks (${linked.filter(t=>t.archived_at||todayCompletions.has(t.id)).length}/${linked.length})</div>
        ${linked.map(t => {
          const done = t.archived_at || todayCompletions.has(t.id);
          return `<div class="subtask-row${done?' done':''}">
            <div class="subtask-dot"></div>
            <span>${escapeHtml(t.name)}</span>
          </div>`;
        }).join('')}
      </div>` : '';
    return `
    <div class="goal-card">
      <div class="goal-top">
        <div class="goal-title">${escapeHtml(g.title)}</div>
        <div class="goal-actions">
          <button class="task-action-btn" title="Edit" onclick="window.openGoalModal(window._goalById('${g.id}'))">✏️</button>
          <button class="task-action-btn danger" title="Delete" onclick="window._deleteGoal('${g.id}')">🗑️</button>
        </div>
      </div>
      <div class="goal-badges">
        <span class="goal-badge cat">${g.category || 'personal'}</span>
        <span class="goal-badge diff-${diff}">${diff}</span>
        <span class="goal-badge horizon">${g.time_horizon || 'monthly'}</span>
      </div>
      ${g.description ? `<div class="goal-desc">${escapeHtml(g.description)}</div>` : ''}
      <div class="goal-bar"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
      <div class="goal-footer">
        <span>${pct}% complete</span>
        ${due ? `<span>Due ${new Date(due).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>` : ''}
      </div>
      <div class="goal-rewards">
        <span class="goal-reward-pill xp">⚡ ${xpR} XP</span>
        <span class="goal-reward-pill gold">💰 ${goldR}g</span>
      </div>
      ${subtaskHTML}
      ${pct >= 100 ? `<button class="goal-complete-btn" onclick="window._completeGoal('${g.id}')">🏆 Claim Reward</button>` : ''}
    </div>`;
  }).join('');
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

function taskById(id) {
  return findTask(id);
}

// todayStr() imported from src/lib/utils.js

function checkLevelUp() {
  const newLevel = getCharLevel(character.xp || 0);
  if (newLevel > (character.level || 1)) {
    character.level = newLevel;
    showLevelUpFlash(newLevel);
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
  if (tab === 'admin')       loadAdminData();
  if (tab === 'calendar')    renderCalendar();
  if (tab === 'leaderboard') loadLeaderboard();
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
    localStorage.setItem('ql_cache', JSON.stringify({ tasks, archivedBacklog, habits, character, goals, rewards, completions: [...todayCompletions], date: todayStr() }));
  } catch(e) {}
}

function loadFromCache() {
  try {
    const c = JSON.parse(localStorage.getItem('ql_cache') || 'null');
    if (!c) return;
    tasks = c.tasks || tasks;
    archivedBacklog = c.archivedBacklog || [];
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
// PHASE 5 — XP / LEVEL SYSTEM
// Pure functions imported from src/lib/utils.js
// ═══════════════════════════════════════════════════════════

function showLevelUpFlash(level) {
  const el = document.createElement('div');
  el.className = 'levelup-flash';
  el.innerHTML = `<div class="levelup-text">⬆️ Level ${level}!<br><span style="font-size:22px">${getCharTitle(level)}</span></div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

// ═══════════════════════════════════════════════════════════
// PHASE 3 — STREAK RESET + SHIELD
// ═══════════════════════════════════════════════════════════
async function checkStreakReset() {
  const lastActive = character.last_activity_date;
  if (!lastActive) return;
  const today = todayStr();
  if (lastActive >= today) return; // today or future — no reset needed
  const diff = Math.round((new Date(today) - new Date(lastActive)) / 86400000);
  if (diff <= 1) return; // consecutive days — fine
  if ((character.streak_shield || 0) > 0) {
    character.streak_shield = (character.streak_shield || 1) - 1;
    await sb.from('character').update({ streak_shield: character.streak_shield }).eq('user_id', USER_ID);
    showToast('🛡️ Streak shield used! Streak protected.');
  } else if ((character.streak || 0) > 0) {
    character.streak = 0;
    await sb.from('character').update({ streak: 0 }).eq('user_id', USER_ID);
    showToast('💔 Streak reset. Start again today!');
  }
}

// ═══════════════════════════════════════════════════════════
// PHASE 2 — BACKLOG ARCHIVE
// ═══════════════════════════════════════════════════════════
async function archiveBacklogTask(e, task, el) {
  const now = new Date();
  const archiveMonth = now.toISOString().slice(0, 7);
  const mult = getStreakMultiplier(character.streak || 0);
  const earnedXP = Math.round(task.xp_reward * mult);
  const today = todayStr();

  // Optimistic UI
  todayCompletions.add(task.id);
  el.classList.add('done');
  spawnRipple(e, el);
  spawnXPPopup(e, earnedXP);
  character.xp = (character.xp || 0) + earnedXP;
  character.gold = parseFloat(character.gold || 0) + parseFloat(task.gold_reward);
  character.total_completed = (character.total_completed || 0) + 1;
  checkLevelUp();
  renderChar();

  // Move task from active to archived in memory
  tasks.backlog = tasks.backlog.filter(t => t.id !== task.id);
  const archived = { ...task, archived_at: now.toISOString(), archive_month: archiveMonth, completed_at: now.toISOString() };
  archivedBacklog.unshift(archived);
  renderTaskList('backlog');
  renderCounts();
  renderArchive();

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
      archived_at:  now.toISOString(),
      archive_month: archiveMonth,
    }).eq('id', task.id).eq('user_id', USER_ID),
  ]);

  setSyncState('live', 'Live sync');
  saveToCache();
  syncCompletionState();
  showToast('✅ Quest complete! Archived to history.');
}

function renderArchive() {
  const toggleEl = document.getElementById('archiveToggle');
  const listEl   = document.getElementById('archiveList');
  if (!toggleEl || !listEl) return;

  if (archivedBacklog.length === 0) {
    toggleEl.style.display = 'none';
    listEl.style.display   = 'none';
    return;
  }
  toggleEl.style.display = 'flex';
  document.getElementById('archiveCount').textContent = archivedBacklog.length;

  // Group by archive_month
  const groups = {};
  archivedBacklog.forEach(t => {
    const key = t.archive_month || t.archived_at?.slice(0,7) || 'Unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });
  const months = Object.keys(groups).sort().reverse();

  listEl.innerHTML = months.map(month => {
    const [y, m] = month.split('-');
    const label = isNaN(+m) ? month : new Date(+y, +m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return `
      <div class="archive-month-header">${label}<span class="archive-month-count">${groups[month].length}</span></div>
      ${groups[month].map(t => `
        <div class="archive-task">
          <div class="archive-task-check">✓</div>
          <div class="archive-task-body">
            <div class="archive-task-name">${escapeHtml(t.name)}</div>
            <div class="task-meta">
              <span class="pill pill-xp">+${t.xp_reward} XP</span>
              <span class="pill pill-gold">+${t.gold_reward}g</span>
              ${t.priority ? `<span class="pill pill-${t.priority.toLowerCase()}">${t.priority}</span>` : ''}
            </div>
          </div>
          <button class="task-action-btn danger" title="Permanently delete" onclick="window._permanentDeleteTask('${t.id}')">🗑️</button>
        </div>`).join('')}`;
  }).join('');
}

function toggleArchive() {
  archiveOpen = !archiveOpen;
  const listEl   = document.getElementById('archiveList');
  const chevron  = document.getElementById('archiveChevron');
  if (listEl)  listEl.style.display  = archiveOpen ? 'block' : 'none';
  if (chevron) chevron.classList.toggle('open', archiveOpen);
}

async function permanentDeleteTask(id) {
  if (!confirm('Permanently delete this archived task? This cannot be undone.')) return;
  const { error } = await sb.from('tasks').delete().eq('id', id).eq('user_id', USER_ID);
  if (error) { showToast('❌ Failed to delete.'); return; }
  archivedBacklog = archivedBacklog.filter(t => t.id !== id);
  renderArchive();
  saveToCache();
  showToast('Task permanently deleted.');
}

// ═══════════════════════════════════════════════════════════
// PHASE 4 — GOAL CRUD
// ═══════════════════════════════════════════════════════════
const GOAL_DIFF_DEFAULTS = {
  easy: { xp: 200,  gold: 100  },
  med:  { xp: 500,  gold: 250  },
  hard: { xp: 1000, gold: 500  },
  epic: { xp: 1500, gold: 750  },
};
let editingGoalId   = null;
let selectedGoalDiff = 'med';

function openGoalModal(goal = null) {
  editingGoalId    = goal ? goal.id : null;
  selectedGoalDiff = goal?.difficulty || 'med';

  document.getElementById('goalModalTitle').textContent = goal ? 'Edit Goal' : 'Add Goal';
  document.getElementById('goalTitle').value    = goal?.title       || '';
  document.getElementById('goalDesc').value     = goal?.description || '';
  document.getElementById('goalCat').value      = goal?.category    || 'personal';
  document.getElementById('goalHorizon').value  = goal?.time_horizon || 'monthly';
  document.getElementById('goalDeadline').value = (goal?.target_date || goal?.deadline || '').slice(0,10);

  const def = GOAL_DIFF_DEFAULTS[selectedGoalDiff];
  document.getElementById('goalXP').value   = goal?.xp_reward   ?? def.xp;
  document.getElementById('goalGold').value = goal?.gold_reward ?? def.gold;

  renderGoalDiffPicker();
  document.getElementById('goalModalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('goalTitle').focus(), 300);
}

function closeGoalModal(e) {
  if (e && e.target !== document.getElementById('goalModalOverlay')) return;
  document.getElementById('goalModalOverlay').classList.remove('open');
  editingGoalId = null;
}

function selectGoalDiff(diff) {
  selectedGoalDiff = diff;
  renderGoalDiffPicker();
  const def = GOAL_DIFF_DEFAULTS[diff];
  document.getElementById('goalXP').value   = def.xp;
  document.getElementById('goalGold').value = def.gold;
}

function renderGoalDiffPicker() {
  document.querySelectorAll('#goalDiffPicker .diff-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.diff === selectedGoalDiff);
  });
}

async function saveGoal() {
  const title = document.getElementById('goalTitle').value.trim();
  if (!title) { showToast('Please enter a goal title.'); return; }

  const payload = {
    user_id:      USER_ID,
    title,
    description:  document.getElementById('goalDesc').value.trim() || null,
    category:     document.getElementById('goalCat').value,
    time_horizon: document.getElementById('goalHorizon').value,
    difficulty:   selectedGoalDiff,
    xp_reward:    parseInt(document.getElementById('goalXP').value)   || GOAL_DIFF_DEFAULTS[selectedGoalDiff].xp,
    gold_reward:  parseFloat(document.getElementById('goalGold').value) || GOAL_DIFF_DEFAULTS[selectedGoalDiff].gold,
    target_date:  document.getElementById('goalDeadline').value || null,
    status:       'active',
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
  await loadAll();
  renderGoals();
}

async function deleteGoal(id) {
  if (!confirm('Delete this goal?')) return;
  const { error } = await sb.from('goals').update({ status: 'deleted' }).eq('id', id).eq('user_id', USER_ID);
  if (error) { showToast('❌ Failed to delete goal.'); return; }
  goals = goals.filter(g => g.id !== id);
  renderGoals();
  showToast('Goal removed.');
}

async function completeGoal(id) {
  const goal = goals.find(g => g.id === id);
  if (!goal) return;
  const diff = goal.difficulty || 'med';
  const xpR  = goal.xp_reward  ?? GOAL_DIFF_DEFAULTS[diff].xp;
  const goldR = goal.gold_reward ?? GOAL_DIFF_DEFAULTS[diff].gold;

  character.xp   = (character.xp   || 0) + xpR;
  character.gold = (parseFloat(character.gold) || 0) + goldR;
  checkLevelUp();
  renderChar();

  await Promise.all([
    sb.from('goals').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', id).eq('user_id', USER_ID),
    sb.from('character').update({ xp: character.xp, gold: character.gold }).eq('user_id', USER_ID),
  ]);

  goals = goals.filter(g => g.id !== id);
  renderGoals();
  showToast(`🏆 Goal complete! +${xpR} XP, +${goldR}g rewarded!`);
}

function goalById(id) { return goals.find(g => g.id === id) || null; }

// ═══════════════════════════════════════════════════════════
// PHASE 6 — CALENDAR VIEW
// ═══════════════════════════════════════════════════════════
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let calSelectedDay = null;

function renderCalendar() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('calMonthLabel').textContent = months[calMonth] + ' ' + calYear;

  const grid   = document.getElementById('calGrid');
  const today  = new Date();
  const first  = new Date(calYear, calMonth, 1);
  const days   = new Date(calYear, calMonth + 1, 0).getDate();
  const startDow = first.getDay(); // 0=Sun

  grid.innerHTML = '';

  // Empty cells before 1st
  for (let i = 0; i < startDow; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day other-month';
    grid.appendChild(cell);
  }

  for (let d = 1; d <= days; d++) {
    const date    = new Date(calYear, calMonth, d);
    const dow     = date.getDay();
    const dateStr = date.toISOString().split('T')[0];
    const isToday = date.toDateString() === today.toDateString();

    const dailyTasks  = tasks.daily;
    const weeklyTasks = tasks.weekly.filter(t => !t.days_of_week || t.days_of_week.length === 0 || t.days_of_week.includes(dow));
    const goalsDue    = goals.filter(g => (g.target_date || g.deadline || '').slice(0,10) === dateStr);

    const hasDots = dailyTasks.length || weeklyTasks.length || goalsDue.length;

    const cell = document.createElement('div');
    cell.className = 'cal-day' + (isToday ? ' today' : '') + (hasDots ? ' has-events' : '');
    cell.innerHTML = `
      <div class="cal-day-num">${d}</div>
      <div class="cal-dots">
        ${dailyTasks.length  ? '<div class="cal-dot daily"></div>'  : ''}
        ${weeklyTasks.length ? '<div class="cal-dot weekly"></div>' : ''}
        ${goalsDue.length    ? '<div class="cal-dot goal"></div>'   : ''}
      </div>`;
    cell.onclick = () => calSelectDay(d, dateStr, dow, goalsDue);
    grid.appendChild(cell);
  }

  // Re-select if same month
  if (calSelectedDay !== null) calSelectDay(calSelectedDay, null, null, null);
}

function calSelectDay(day, dateStr, dow, goalsDue) {
  calSelectedDay = day;
  const detail    = document.getElementById('calDetail');
  const titleEl   = document.getElementById('calDetailTitle');
  const itemsEl   = document.getElementById('calDetailItems');
  if (!detail) return;

  if (!dateStr) {
    // Recompute
    const date = new Date(calYear, calMonth, day);
    dow      = date.getDay();
    dateStr  = date.toISOString().split('T')[0];
    goalsDue = goals.filter(g => (g.target_date || g.deadline || '').slice(0,10) === dateStr);
  }

  const dailies  = tasks.daily;
  const weeklies = tasks.weekly.filter(t => !t.days_of_week || t.days_of_week.length === 0 || t.days_of_week.includes(dow));
  const allItems = [
    ...dailies.map(t  => ({ name: escapeHtml(t.name),  type: 'daily',  dot: 'daily'  })),
    ...weeklies.map(t => ({ name: escapeHtml(t.name),  type: 'weekly', dot: 'weekly' })),
    ...(goalsDue || []).map(g => ({ name: escapeHtml(g.title), type: 'goal deadline', dot: 'goal' })),
  ];

  detail.classList.add('open');
  titleEl.textContent = new Date(calYear, calMonth, day)
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  if (!allItems.length) {
    itemsEl.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">No tasks or deadlines.</div>';
  } else {
    itemsEl.innerHTML = allItems.map(i => `
      <div class="cal-detail-item">
        <div class="cal-detail-dot cal-dot ${i.dot}"></div>
        <span>${escapeHtml(i.name)}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--muted)">${i.type}</span>
      </div>`).join('');
  }
}

function calPrev() {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  calSelectedDay = null;
  document.getElementById('calDetail').classList.remove('open');
  renderCalendar();
}

function calNext() {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  calSelectedDay = null;
  document.getElementById('calDetail').classList.remove('open');
  renderCalendar();
}

// ═══════════════════════════════════════════════════════════
// PHASE 7 — LEADERBOARD
// ═══════════════════════════════════════════════════════════
let leaderboardCache = null;
let leaderboardCacheTime = 0;

async function loadLeaderboard() {
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

  leaderboardCache    = rows;
  leaderboardCacheTime = Date.now();
  renderLeaderboard(rows);
}

function renderLeaderboard(rows) {
  const el = document.getElementById('leaderboardList');
  if (!el) return;
  el.innerHTML = rows.map((row, i) => {
    const rank  = i + 1;
    const rankCls = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';
    const isMe  = row.id === USER_ID;
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

async function toggleLeaderboard(checked) {
  if (!userProfile) return;
  const { error } = await sb.from('profiles').update({ show_on_leaderboard: checked }).eq('id', USER_ID);
  if (error) { showToast('❌ Failed to update leaderboard setting.'); return; }
  userProfile.show_on_leaderboard = checked;
  leaderboardCache = null; // bust cache
  showToast(checked ? '🏅 You\'re now on the leaderboard!' : 'Removed from leaderboard.');
}

// ═══════════════════════════════════════════════════════════
// TASK CRUD
// ═══════════════════════════════════════════════════════════
const DIFF_DEFAULTS = {
  easy: { xp: 25,  gold: 10 },
  med:  { xp: 50,  gold: 25 },
  hard: { xp: 100, gold: 50 },
};

let taskModalCat    = 'daily';
let editingTaskId   = null;
let selectedDiff    = 'med';
let selectedPriority = 'P1';

function openTaskModal(cat, task = null) {
  taskModalCat  = cat;
  editingTaskId = task ? task.id : null;

  document.getElementById('taskModalTitle').textContent = task ? 'Edit Task' : 'Add Task';
  document.getElementById('taskName').value = task ? task.name : '';

  // Difficulty
  selectedDiff = task ? (task.difficulty || 'med') : 'med';
  renderDiffPicker();

  // XP / Gold
  const def = DIFF_DEFAULTS[selectedDiff];
  document.getElementById('taskXP').value   = task ? task.xp_reward   : def.xp;
  document.getElementById('taskGold').value = task ? task.gold_reward  : def.gold;

  // Show/hide days section
  const daysSection = document.getElementById('taskDaysSection');
  daysSection.style.display = cat === 'weekly' ? 'block' : 'none';
  if (cat === 'weekly') {
    const days = task?.days_of_week || [];
    document.querySelectorAll('#taskDaysSection input[type="checkbox"]').forEach(cb => {
      cb.checked = days.includes(parseInt(cb.value));
    });
  }

  // Show/hide priority section
  const prioritySection = document.getElementById('taskPrioritySection');
  prioritySection.style.display = cat === 'backlog' ? 'block' : 'none';
  if (cat === 'backlog') {
    selectedPriority = task?.priority || 'P1';
    renderPriorityPicker();
  }

  document.getElementById('taskModalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('taskName').focus(), 300);
}

function closeTaskModal(e) {
  if (e && e.target !== document.getElementById('taskModalOverlay')) return;
  document.getElementById('taskModalOverlay').classList.remove('open');
  editingTaskId = null;
}

function selectDiff(diff) {
  selectedDiff = diff;
  renderDiffPicker();
  // Update XP/gold to defaults only if user hasn't manually changed them
  const def = DIFF_DEFAULTS[diff];
  document.getElementById('taskXP').value   = def.xp;
  document.getElementById('taskGold').value = def.gold;
}

function renderDiffPicker() {
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.diff === selectedDiff);
  });
}

function selectPriority(p) {
  selectedPriority = p;
  renderPriorityPicker();
}

function renderPriorityPicker() {
  document.querySelectorAll('.priority-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.p === selectedPriority);
  });
}

async function saveTask() {
  const name = document.getElementById('taskName').value.trim();
  if (!name) { showToast('Please enter a task name.'); return; }

  const xp   = parseInt(document.getElementById('taskXP').value)   || DIFF_DEFAULTS[selectedDiff].xp;
  const gold = parseFloat(document.getElementById('taskGold').value) || DIFF_DEFAULTS[selectedDiff].gold;

  // Collect days_of_week for weekly tasks
  let days_of_week = null;
  if (taskModalCat === 'weekly') {
    const checked = [...document.querySelectorAll('#taskDaysSection input[type="checkbox"]:checked')]
      .map(cb => parseInt(cb.value));
    days_of_week = checked.length > 0 ? checked : null;
  }

  const payload = {
    user_id:    USER_ID,
    name,
    category:   taskModalCat,
    difficulty: selectedDiff,
    xp_reward:  xp,
    gold_reward: gold,
    is_active:  true,
    days_of_week,
    priority: taskModalCat === 'backlog' ? selectedPriority : null,
  };

  const btn = document.getElementById('saveTaskBtn');
  btn.disabled = true;

  let error;
  if (editingTaskId) {
    ({ error } = await sb.from('tasks').update(payload).eq('id', editingTaskId).eq('user_id', USER_ID));
  } else {
    ({ error } = await sb.from('tasks').insert(payload));
  }

  btn.disabled = false;
  if (error) { showToast('❌ Failed to save task.'); return; }

  document.getElementById('taskModalOverlay').classList.remove('open');
  showToast(editingTaskId ? '✓ Task updated!' : '✓ Task added!');
  await loadAll();
  renderAll();
}

async function deleteTask(id) {
  const { error } = await sb.from('tasks').update({ is_active: false }).eq('id', id).eq('user_id', USER_ID);
  if (error) { showToast('❌ Failed to delete task.'); return; }
  // Also remove from todayCompletions if it was done
  todayCompletions.delete(id);
  await loadAll();
  renderAll();
  showToast('Task removed.');
}

// Shows inline delete confirm on the task row
function confirmDeleteTask(id, el) {
  // Replace the action buttons with a confirm row
  const actions = el.querySelector('.task-actions');
  actions.innerHTML = `
    <span class="task-del-confirm">
      Delete?
      <button class="task-del-yes" onclick="window._deleteTask('${id}')">Yes</button>
      <button class="task-del-no" onclick="window._cancelDelete(this)">No</button>
    </span>`;
}

function cancelDelete(btn) {
  // Re-render the task row by triggering a full render
  renderTaskList(taskModalCat); // fallback — just rerender all lists
  renderTaskList('daily');
  renderTaskList('weekly');
  renderTaskList('backlog');
}

// ═══════════════════════════════════════════════════════════
// EXPOSE GLOBALS for inline HTML onclick handlers
// ═══════════════════════════════════════════════════════════
Object.assign(window, {
  // Navigation
  switchTab,
  // User menu / auth
  toggleUserMenu, confirmLogout,
  // Settings
  openSettings, closeSettings, saveSettings,
  openDeleteAccount, closeDeleteAccount, handleDeleteAccount,
  // Rewards
  _buyReward: buyReward,
  // Task CRUD
  openTaskModal, closeTaskModal, selectDiff, selectPriority,
  saveTask, _deleteTask: deleteTask,
  _confirmDeleteTask: confirmDeleteTask, _cancelDelete: cancelDelete,
  _taskById: taskById,
  // Archive (Phase 2)
  toggleArchive, _permanentDeleteTask: permanentDeleteTask,
  // Goal CRUD (Phase 4)
  openGoalModal, closeGoalModal, selectGoalDiff, saveGoal,
  _deleteGoal: deleteGoal, _completeGoal: completeGoal, _goalById: goalById,
  // Calendar (Phase 6)
  calPrev, calNext,
  // Leaderboard (Phase 7)
  toggleLeaderboard,
});

// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════
boot();
