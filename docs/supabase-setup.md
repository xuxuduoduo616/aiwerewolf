# Supabase 数据库设置

## 1. 建表 SQL

在 Supabase Dashboard → SQL Editor 运行：

```sql
-- 用户档案表
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  created_at timestamptz default now()
);

-- 对局记录表
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

-- 索引：按用户查询战绩
create index if not exists idx_game_records_user on game_records(user_id, created_at desc);
```

## 2. Row Level Security (RLS) 策略

**关键安全步骤** — 没有 RLS，任何人都能读写所有用户数据。

```sql
-- 启用 RLS
alter table profiles enable row level security;
alter table game_records enable row level security;

-- profiles: 用户只能读写自己的档案
create policy "用户读取自己的档案"
  on profiles for select
  using (auth.uid() = id);

create policy "用户创建自己的档案"
  on profiles for insert
  with check (auth.uid() = id);

create policy "用户更新自己的档案"
  on profiles for update
  using (auth.uid() = id);

-- game_records: 用户只能读写自己的战绩
create policy "用户读取自己的战绩"
  on game_records for select
  using (auth.uid() = user_id);

create policy "用户创建自己的战绩"
  on game_records for insert
  with check (auth.uid() = user_id);
```

## 3. 邮箱 OTP 配置

Dashboard → Authentication → Providers → Email：
- ✅ 启用 Email provider
- ✅ 启用 "Confirm email" 关闭（OTP 模式不需要确认链接）
- Dashboard → Authentication → Email Templates → Magic Link：
  - 确保模板包含 `{{ .Token }}`（6位验证码）而非仅 magic link

## 4. 验证 RLS 生效

```sql
-- 以匿名身份测试（应返回空，因为 auth.uid() 为 null）
select * from game_records;
```

## 安全检查清单

- [ ] 两张表都启用了 RLS
- [ ] anon key 只能访问自己的数据（RLS 强制）
- [ ] service_role key **绝不** 出现在前端代码或 git 中
- [ ] `.env.local` 在 `.gitignore` 中
- [ ] Netlify 环境变量已配置（不在代码里硬编码）
