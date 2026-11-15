-- ============================================================
-- AI Werewolf - Supabase schema initialization
-- Run only in an approved Supabase project through its SQL Editor.
-- ============================================================

-- 1. User profiles
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text not null unique constraint profiles_username_format_check
    check (username = lower(btrim(username)) and username ~ '^[a-z0-9_]{3,40}$'),
  display_name text not null constraint profiles_display_name_check
    check (btrim(display_name) <> '' and char_length(display_name) <= 80),
  created_at timestamptz default now()
);

-- 2. Match records
create table if not exists game_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  board_id text not null,
  role text not null,
  result text not null check (result in ('WIN', 'LOSE')),
  rounds int not null check (rounds >= 0),
  summary text not null,
  created_at timestamptz default now()
);

-- 3. Index for a user's recent match records
create index if not exists idx_game_records_user
  on game_records(user_id, created_at desc);

-- 4. Enable row-level security
alter table profiles enable row level security;
alter table game_records enable row level security;

-- 5. Profile policies (legacy policy identifiers retained for compatibility)
create policy "用户读取自己的档案"
  on profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "用户创建自己的档案"
  on profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "用户更新自己的档案"
  on profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

revoke all on table profiles from anon, authenticated;
grant select, insert, update on table profiles to authenticated;

-- 6. Match-record policies (legacy policy identifiers retained for compatibility)
create policy "用户读取自己的战绩"
  on game_records for select
  using (auth.uid() = user_id);

create policy "用户创建自己的战绩"
  on game_records for insert
  with check (auth.uid() = user_id);

-- ============================================================
-- Inspect whether both expected tables exist after an approved installation.
select table_name from information_schema.tables
  where table_schema = 'public'
  and table_name in ('profiles', 'game_records');
