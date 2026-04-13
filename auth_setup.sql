-- ============================================================
-- QuestLog — Auth & Row Level Security Setup
-- ============================================================
-- PREREQUISITES (do these in Supabase Dashboard first):
--
--  1. Authentication → Providers → Email  → Enable
--  2. Authentication → Providers → Google → Enable (add Client ID + Secret)
--  3. Authentication → Providers → GitHub → Enable (add Client ID + Secret)
--  4. Authentication → URL Configuration → add Redirect URL:
--       https://YOUR-DOMAIN/auth.html
--     (replace YOUR-DOMAIN with your GitHub Pages domain, e.g.
--      wvazquez.github.io/questlog)
--
-- THEN: Run this entire file in Supabase → SQL Editor → New Query
-- ============================================================


-- ── PROFILES TABLE ──────────────────────────────────────────
-- Stores display name, admin flag, and avatar per user.
-- Linked to auth.users — deleted automatically when user is deleted.
create table if not exists public.profiles (
  id            uuid        primary key references auth.users(id) on delete cascade,
  display_name  text        not null default 'Hero',
  email         text,
  avatar_emoji  text        not null default '⚔️',
  is_admin      boolean     not null default false,
  created_at    timestamptz default now()
);


-- ── AUTO-CREATE PROFILE + CHARACTER ON SIGNUP ───────────────
-- Fires after every new auth.users row is inserted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Create profile row
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    ),
    new.email
  )
  on conflict (id) do nothing;

  -- Create a fresh character for the new user
  -- (skip if this is the first user who will inherit player1 data instead)
  insert into public.character (user_id)
  values (new.id::text)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── ADMIN HELPER ─────────────────────────────────────────────
-- Returns true if the currently logged-in user has is_admin = true.
-- Uses security definer so it bypasses RLS when checking.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid() limit 1),
    false
  );
$$;


-- ── ENABLE ROW LEVEL SECURITY ────────────────────────────────
alter table public.character          enable row level security;
alter table public.tasks              enable row level security;
alter table public.completions        enable row level security;
alter table public.habits             enable row level security;
alter table public.goals              enable row level security;
alter table public.rewards            enable row level security;
alter table public.reward_redemptions enable row level security;
alter table public.profiles           enable row level security;


-- ── DROP OLD POLICIES (idempotent re-run safety) ─────────────
do $$ begin
  drop policy if exists "character_user_policy"    on public.character;
  drop policy if exists "character_admin_policy"   on public.character;
  drop policy if exists "tasks_user_policy"        on public.tasks;
  drop policy if exists "completions_user_policy"  on public.completions;
  drop policy if exists "habits_user_policy"       on public.habits;
  drop policy if exists "goals_user_policy"        on public.goals;
  drop policy if exists "rewards_user_policy"      on public.rewards;
  drop policy if exists "redemptions_user_policy"  on public.reward_redemptions;
  drop policy if exists "profiles_own_policy"      on public.profiles;
  drop policy if exists "profiles_admin_policy"    on public.profiles;
exception when others then null;
end $$;


-- ── RLS POLICIES ─────────────────────────────────────────────

-- character: own row + admin can read all (for admin panel stats)
create policy "character_user_policy" on public.character
  for all using (auth.uid()::text = user_id);
create policy "character_admin_policy" on public.character
  for select using (public.is_admin());

-- tasks
create policy "tasks_user_policy" on public.tasks
  for all using (auth.uid()::text = user_id);

-- completions
create policy "completions_user_policy" on public.completions
  for all using (auth.uid()::text = user_id);

-- habits
create policy "habits_user_policy" on public.habits
  for all using (auth.uid()::text = user_id);

-- goals
create policy "goals_user_policy" on public.goals
  for all using (auth.uid()::text = user_id);

-- rewards
create policy "rewards_user_policy" on public.rewards
  for all using (auth.uid()::text = user_id);

-- reward_redemptions
create policy "redemptions_user_policy" on public.reward_redemptions
  for all using (auth.uid()::text = user_id);

-- profiles: own full access + admin can read all
create policy "profiles_own_policy" on public.profiles
  for all using (auth.uid() = id);
create policy "profiles_admin_policy" on public.profiles
  for select using (public.is_admin());


-- ============================================================
-- GRANT YOURSELF ADMIN ACCESS
-- ============================================================
-- After signing up, run this (swap in your email):
--
--   UPDATE public.profiles SET is_admin = true
--   WHERE email = 'your@email.com';
--


-- ============================================================
-- MIGRATE EXISTING PLAYER1 DATA TO YOUR NEW ACCOUNT
-- ============================================================
-- 1. Sign up in the app
-- 2. Find your UUID:  SELECT id FROM public.profiles WHERE email = 'your@email.com';
-- 3. Run these 7 updates (replace <YOUR-UUID>):
--
--   UPDATE public.character          SET user_id = '<YOUR-UUID>' WHERE user_id = 'player1';
--   UPDATE public.tasks              SET user_id = '<YOUR-UUID>' WHERE user_id = 'player1';
--   UPDATE public.completions        SET user_id = '<YOUR-UUID>' WHERE user_id = 'player1';
--   UPDATE public.habits             SET user_id = '<YOUR-UUID>' WHERE user_id = 'player1';
--   UPDATE public.goals              SET user_id = '<YOUR-UUID>' WHERE user_id = 'player1';
--   UPDATE public.rewards            SET user_id = '<YOUR-UUID>' WHERE user_id = 'player1';
--   UPDATE public.reward_redemptions SET user_id = '<YOUR-UUID>' WHERE user_id = 'player1';
--
-- 4. Delete the auto-created empty character row (signup trigger made one):
--
--   DELETE FROM public.character WHERE user_id = '<YOUR-UUID>'
--     AND xp = 0 AND total_completed = 0
--     AND id NOT IN (
--       SELECT id FROM public.character WHERE user_id = 'player1'  -- already migrated above
--     );
--
--   (Or simply: DELETE FROM public.character WHERE user_id = '<YOUR-UUID>' AND xp = 0
--    if you haven't earned any XP yet on the new account)
-- ============================================================
