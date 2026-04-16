-- ============================================================
-- QuestLog Database Schema
-- Run this entire file in Supabase → SQL Editor → New Query
-- ============================================================

-- 1. CHARACTER TABLE — XP, gold, HP, level, streak
create table if not exists character (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'player1',
  xp integer not null default 0,
  gold numeric(10,2) not null default 0,
  hp integer not null default 100,
  level integer not null default 1,
  streak integer not null default 0,
  best_streak integer not null default 0,
  total_completed integer not null default 0,
  last_active date default current_date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. TASKS TABLE — all daily, weekly, backlog tasks
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'player1',
  name text not null,
  category text not null check (category in ('daily','weekly','backlog')),
  difficulty text not null default 'med' check (difficulty in ('easy','med','hard')),
  xp_reward integer not null default 10,
  gold_reward numeric(6,2) not null default 5,
  priority text check (priority in ('P1','P2','P3','P4')),
  days_of_week integer[] default null, -- e.g. {1,3,5} = Mon,Wed,Fri for weekly tasks
  is_active boolean not null default true,
  sort_order integer default 0,
  parent_id uuid default null references tasks(id) on delete cascade, -- weekly subtask hierarchy
  created_at timestamptz default now()
);

-- 3. COMPLETIONS TABLE — log of every task checked off
create table if not exists completions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'player1',
  task_id uuid not null references tasks(id) on delete cascade,
  completed_at timestamptz default now(),
  completed_date date default current_date,
  xp_earned integer not null default 0,
  gold_earned numeric(6,2) not null default 0
);

-- 4. HABITS TABLE — per-task streak tracking
create table if not exists habits (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'player1',
  task_id uuid not null references tasks(id) on delete cascade unique,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  last_completed date,
  total_completions integer not null default 0
);

-- 5. GOALS TABLE — monthly goals and milestones
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'player1',
  title text not null,
  description text,
  target_date date,
  category text default 'personal',
  status text not null default 'active' check (status in ('active','completed','paused')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 6. REWARDS TABLE — shop items user can buy with gold
create table if not exists rewards (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'player1',
  name text not null,
  description text,
  icon text default '🎁',
  gold_cost numeric(8,2) not null default 50,
  is_active boolean not null default true,
  sort_order integer default 0
);

-- 7. REWARD REDEMPTIONS TABLE — log of rewards spent
create table if not exists reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'player1',
  reward_id uuid not null references rewards(id) on delete cascade,
  redeemed_at timestamptz default now(),
  gold_spent numeric(8,2) not null default 0
);

-- ============================================================
-- SEED DATA — starter tasks and rewards
-- ============================================================

-- Starter daily habits
insert into tasks (name, category, difficulty, xp_reward, gold_reward, sort_order) values
  ('Make the bed',            'daily', 'easy', 10,  5,  1),
  ('Morning facial routine',  'daily', 'easy', 15,  8,  2),
  ('Drink 8 glasses of water','daily', 'easy', 10,  5,  3),
  ('10 min walk / movement',  'daily', 'med',  20, 10,  4),
  ('Evening wind-down routine','daily','easy', 15,  8,  5);

-- Starter weekly routines
insert into tasks (name, category, difficulty, xp_reward, gold_reward, sort_order) values
  ('Gym session',    'weekly', 'hard', 40, 20, 1),
  ('Soccer practice','weekly', 'hard', 35, 18, 2),
  ('Hair treatment', 'weekly', 'med',  25, 12, 3),
  ('Meal prep',      'weekly', 'med',  30, 15, 4);

-- Starter backlog
insert into tasks (name, category, difficulty, xp_reward, gold_reward, priority, sort_order) values
  ('Plan monthly goals',     'backlog', 'hard', 50, 25, 'P1', 1),
  ('Review finances',        'backlog', 'med',  40, 20, 'P1', 2),
  ('Clean and organize space','backlog','med',  30, 15, 'P2', 3);

-- Starter character
insert into character (user_id) values ('player1');

-- Create habit rows for all tasks
insert into habits (task_id, user_id)
select id, 'player1' from tasks where user_id = 'player1';

-- Starter rewards shop
insert into rewards (name, description, icon, gold_cost, sort_order) values
  ('Rest Day',    'Skip one task completely guilt-free',  '😴',  50, 1),
  ('Cheat Meal',  'Enjoy a treat without guilt',          '🍕',  80, 2),
  ('Movie Night', 'Guilt-free screen time session',       '🎬',  60, 3),
  ('Spa Day',     'Full self-care day',                   '💆', 150, 4),
  ('New Gear',    'Treat yourself to something new',      '👟', 200, 5),
  ('Game Time',   '1 hour uninterrupted gaming',          '🎮',  40, 6);

-- ============================================================
-- ENABLE REALTIME on key tables
-- ============================================================
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table character;
alter publication supabase_realtime add table completions;
alter publication supabase_realtime add table habits;
alter publication supabase_realtime add table goals;

-- ============================================================
-- UPDATED_AT trigger function
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_character_updated_at
  before update on character
  for each row execute function update_updated_at();

create trigger set_goals_updated_at
  before update on goals
  for each row execute function update_updated_at();
