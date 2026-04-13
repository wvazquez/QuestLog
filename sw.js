const CACHE = 'questlog-v2';
const ASSETS = [
  '/QuestLog/',
  '/QuestLog/index.html',
  '/QuestLog/manifest.json',
  '/QuestLog/icons/icon-192.png',
  '/QuestLog/icons/icon-512.png',
];

// ─── SMART NOTIFICATION SCHEDULE ─────────────────────────────────────────
// Runs a check every minute. Each slot has a condition that looks at
// real completion data before deciding whether to fire.
const SCHEDULE = [
  {
    id: 'morning-kickoff',
    hour: 7, minute: 0,
    condition: 'always',
    title: '⚡ Quest day begins!',
    body: 'Your daily habits are waiting. Let\'s get after it.',
  },
  {
    id: 'morning-checkin',
    hour: 10, minute: 30,
    condition: 'daily-incomplete',
    title: '🌅 Morning check-in',
    body: 'Still have morning habits to finish. Quick wins before noon!',
  },
  {
    id: 'midday-nudge',
    hour: 12, minute: 30,
    condition: 'daily-incomplete',
    title: '☀️ Midday reminder',
    body: 'Afternoon is here — knock out those remaining daily habits.',
  },
  {
    id: 'afternoon-push',
    hour: 15, minute: 30,
    condition: 'daily-incomplete',
    title: '💪 Still time to win today',
    body: 'Your streak is on the line. Complete your habits before the day slips.',
  },
  {
    id: 'evening-wind-down',
    hour: 19, minute: 0,
    condition: 'always',
    title: '🌙 Evening routine time',
    body: 'Time for your evening wind-down tasks. Finish the day strong.',
  },
  {
    id: 'final-warning',
    hour: 21, minute: 30,
    condition: 'daily-incomplete',
    title: '⚠️ Streak at risk!',
    body: 'Unfinished dailies remaining. 2.5 hours left to protect your streak.',
  },
  {
    id: 'all-done-celebration',
    hour: 20, minute: 0,
    condition: 'daily-complete',
    title: '🎉 Daily quests complete!',
    body: 'All habits done today. XP earned. Streak alive. You\'re on fire.',
  },
  {
    id: 'weekly-saturday',
    hour: 11, minute: 0,
    dayOfWeek: 6,
    condition: 'weekly-incomplete',
    title: '📅 Weekly routines check',
    body: 'End of week approaching — have you hit the gym and done your routines?',
  },
];

// ─── INSTALL ──────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'ql-meta').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => startAlarmLoop())
  );
});

// ─── FETCH (offline support) ───────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (url.includes('supabase.co') || url.includes('fonts.googleapis') || url.includes('jsdelivr.net')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ─── MESSAGES FROM APP ────────────────────────────────────────────────────
// App sends completion state every time a task is tapped
self.completionState = null;

self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'COMPLETION_UPDATE') {
    self.completionState = e.data.payload;
    // { allDailyDone: bool, allWeeklyDone: bool, dailyRemaining: int, weeklyRemaining: int }
  }
  if (e.data.type === 'PERMISSION_GRANTED') {
    startAlarmLoop();
  }
});

// ─── ALARM LOOP ───────────────────────────────────────────────────────────
let loopTimer = null;

function startAlarmLoop() {
  if (loopTimer) clearInterval(loopTimer);
  // Check every 60 seconds
  loopTimer = setInterval(checkSchedule, 60 * 1000);
  checkSchedule(); // immediate check on start
}

async function checkSchedule() {
  const now = new Date();
  const hh  = now.getHours();
  const mm  = now.getMinutes();
  const dow = now.getDay();
  const dateKey = now.toISOString().split('T')[0];
  const firedToday = await getFiredToday(dateKey);

  for (const slot of SCHEDULE) {
    if (slot.hour !== hh || slot.minute !== mm) continue;
    if (slot.dayOfWeek !== undefined && slot.dayOfWeek !== dow) continue;
    if (firedToday.has(slot.id)) continue;

    const fire = evaluateCondition(slot.condition);
    if (!fire) continue;

    await self.registration.showNotification(slot.title, {
      body: slot.body,
      icon: '/QuestLog/icons/icon-192.png',
      badge: '/QuestLog/icons/icon-192.png',
      tag: slot.id,
      renotify: true,
      requireInteraction: false,
      vibrate: [200, 100, 200],
      data: { url: '/QuestLog/', slotId: slot.id, slotBody: slot.body, slotTitle: slot.title },
      actions: [
        { action: 'open',   title: '⚡ Open QuestLog' },
        { action: 'snooze', title: '⏰ Snooze 30 min'  },
      ],
    });

    await markFired(dateKey, slot.id);
  }
}

function evaluateCondition(condition) {
  const s = self.completionState;
  switch (condition) {
    case 'always':           return true;
    case 'daily-incomplete': return s ? !s.allDailyDone   : true;
    case 'daily-complete':   return s ?  s.allDailyDone   : false;
    case 'weekly-incomplete':return s ? !s.allWeeklyDone  : true;
    default:                 return true;
  }
}

// ─── FIRED LOG ────────────────────────────────────────────────────────────
async function getFiredToday(dateKey) {
  try {
    const cache = await caches.open('ql-meta');
    const res = await cache.match('fired:' + dateKey);
    if (!res) return new Set();
    return new Set(await res.json());
  } catch { return new Set(); }
}

async function markFired(dateKey, id) {
  try {
    const existing = await getFiredToday(dateKey);
    existing.add(id);
    const cache = await caches.open('ql-meta');
    await cache.put(
      'fired:' + dateKey,
      new Response(JSON.stringify([...existing]), { headers: { 'Content-Type': 'application/json' } })
    );
  } catch {}
}

// ─── NOTIFICATION CLICK ───────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();

  if (e.action === 'snooze') {
    const { slotTitle, slotBody, slotId } = e.notification.data || {};
    setTimeout(() => {
      self.registration.showNotification('⏰ ' + (slotTitle || 'QuestLog Reminder'), {
        body: slotBody || 'Don\'t forget your habits!',
        icon: '/QuestLog/icons/icon-192.png',
        tag: (slotId || 'snooze') + '-snoozed',
        vibrate: [200, 100, 200],
      });
    }, 30 * 60 * 1000);
    return;
  }

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const open = list.find(c => c.url.includes('QuestLog'));
      if (open) return open.focus();
      return clients.openWindow('/QuestLog/');
    })
  );
});

// ─── PUSH (server-triggered, future use) ──────────────────────────────────
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(d.title || 'QuestLog', {
      body: d.body || 'Check your quests!',
      icon: '/QuestLog/icons/icon-192.png',
    })
  );
});

// Boot the loop immediately when sw loads
startAlarmLoop();
