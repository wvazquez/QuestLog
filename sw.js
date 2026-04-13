const CACHE = 'questlog-v1';
const ASSETS = [
  '/QuestLog/',
  '/QuestLog/index.html',
  '/QuestLog/manifest.json',
  '/QuestLog/icons/icon-192.png',
  '/QuestLog/icons/icon-512.png',
];

// Install — cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, fallback to cache
self.addEventListener('fetch', e => {
  // Skip Supabase API calls — always go to network
  if (e.request.url.includes('supabase.co')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Push notification handler
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || 'QuestLog';
  const options = {
    body: data.body || 'Time to complete your daily quests!',
    icon: '/QuestLog/icons/icon-192.png',
    badge: '/QuestLog/icons/icon-192.png',
    tag: 'questlog-reminder',
    renotify: true,
    requireInteraction: false,
    actions: [
      { action: 'open', title: '⚡ Open QuestLog' },
      { action: 'dismiss', title: 'Later' }
    ]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Notification click
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes('QuestLog'));
      if (existing) return existing.focus();
      return clients.openWindow('/QuestLog/');
    })
  );
});
