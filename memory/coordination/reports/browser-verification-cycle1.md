# Browser Verification — Cycle 1

Date: 2026-07-16
Environment: local `npm run dev` (Vite, http://localhost:5173). Note: Netlify Functions do not run locally, so AI speeches come from the local fallback speech pool (the game itself logs this).

## 1. Guest entry flow (P0 regression) — PASS

- Auth panel renders with `lucide-moon` icon above the "AI WEREWOLF" heading and `parchment-border` class on the panel (verified via DOM).
- Set a `window` marker before clicking Guest Trial; after clicking, landed directly in the lobby with 9人/12人 board selection and the marker was still present — **no page reload occurred**. Guest deadlock fix holds.
- Screenshots:
  - `screenshots/01-auth-panel.png`
  - `screenshots/02-lobby-board-selection.png`

## 2. 9-player game / seat stage — PASS

- Selected 新手 difficulty, clicked 9人标准场; game started immediately into night (预言家查验 phase).
- Assigned role: **预言家 (Seer)** — not a werewolf.
- Permission leakage check (non-wolf path): DOM query for `svg.lucide-paw-print` / `[class*="paw"]` returned **0 elements**. No paw badges leaked on any seat. (Wolf-side PawPrint check not exercisable this run since role assignment is random.)
- Seer check on seat 2 (Marcus) returned 查杀/狼人; the seat correctly shows a 查杀 badge (Seer's own private knowledge, expected).
- Screenshots:
  - `screenshots/03-role-reveal-night.png`
  - `screenshots/04-seat-stage-day-discussion.png`

## 3. Language observation — FINDINGS

- **AI speeches are predominantly Japanese** (local fallback pool), with occasional Chinese lines mixed in. Verbatim examples:
  - 2号: 「ええ、明日は霊媒不在を理由にリン軸で進行提案いたしますわ。」
  - 3号: 「私は偽ではありません。メイ白でミオ誘導確認。処刑は拒否します。」
  - 8号 (day 2): 「実験は終了した。私は人狼だ。Kenji、君は役割をうまく演じた。」— note this fallback line has an AI *revealing itself as a werewolf*, a content-quality problem in the fallback pool.
  - Chinese examples (day 2): 4号 「场上3号的表水太虚了，这个位置我要带节奏，一起看发言。」; 5号 「我先不站死边，但6号的视角开得太早，像在带节奏给狼队找抗推位。」
  - Fallback speeches also reference names that don't exist in this game (サクラ, ユミ, リュウジ, Kenji, Agent[01]...), i.e. they are canned lines not matched to the actual seat roster.
- **A language switch button ALREADY EXISTS** in the game header (unlabeled icon button with `lucide-languages` icon, first of three header buttons alongside volume and refresh icons). Clicking it switches the sidebar log system messages to English ("Game Start. You are Seer.", "Night falls.") and replaces AI speeches with the placeholder "Speaks based on game situation."; main game UI (phase names, board title) stays Chinese. The task brief expected no language button yet — flag this to whoever is implementing the language switch to avoid duplication. Screenshot: `screenshots/06-language-toggle-english.png`.
- Screenshot of Japanese speeches: `screenshots/05-ai-speeches-japanese.png`

## 4. Vote summary (P1) — FAIL

- Voted for seat 2; vote resolved (票型：1号→2号，2号→9号，3号→1号，4号→1号，5号→6号，6号→1号，7号→1号，8号→1号，9号→1号; 1号 exiled).
- The sidebar vote summary is a **single flat text pill**, not a structured grouped-by-target layout:
  ```html
  <div class="log-entry-in text-center"><span class="...">票型：1号→2号，2号→9号，...</span></div>
  ```
- Source confirmation: the summary is built as a joined flat string at `/Users/frank/aiwerewolf/src/hooks/useGameState.ts:532`. No grouped vote-summary component exists in the DOM or codebase.
- Screenshot: `screenshots/07-vote-summary-sidebar.png`

## 5. Console health — PASS

- 3 total console messages across the whole session; **0 errors, 0 warnings**. Only info-level React DevTools suggestion. No `/.netlify/functions/*` errors observed in console (app pre-detects local env and uses fallback instead of calling functions).

## Screenshot index

All under `/Users/frank/aiwerewolf/memory/coordination/reports/screenshots/`:

| File | Content |
|---|---|
| 01-auth-panel.png | Login panel with moon icon + parchment border |
| 02-lobby-board-selection.png | Lobby, 9人/12人 boards, difficulty selector |
| 03-role-reveal-night.png | Night start, Seer role reveal |
| 04-seat-stage-day-discussion.png | Day discussion seat stage |
| 05-ai-speeches-japanese.png | Sidebar log with Japanese AI speeches |
| 06-language-toggle-english.png | Existing language toggle switched to English |
| 07-vote-summary-sidebar.png | Flat vote summary pill in sidebar |
