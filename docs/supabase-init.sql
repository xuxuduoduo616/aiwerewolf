-- ============================================================
-- AI Werewolf — Supabase 数据库初始化 SQL
-- 在 Supabase Dashboard → SQL Editor 中运行此脚本
-- ============================================================

-- 1. 用户档案表
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text not null unique constraint profiles_username_format_check
    check (username = lower(btrim(username)) and username ~ '^[a-z0-9_]{3,40}$'),
  display_name text not null constraint profiles_display_name_check
    check (btrim(display_name) <> '' and char_length(display_name) <= 80),
  created_at timestamptz default now()
);

-- 2. 对局记录表
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

-- 3. 索引（按用户查询战绩加速）
create index if not exists idx_game_records_user
  on game_records(user_id, created_at desc);

-- 4. 启用 Row Level Security
alter table profiles enable row level security;
alter table game_records enable row level security;

-- 5. profiles RLS 策略
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

-- 6. game_records RLS 策略
create policy "用户读取自己的战绩"
  on game_records for select
  using (auth.uid() = user_id);

create policy "用户创建自己的战绩"
  on game_records for insert
  with check (auth.uid() = user_id);

-- ============================================================
-- 验证建表成功（运行后应看到两张表）
select table_name from information_schema.tables
  where table_schema = 'public'
  and table_name in ('profiles', 'game_records');
