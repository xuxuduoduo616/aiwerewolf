# Supabase 数据库设置

## 1. 建表 SQL

在 Supabase Dashboard → SQL Editor 运行：

```sql
-- 用户档案表
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text not null unique
    check (username = lower(btrim(username)) and username ~ '^[a-z0-9_]{3,40}$'),
  display_name text not null
    check (btrim(display_name) <> '' and char_length(display_name) <= 80),
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

-- game_records: 用户只能读写自己的战绩
create policy "用户读取自己的战绩"
  on game_records for select
  using (auth.uid() = user_id);

create policy "用户创建自己的战绩"
  on game_records for insert
  with check (auth.uid() = user_id);
```

## 3. 邮箱验证码与密码配置

Dashboard → Authentication → Providers → Email：
- 启用 Email provider；新账号走邮箱 + 密码注册，现有账号可选择密码或验证码登录。
- 建议保留 **Confirm email**，新用户通过邮箱验证码证明邮箱所有权后完成档案。不要为解决邮件问题而关闭邮箱验证。
- Authentication → Email Templates：**Confirm signup** 和 **Magic Link** 两个模板都必须包含 `{{ .Token }}`。前端使用输入验证码流程，不依赖确认链接回调。
- 前端支持 6–10 位数字验证码，验证码长度与项目设置保持一致。
- 若启用了 Supabase CAPTCHA，确认 provider 为 Turnstile 且与当前站点配置匹配。前端会把一次性 `captchaToken` 交给注册、密码登录和验证码发送接口，每次请求后重新获取。
- 公开用户邮件应使用已配置的自定义 SMTP（如 Resend），检查发信域名验证、发信配额和投递状态。不要把 SMTP 凭据放入前端或源码。
- 密码仅通过 Supabase Auth 注册／登录接口发送，不写入 `profiles`、用户 metadata 或浏览器持久存储。
- 旧的仅验证码账号继续选择 Verification code 登录；本次未新增密码重置／为旧账号设置密码的界面。
- Guest Trial 不读取、不写入、不迁移游客战绩；旧浏览器战绩数据不删除，游客身份和本地装扮状态保持原机制。

上述内容是配置要求，不代表当前线上邮件模板或 SMTP 已验证。发布前使用受控测试邮箱确认注册验证码、验证码登录、密码登录、刷新恢复和账户战绩写入。

## 4. Existing project identity migration

For an existing `profiles` table, use `docs/profile-identity-migration.sql`
instead of recreating the table. The artifact normalizes or deterministically
backfills Username without using email, preserves every already-valid unique
Username (including values shaped like `player_<32 hex>`), avoids collisions
with preserved handles, keeps Nickname in `display_name`, adds unique/check
constraints, and replaces owner policies with explicit `TO authenticated`,
`USING`, and `WITH CHECK` clauses.

Release order is schema first: apply the approved SQL, independently verify
owner allow/deny behavior and case-equivalent Username collisions, then release
the matching frontend. This repository file is declarative source and is not
evidence that any Supabase project has been changed.

## 5. 验证 RLS 生效

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
