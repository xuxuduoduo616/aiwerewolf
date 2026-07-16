# Browser Verification — Cycle 2

Date: 2026-07-16 · Env: local Vite dev (http://localhost:5173), guest mode, 9-player board.
Screenshots: `memory/coordination/reports/screenshots/cycle2-*.png`

## A. Language toggle — PASS (with one design note)

- **Lobby header**: pill toggle present (Languages icon + "中文"/"EN" label). Screenshot: `cycle2-lobby-lang-zh.png` (before), `cycle2-lobby-lang-en.png` (after).
- **In-game header**: same pill present next to the other header buttons. Screenshot: `cycle2-ingame-logs-en.png`.
- **Toggle works**: clicking switches system log messages between languages instantly. EN mode: "Game Start. You are Werewolf.", "Night falls.", "Wolf teammates: 3号, 7号." zh mode: "游戏开始。你的身份是…", "天黑请闭眼。" etc.
- **Persistence**: `localStorage.werewolf_display_language` set to `"en"` on toggle; survives a full page reload, and after re-entering as guest the pill correctly shows "EN". Verified via `browser_evaluate`.
- **No-network translation on local dev**: no placeholder, no blocking, zero console errors. AI speeches in **zh mode show the original text** (speech-library lines, often Japanese/Chinese mixed).
- **Design note (not a bug, but worth flagging)**: in **EN mode AI speeches do NOT show the original text** — they show the canned English stub from the fallback layer ("Speaks based on game situation.", "Pushes suspicion on Player 1."). This is because logs are bilingual by convention (`message` = English, `translation` = Chinese; `src/i18n/index.ts` `pickLogText`) and the local fallback fills `en` with a generic summary (`src/ai/aiOrchestrator.ts:133,314`). If the requirement is "EN mode shows original speech when no translation exists", this does not hold on local dev.
- **"View original" affordance**: none found on any log entry (no button matching 原文/original). Not present in the current implementation.

## B. VoteSummary structured component — PASS (previous QA report was wrong)

**VoteSummary DOES render.** The previous "only a flat pill" finding is incorrect — it was likely observed during DAY_VOTING/DAY_DISCUSSION, where the component is intentionally hidden.

- **Render condition confirmed in code** (`src/App.tsx:51-57,354`): renders at the bottom of the log sidebar whenever `voteRecords.length > 0` AND phase is neither `DAY_VOTING` nor `DAY_DISCUSSION`.
- **Confirmed live via a 100ms in-page DOM poller** across the vote-resolution transition. VoteSummary ("放逐投票结果") appears the instant the vote resolves and stays visible through: 入夜 → 狼人夜聊/刀人 → 预言家查验 → 女巫行动 → 公布死讯 → and GAME_OVER. It disappears again during the next day's discussion/voting (correct per design — always shows only the latest completed round).
- **Full structured layout verified** (matches `src/components/VoteSummary.tsx`): header "放逐投票结果 / 第 3 天 · 5 票", per-target groups sorted by count with percent bars ("4号 Darius — 3 票 · 60%"), voter chips (5号/6号/8号), abstention block (弃票 — 1号), red exile focal card (放逐出局 · 4号 Darius), collapsible 详情 with voter→target pairs.
- Screenshots: `cycle2-votesummary-sidebar.png`, `cycle2-votesummary-detail.png`.
- **Flat pill redundancy**: the flat "Vote record: 1->3, 2->1, …" (票型) log line still appears once per round. It is redundant for the LATEST round (VoteSummary shows the same data better), but it is the only record of EARLIER rounds since VoteSummary only shows the most recent round. Removing it would lose history; keeping both is defensible.

## C. Console health — PASS

Zero console errors and zero warnings across the entire session (two full guest games). Only 3 info messages (React DevTools notices). No translation-code errors, no /.netlify failures observed.

## Bugs / findings discovered along the way

1. **DAY_VOTING soft-stall when the human player is dead.** After I was exiled on day 1, the day-2 vote never auto-resolved: the phase-transition driver (`src/hooks/useGameState.ts:146-159`) has no `DAY_VOTING` branch — `finishVote` only fires from a human click (`handlePlayerSelect`, line 637-639). The game waited indefinitely (observed 4+ minutes) until the dead spectator clicked the enabled "NO VOTE" button, which unstuck it. VOTE is correctly disabled for a dead player, and the hint says "你已无票，只能旁观本轮投票", but requiring a dead spectator's click to advance AI voting is at minimum confusing UX and arguably a soft-lock. Recommend auto-calling `finishVote(null)` (or a timeout) when `!me.canVote`.
2. **Environment artifact (not an app bug)**: Vite watches `.claude/worktrees/**`; other agents creating worktrees triggered full page reloads mid-game, killing the first test game (guest game state is not persisted). Consider adding `.claude` to `server.watch.ignored` in vite config if multi-agent workflows continue.

## Verdict

| Check | Result |
|---|---|
| A. Language toggle | PASS (note: EN mode shows English stub, not original speech, for fallback AI speeches; no "view original" affordance exists) |
| B. VoteSummary | PASS — renders in all non-discussion/non-voting phases incl. game over; previous QA finding refuted |
| C. Console health | PASS — 0 errors, 0 warnings |
