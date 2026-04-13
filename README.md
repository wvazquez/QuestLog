# QuestLog ⚔️

A gamified daily habit tracker and quest system — built as a PWA with real-time Supabase backend.

## Stack
- **Frontend**: Vanilla HTML/CSS/JS — no build step needed
- **Database**: Supabase (Postgres + real-time)
- **Hosting**: GitHub Pages (auto-deploys on push to `main`)
- **Notifications**: PWA Service Worker (push) + WhatsApp via CallMeBot

## Live App
👉 https://wvazquez.github.io/QuestLog/

## Local Development
Just open `index.html` in a browser — no build step needed.

## Deploy
Push to `main` branch → GitHub Actions auto-deploys in ~60 seconds.

## Database
Schema is in `supabase_schema.sql`. Run this once in Supabase → SQL Editor.

## Add to Android Home Screen
1. Open the live URL in Chrome for Android
2. Tap ⋮ menu → "Add to Home Screen"
3. Tap "Add" — it installs like a native app

## Project Structure
```
QuestLog/
├── index.html          # Main app
├── manifest.json       # PWA manifest
├── sw.js               # Service worker (offline + notifications)
├── icons/              # App icons
│   ├── icon-192.png
│   └── icon-512.png
├── supabase_schema.sql # Database setup (run once)
├── generate_icons.py   # Icon generator script
└── .github/
    └── workflows/
        └── deploy.yml  # Auto-deployment
```
