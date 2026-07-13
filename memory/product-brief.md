---
name: product-brief
description: 完整产品规划文档，需求细节
metadata:
  type: reference
---

# AI Werewolf Product Brief

## Founder Context

Mingzhe Xu is a Beijing international high school student building an original AI social-deduction product as a meaningful independent project for U.S. undergraduate applications.

The product starts from a real Werewolf pain point: new players are often pushed away by toxic online rooms, silent players, rule-breaking, private identity sharing, and low-quality matches. More advanced players also struggle to find consistent high-quality online games, while offline games can be inconvenient or uncomfortable for teenagers.

## Product Goal

Build an immersive AI Werewolf web app where one human player can play full Werewolf matches with AI players. The first public trial target is Netlify, with secure frontend/backend behavior before buying a custom domain.

## First-Stage Requirements

- Prioritize playable core over marketing pages.
- Support only two initial boards:
  - 9-player standard: 3 villagers, 3 werewolves, Seer, Witch, Hunter.
  - 12-player standard: 4 villagers, 4 werewolves, Seer, Witch, Hunter, Idiot.
- Use a black/white/gray sketch-style interface with subtle dynamic village background motion.
- Keep Chinese/English display switching.
- Add player game records.
- Enforce public speaking turns: players can only publicly speak on their own turn.
- Improve AI player speech with real Werewolf slang and contextual reasoning.
- Implement role mechanisms close to standard NetEase-style Werewolf expectations.
- Use server-side Gemini access through Netlify Functions.
- Use Supabase email OTP and database tables for authenticated users and records.

## Technical Defaults

- Frontend: Vite + React + TypeScript.
- Hosting/runtime: Netlify.
- AI proxy: `netlify/functions/genai-proxy.js` with server-side `API_KEY`.
- Auth/database: Supabase Auth email OTP and Supabase Postgres.
- Guest mode remains available for local/demo play; guest records stay local only.

## Supabase Tables

```sql
create table if not exists profiles (
  id uuid primary key,
  email text not null,
  display_name text not null,
  created_at timestamptz default now()
);

create table if not exists game_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  board_id text not null,
  role text not null,
  result text not null,
  rounds int not null,
  summary text not null,
  created_at timestamptz default now()
);
```

## Why

完整产品规划，包含需求细节和数据库设计，供开发时参考。

## How to apply

实现具体功能时，对照此文档确认需求边界和技术约束。

[[project-overview]]
