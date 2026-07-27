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
- Use English for application-owned interface terms. Preserve user-authored
  content, AI/player speech or chat, stored historical text, and artwork text
  without misclassifying them as interface chrome.
- Add player game records.
- Enforce public speaking turns: players can only publicly speak on their own turn.
- Improve AI player speech with real Werewolf slang and contextual reasoning.
- Implement role mechanisms close to standard NetEase-style Werewolf expectations.
- Use server-side Gemini access through Netlify Functions.
- Use Supabase email OTP and database tables for authenticated users and records.

## Technical Defaults

- Frontend: Vite + React + TypeScript.
- Hosting/runtime: Netlify.
- AI proxy: `netlify/functions/genai-proxy.cjs` with server-side `API_KEY`.
- Auth/database: Supabase Auth email OTP and Supabase Postgres.
- Guest mode remains available for local/demo play; guest records stay local only.

## Availability Boundaries

- The first-stage product scope enables single-player AI matches, not real-player
  multiplayer rooms. Multiplayer requires the server-authoritative design in
  `memory/decisions/ADR-003-scalable-social-multiplayer-roadmap.md`.
- Lobby activities, faction support, battle pass, and Wolf Village Preview may
  use versioned user-isolated local presentation state, but must not grant
  wallet, backend, premium, multiplayer, or production-asset authority.
- Coin products and balances may remain visible, but purchase controls remain
  unavailable until a separately approved PSP, signed-webhook, idempotency,
  ledger, reconciliation, refund/dispute, and production rollout plan exists.

Accepted implementation evidence for these requirement corrections is retained
under `.codex-coordinator/runs/20260723T023929Z-b2258e1d/`: TC-001 tester R2
for the `.cjs` path, TC-002 tester R1 for payment closure, TC-006 tester R2 for
availability, TC-009 tester R4 for English UI, TC-007 tester R2 for the
integrated matrix, TC-005 tester R11 for final game-room behavior, TC-012 tester
R1 for Function packaging, and TC-011 tester R13/release evidence R6 for the
exact published result. External provider functionality, production orders and
balances, RLS/data, credential rotation, physical devices, and additional
browser engines remain `未验证`.

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
