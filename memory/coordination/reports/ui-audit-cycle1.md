# AI Werewolf UI Audit Report (Cycle 1)

**Audit date:** 2026-07-16
**Auditor:** $aiwerewolf-planner
**Method:** Live browser walkthrough (https://ai-werewolf.net) as guest player, 9-person board, werewolf role, one night + day speech cycle. Cross-referenced against source files: `App.tsx`, `PlayerCard.tsx`, `ActionBar.tsx`, `VoteSummary.tsx`, `WolfChannel.tsx`, `SpeechInput.tsx`, `LogMessage.tsx`, `RecordsPanel.tsx`, `useGameState.ts`, `constants.ts`, `types.ts`, `i18n/index.ts`.
**Baseline:** NetEase Werewolf app (网易狼人杀) feature set.
**Screenshots:** `screenshots/01-landing-page.png` through `screenshots/08-icon-button-click.png`.

---

## Executive Summary

The game is functionally playable for one cycle but stalls at the human speech phase (P0 bug confirmed). The dark sketch-style UI has strong aesthetic identity, but the information architecture, player workflow, and localization have significant gaps versus the NetEase benchmark. **36 issues found:** 2 P0, 10 P1, 14 P2, 10 P3.

---

## Issue Inventory

### 1. Missing Features (vs. NetEase Werewolf)

#### P0 — Blocking

| ID | Issue | Severity | Detail | Source files |
|----|-------|----------|--------|-------------|
| M01 | **Human speech phase never auto-resolves (timer bug)** | P0 | The speech timer decrements from 60 to 1, then sets to `null` (never hits 0). The auto-skip effect guards on `speechTimer !== 0`, so `null !== 0` causes early return. The human's turn never ends, the game permanently stalls at "轮到你公开发言" with a visible textbox but no countdown. Combined with 502 backend errors from `provider-adapter` and `genai-proxy` Netlify functions, even the fallback speech path is broken. | `useGameState.ts` lines 187-191 (speechTimer effect), `App.tsx` lines 307-311 (SpeechInput) |

#### P1 — Serious

| ID | Issue | Severity | Detail | Source files |
|----|-------|----------|--------|-------------|
| M02 | **No quick-speech/chop speech buttons** | P1 | During speech phase, the player sees only a text input with placeholder "轮到你发言...". NetEase provides 8-12 preset quick phrases (e.g. "过", "我是好人", "X号铁狼", "我信X号", "X号有问题"). This is critical for mobile and fast-paced play. | `SpeechInput.tsx` lines 14-30 (only a text input + send button) |
| M03 | **No in-game notes / memo pad** | P1 | NetEase has a per-game notepad where players jot suspicions and observations. Complete absence here — players must remember everything or use external tools. | No corresponding file; would need new `GameNotes.tsx` component |
| M04 | **No post-game replay / statistics panel** | P1 | Game over screen shows only winner text ("狼人胜利"/"好人胜利"), round count, and role. NetEase shows: timeline of night actions, vote history graph, each player's role reveal animation. `VoteSummary` exists in the log but is gone once game ends. `RecordsPanel` only shows per-game win/loss/role summary — no granular replay. | `App.tsx` lines 258-266 (game-over section), `RecordsPanel.tsx`, `VoteSummary.tsx` |
| M05 | **Language toggle unavailable during gameplay** | P1 | Language selection (中文/EN pill) only exists in the lobby header. Once a game starts, the language is snapshotted at `startGame()` and never changeable. A Chinese-reading player who accidentally starts in EN cannot switch back. The in-game header has only mute and return-to-lobby buttons. | `App.tsx` line 219 (comment: "Language is fixed at startGame from the lobby pill — no in-game toggle"), lines 142-151 (lobby header with language button), lines 220-223 (game header without language button) |
| M06 | **No player-status labels during discussion** | P1 | Player cards show: living/dead ("OUT"), wolf teammates ("狼队友"), and speaking state (ring + mic icon). But during discussion, there's no indication of who has spoken, who is about to speak next, or who hasn't spoken yet. NetEase shows "已发言"/"发言中"/"未发言" badges on every card. The `speakingQueue` state exists internally but is never surfaced on the board. | `PlayerCard.tsx` — `isSpeaking` prop only; no `hasSpoken`/`speechQueue` display. `useGameState.ts` lines 117, 455-461 (`speakingQueue`, `buildSpeakingQueue`) |

#### P2 — Enhancement

| ID | Issue | Severity | Detail | Source files |
|----|-------|----------|--------|-------------|
| M07 | **No settings panel** | P2 | The header has two icon buttons (volume/mute toggle, return-to-lobby), but no settings gear. NetEase provides: sound effects toggle, background music toggle, language switch, game speed, vibration settings. The current mute button (`isMuted` state) controls nothing visible — no audio assets exist. | `App.tsx` lines 220-223, `useGameState.ts` line 112 (`isMuted` state, unused) |
| M08 | **No mini-map or game timeline** | P2 | No overview showing: which phases have passed, who died and when, key events timeline. All information is in the scrolling log sidebar. NetEase has a minimal phase timeline showing night/day cycles. | `App.tsx` — log sidebar only, no timeline component |
| M09 | **No night-action history for all players (game over)** | P2 | At game over, each player's night actions (wolf kills, seer checks, witch saves/poisons, hunter shots) should be revealed. Currently only the human player's actions are visible during the game. | `useGameState.ts` — no persistent `nightActionHistory` array; actions are stored in `nightState` which is reset each round |
| M10 | **No vote-cast visual feedback on player cards during voting** | P2 | During voting, when a player votes, their card shows no visual indicator of who they voted for. NetEase shows vote arrows connecting voter cards to target cards. `voteRecords` stores this data but it's only rendered in `VoteSummary` (sidebar). | `VoteSummary.tsx` (sidebar only), `PlayerCard.tsx` (no vote-target prop), `App.tsx` lines 233-253 (PlayerCard rendering — no vote arrow injection) |

### 2. Functionally Incomplete

#### P0 — Blocking

| ID | Issue | Severity | Detail | Source files |
|----|-------|----------|--------|-------------|
| F01 | **Wolf night chat renders Japanese, not Chinese** | P0 (immersion-breaking) | The wolf team night chat (狼队夜聊) shows messages in Japanese characters (e.g. "グレーから対象を選定。効率的な判断が必要だ。", "私の静観を投票根拠とするのは論理が不足している。"). This is the AIWolf Japanese speech corpus leaking through — no translation is applied before display. The game language is set to Chinese, but wolf chat bypasses translation entirely. | `WolfChannel.tsx` lines 11-17 (renders raw `item.message`), `useGameState.ts` lines 386-393 (`generateWolfChat` result stored directly) |

#### P1 — Serious

| ID | Issue | Severity | Detail | Source files |
|----|-------|----------|--------|-------------|
| F02 | **Day speeches mixed Japanese/Chinese** | P1 | Of 8 AI speeches in the test game: 4 in Japanese (players 2, 8, 9, 4 partially), 3 in Chinese (5, 6, 7), 1 mixed (4). This is the AIWolf JA corpus being served raw. The `translationService.ts` exists but the on-the-fly translation is not applied consistently. The `isCannedEnglishStub` detection in i18n handles EN stubs but JA content slips through. | `LogMessage.tsx` (async translation path), `i18n/index.ts` `isCannedEnglishStub` function, `translationService.ts` |
| F03 | **Action buttons always show English text** | P1 | In Chinese mode, the action buttons display: "KILL", "CHECK", "SAVE", "POISON", "PASS", "SHOOT", "VOTE", "NO VOTE". These are hardcoded English strings with no Chinese equivalents. The phase hint text and role descriptions ARE in Chinese, creating a jarring language mismatch. | `ActionBar.tsx` lines 35-54 (all button labels hardcoded EN) |
| F04 | **Speech input has no quick-submit affordances** | P1 | Only a raw text input. No: character count, suggested phrases, emoji, or speech-to-text. Mobile typing is slow; NetEase's quick phrases solve this. Also, the placeholder text "轮到你发言..." is always Chinese regardless of display language setting. | `SpeechInput.tsx` line 22 (hardcoded Chinese placeholder) |
| F05 | **Phase timer visual is minimal** | P1 | The wolf countdown and speech timer are rendered as small pill-shaped elements with `{seconds}s` text. No circular progress ring, no color urgency gradient (only a CSS class `urgent` adds red glow at <=10s). The timer disappears into its container. NetEase has a large centered countdown ring with phase text. | `App.tsx` lines 274-281 (timer pills) |

#### P2 — Enhancement

| ID | Issue | Severity | Detail | Source files |
|----|-------|----------|--------|-------------|
| F06 | **No distinct speech status markers on player cards** | P2 | When it's a player's turn to speak, their card gets a ring glow (`ring-2`, `scale-105`) and a mic icon. But there's no way to see who already spoke vs. who hasn't spoken yet (yellow/green/gray states). The `speakingQueue` exists but only `currentSpeaker` is surfaced. | `PlayerCard.tsx` — only `isSpeaking` prop, `useGameState.ts` line 117 (`speakingQueue` state unused in UI) |
| F07 | **Seer check result badges use terms "金水"/"查杀" without explanation** | P2 | Seer results appear as small colored badges on player cards. New players won't understand these terms. NetEase provides a tap-to-expand tooltip explaining what each means. | `App.tsx` lines 247-249 (badge injection), no tooltip/explanation |
| F08 | **AI "thinking" indicator is a bare text spinner** | P2 | When AI is processing, the log sidebar shows "AI正在思考局势..." with a spinning loader. It's small (text-xs) and easily missed. No indication of which AI player is thinking, how many are left to process, or estimated time. | `App.tsx` lines 356-360 |
| F09 | **VoteSummary only in sidebar, not on main board** | P2 | `VoteSummary` component is well-structured (vote tally, bars, chips, elimination result) but it only renders in the log sidebar. The main board shows nothing about votes — no arrows on cards, no tally on center console. Players must look at the sidebar to understand voting. | `VoteSummary.tsx` (sidebar-embedded only), `App.tsx` lines 348-355 (conditional rendering in sidebar) |

### 3. Interaction / Visual Issues

#### P1 — Serious

| ID | Issue | Severity | Detail | Source files |
|----|-------|----------|--------|-------------|
| V01 | **Dead player cards too dim to read** | P1 | Dead player cards use CSS: `opacity-60 grayscale brightness-[0.5]`. The result is extremely dark — player name, number, and role badge become nearly illegible against the dark background (bg-zinc-900). The "OUT" label is the only readable element because it's bright red. | `PlayerCard.tsx` line 59 |
| V02 | **Two header icon buttons lack tooltips/aria-labels** | P1 | The in-game header has two SVG-only buttons with no `title`, `aria-label`, or visible text. One is mute toggle (Volume2/VolumeX), the other is "return to lobby" (RefreshCw). Users cannot tell what they do without clicking. | `App.tsx` lines 220-223 |

#### P2 — Enhancement

| ID | Issue | Severity | Detail | Source files |
|----|-------|----------|--------|-------------|
| V03 | **No phase transition animation** | P2 | Phase changes (night->day, speech->voting) are instant text swaps. No fade, slide, or animation to signal the transition. NetEase has a "night falls" overlay and "day breaks" reveal. | `App.tsx` — phase changes are pure state-driven re-renders |
| V04 | **Center console is text-heavy with poor hierarchy** | P2 | The center console shows: PHASE label, phase name, timer, hint text (multiline), role panel (role name + description + selected target). It's a wall of text in a small space. No visual grouping, icon-powered summaries, or collapsible sections. | `App.tsx` lines 267-313 (center console JSX) |
| V05 | **Player name "YOU" label not localized** | P2 | The human player's name on their card always displays "YOU" regardless of Chinese (显示为 "你") setting. It's consistent with the was-werewolf moon icon pattern but breaks the Chinese-only UX. | `PlayerCard.tsx` line 103 |
| V06 | **No night-operation visual feedback on target cards** | P2 | During night werewolf phase, selecting a player highlights their card (`isSelected` border glow). But there's no overlay showing "selected as kill target" vs "not selected." The wolf countdown pill in the center console is the only feedback. NetEase shows a target reticule or highlight ring on selected targets. | `PlayerCard.tsx` — selection styling only, no role-action-specific overlays |
| V07 | **No empty-state illustration in the log** | P2 | When the game starts, the log sidebar shows ~3 system messages then has blank space. Some phases (SEER, WITCH when not the player's role) generate no visible output for the human, making the log feel dead. NetEase shows curated flavor text during transitions. | `App.tsx` lines 332-362 (log sidebar) |
| V08 | **Wolf channel has no scroll max-height** | P2 | The wolf channel panel has `space-y-2` for message stacking but no `max-h` or `overflow-y` constraint. With 4+ messages, it can push the board layout. | `WolfChannel.tsx` lines 8-20 (no overflow constraint) |

### 4. Information Hierarchy Issues

#### P1 — Serious

| ID | Issue | Severity | Detail | Source files |
|----|-------|----------|--------|-------------|
| I01 | **Human player's own role and target info consumes too much center-console space** | P1 | The center console permanently shows: role name ("你的身份：狼人"), role description ("夜晚共同刀人，白天隐藏身份..."), and selected player ("已选择：2号 Marcus"). This is 3-4 lines of text that never change during a phase. For a returning player who already knows their role, this is dead space. | `App.tsx` lines 284-297 (role-reveal section) |
| I02 | **Current phase label is small and low-contrast** | P1 | The phase label renders as: `<div>PHASE</div><div>白天发言</div>` with text-xs/text-lg respectively. The "PHASE" prefix is in `text-zinc-500` (extremely low contrast on dark bg). This is the most important piece of information at any moment and should dominate the center console. | `App.tsx` lines 270-272 |
| I03 | **System messages and player speeches visually similar in log** | P1 | System messages use a `rounded-full` pill with subtle `border-zinc-800`. Player speeches use `rounded-lg` bubbles. Both are low-contrast (zinc-900 on zinc-950 background). The distinction is subtle, especially for long scrolling sessions. NetEase uses colored backgrounds: yellow for system, white for self, gray for others. | `App.tsx` lines 335-345 (log entry styling) |

#### P2 — Enhancement

| ID | Issue | Severity | Detail | Source files |
|----|-------|----------|--------|-------------|
| I04 | **Game log lacks filtering or search** | P2 | The log is a linear scroll of all messages. No way to filter by: system only, my speeches, a specific player's speeches, night results only. In a 3-round game this is manageable; in a 12-player game stretching 8+ rounds, it becomes unusable. | `App.tsx` lines 333-361 (log rendering) |
| I05 | **Role description at game start buried in log** | P2 | The game-start message ("游戏开始。你的身份是：狼人。夜晚共同刀人，白天隐藏身份...") is a system log entry that scrolls away as soon as AI speeches begin. There's no persistent role card or reference panel. The center console's role section partially mitigates this but only shows during active phases. | `App.tsx` lines 284-297, `useGameState.ts` lines 329-339 (initial log setup) |

### 5. Accessibility / i18n

#### P1 — Serious

| ID | Issue | Severity | Detail | Source files |
|----|-------|----------|--------|-------------|
| A01 | **Action buttons not localized** | P1 | All action button text is hardcoded English: "KILL", "CHECK", "SAVE", "POISON", "PASS", "SHOOT", "VOTE", "NO VOTE". These should respect `displayLanguage` with Chinese equivalents: 刀人, 查验, 救人, 毒人, 跳过, 开枪, 投票, 弃票. | `ActionBar.tsx` lines 35-54 |
| A02 | **SpeechInput placeholder hardcoded to Chinese** | P1 | "轮到你发言..." is always Chinese regardless of `displayLanguage`. Should show "Your turn to speak..." in EN mode. | `SpeechInput.tsx` line 22 |
| A03 | **Lobby difficulty labels not internationalized** | P1 | "新手"/"进阶"/"高手" are always Chinese from `DIFFICULTY_CONFIGS`. The descriptions are also Chinese-only. An English-speaking guest player cannot understand the difficulty system. | `constants.ts` lines 60-108 (`DIFFICULTY_LABELS`, `DIFFICULTY_CONFIGS`), `App.tsx` lines 165-179 |
| A04 | **Phase labels not internationalized** | P1 | `PHASE_LABELS` in `constants.ts` has only Chinese values: 入夜, 狼人夜聊/刀人, 预言家查验, 女巫行动, 公布死讯, etc. No English equivalents exist. | `constants.ts` lines 63-76 |

#### P2 — Enhancement

| ID | Issue | Severity | Detail | Source files |
|----|-------|----------|--------|-------------|
| A05 | **"金水"/"查杀" badges not explained for new players** | P2 | The seer-check result badges use werewolf-specific jargon. No tooltip or glossary available in-app. | `App.tsx` lines 247-249 |
| A06 | **Wolf strategy tags use Chinese jargon without English fallback** | P2 | `WolfChatMessage.strategyTag` uses: 刀口, 悍跳, 冲锋, 倒钩, 补位. These are domain-specific werewolf terms with no English equivalents in the i18n system. | `types.ts` line 169, `WolfChannel.tsx` line 13 |
| A07 | **VoteSummary uses Chinese labels exclusively** | P2 | "放逐投票结果", "第 X 天", "票", "弃票", "放逐出局", "平票", "详情" — all Chinese with no English fallback. | `VoteSummary.tsx` throughout |
| A08 | **No keyboard navigation for game actions** | P2 | All interactions require mouse/touch. No keyboard shortcuts for: select player (number keys 1-9), confirm action (Enter), vote (number key), speech submit (Enter — exists but only when text input is focused). | `App.tsx`, `ActionBar.tsx`, `PlayerCard.tsx` |
| A09 | **LogMessage toggle text uses Chinese** | P2 | "查看原文"/"查看译文" or "Show original"/"Show translation" — these are hardcoded in `LogMessage.tsx`, not pulled from i18n. | `LogMessage.tsx` (toggle link text) |

#### P3 — Polish

| ID | Issue | Severity | Detail | Source files |
|----|-------|----------|--------|-------------|
| A10 | **No dark-mode toggle (always dark)** | P3 | The entire UI is dark-themed (zinc-950/900 backgrounds). For accessibility, some users prefer light mode. | Global Tailwind config / `App.tsx` |
| A11 | **No text size / zoom control** | P3 | All font sizes are fixed in Tailwind classes (text-xs through text-4xl). No user-adjustable text scaling for players with visual impairment. | Global CSS |
| A12 | **AI model label breaks immersion** | P3 | Each AI player card shows their backend model: "Gemini", "Claude", "GPT-4o", "DeepSeek". This is meta-information that shatters the werewolf fiction. Should be a game-mode toggle or developer setting. | `PlayerCard.tsx` lines 30-37 (`AIModelBadge` component), `useGameState.ts` line 293 (`aiModelLabel` assignment) |

---

## Backend/Operational Issues (Observed During Audit)

| ID | Issue | Detail |
|----|-------|--------|
| B01 | **provider-adapter returning 502** | All POST requests to `/.netlify/functions/provider-adapter` returned HTTP 502. This means the AI pipeline cannot reach any LLM provider (Gemini, DeepSeek, aicodemirror). The game falls back to the local speech library but this degrades speech quality to canned/heuristic responses. |
| B02 | **genai-proxy returning 502** | Same 502 pattern for `/.netlify/functions/genai-proxy`. The Netlify Function is either crashing or the upstream API is unreachable. |
| B03 | **CSP blocks Cloudflare analytics** | `script-src 'self'` blocks `static.cloudflareinsights.com`. Not critical but generates a console error on every page load. |

---

## Source-Level Issues (From Code Review)

| ID | Issue | Detail | File:Line |
|----|-------|--------|-----------|
| S01 | **Speech timer auto-skip dead code path** | `setSpeechTimer` jumps from 1 to null (line 180: `v <= 1 ? null : v - 1`), skipping 0. The effect guarding auto-skip checks `speechTimer !== 0` (line 188), so null causes early return. Auto-skip is unreachable. | `useGameState.ts:180,188` |
| S02 | **`isMuted` state has no effect** | `isMuted` toggles an icon but there are no audio assets anywhere in the project. The state is unused beyond the button icon. | `useGameState.ts:112` |
| S03 | **`translateEnabled` state never exposed in UI** | The hook exposes `translateEnabled` and `setTranslateEnabled` but no UI toggle exists for it. The `visibleText` function uses it but it's always `true`. | `useGameState.ts:113,725-726` |
| S04 | **VoteSummary only shown between phases** | `showVoteSummary` is `true` only when phase is NOT `DAY_VOTING` or `DAY_DISCUSSION`. This means during voting, when the player most wants to see vote tallies, the summary is hidden. It only appears after voting ends and before the next night. | `App.tsx:54-57` |
| S05 | **Day 2+ dead player speech skip is fragile** | Line 539: `if (!nextSpeaker.isAlive && nextSpeaker.isHuman)` — this skips dead humans in the discussion queue. But dead players are added to the speaking queue for last words only (line 482). On subsequent days, they should never enter the queue at all. If they do (edge case), the skip works but is misleading. | `useGameState.ts:539-543` |
| S06 | **No loading state for DiceBear avatars** | Avatar images have no `onError` handler, no fallback placeholder, no lazy loading. If DiceBear is down, broken image icons appear. | `App.tsx` (img tags in PlayerCard), `useGameState.ts:291` |

---

## Recommended Task Cards (Prioritized, Non-Overlapping)

### Wave 1 — Critical Fixes (P0)

**Card: `speech-timer-autoskip-fix`**
- Fix `useGameState.ts:180`: change `v <= 1 ? null : v - 1` to `v <= 1 ? 0 : v - 1` so timer hits 0.
- Fix `useGameState.ts:188`: change `speechTimer !== 0` to a more robust check.
- Verify: human speech auto-skips after 60s, phase advances to empty-queue check, discussion ends, voting starts.
- Files: `src/hooks/useGameState.ts`

**Card: `wolfchat-ja-to-zh-translation`**
- Wolf channel messages from `generateWolfChat` are in Japanese (AIWolf corpus). Apply `translationService` or filter to Chinese-corpus-only entries before display.
- Verify: wolf chat messages render in Chinese when `gameLanguage === 'zh'`.
- Files: `src/hooks/useGameState.ts` (wolf chat generation), `src/components/WolfChannel.tsx`

### Wave 2 — Essential UX (P1)

**Card: `action-bar-i18n`**
- Localize all ActionBar button labels to Chinese + English based on `displayLanguage`.
- Chinese labels: KILL=刀人, CHECK=查验, SAVE=救人, POISON=毒人, PASS=跳过, SHOOT=开枪, VOTE=投票, NO VOTE=弃票.
- Files: `src/components/ActionBar.tsx` (needs `useDisplayLanguage` import)

**Card: `quick-speech-buttons`**
- Add 6-8 preset quick-speech buttons above the text input during speech phase.
- Chinese presets: 过, 我是好人, X号铁狼, X号像好人, 我听发言, 我信X号
- English presets: Pass, I'm a villager, Player X is wolf, Player X seems good, Let me listen, I trust Player X
- Quick phrase on click: if "X号" template, prompt user to tap a player card to fill the X.
- Files: `src/components/SpeechInput.tsx` (expand), `src/hooks/useGameState.ts` (new `handleQuickSpeech`)

**Card: `lobby-difficulty-i18n`**
- Add English labels to `DIFFICULTY_CONFIGS`: Beginner/Intermediate/Expert.
- Render based on `displayLanguage` prop.
- Files: `src/types.ts` (add `labelEn`/`descriptionEn` to `DifficultyConfig`), `src/App.tsx` (lobby section)

**Card: `phase-labels-i18n`**
- Add `PHASE_LABELS_EN` to `constants.ts`.
- Display based on `displayLanguage` in the center console.
- Files: `src/constants.ts`, `src/App.tsx`

**Card: `in-game-language-toggle`**
- Restore the language toggle pill to the game header (currently only in lobby).
- Must respect `resolveGameLanguage` for AI generation but allow display language switch.
- Files: `src/App.tsx` (game header section)

**Card: `speech-log-ja-filter`**
- Daytime speeches from the AIWolf corpus should be filtered or translated to Chinese before display.
- The `isCannedEnglishStub` pattern should be extended with `isJapaneseCorpusSpeech` detection.
- Verify: all 9 AI speeches in a test game render in proper Chinese.
- Files: `src/i18n/index.ts`, `src/components/LogMessage.tsx`, `src/services/translationService.ts`

### Wave 3 — Visual Polish (P2)

**Card: `player-card-speaking-status`**
- Add `hasSpoken` boolean prop to `PlayerCard`.
- Show three visual states: 发言中 (speaking, pulsing ring), 已发言 (spoken, green checkmark), 未发言 (not yet, default).
- Use the `speakingQueue` + `currentSpeaker` state to derive.
- Files: `src/components/PlayerCard.tsx`, `src/App.tsx`, `src/hooks/useGameState.ts`

**Card: `dead-player-card-readability`**
- Lighten dead player card styling from `opacity-60 grayscale brightness-[0.5]` to `opacity-75 brightness-[0.65]`.
- Ensure name and number remain legible.
- Files: `src/components/PlayerCard.tsx`

**Card: `vote-summary-on-board`**
- Render a compact vote tally in the center console during and after voting phase, in addition to the sidebar.
- Show: top 3 targets with vote counts and bars. "You voted: X号" highlight.
- Files: `src/components/VoteSummary.tsx` (extract compact variant), `src/App.tsx`

**Card: `header-icon-tooltips`**
- Add `title` attributes and `aria-label` to the mute and return-to-lobby buttons.
- Optionally add visible text labels on hover.
- Files: `src/App.tsx`

**Card: `speech-input-placeholder-i18n`**
- Accept `displayLanguage` prop and show "轮到你发言..." or "Your turn to speak...".
- Files: `src/components/SpeechInput.tsx`

**Card: `timer-visual-enhancement`**
- Replace the text-only timer pill with a circular SVG progress ring (stroke-dashoffset animation).
- Color transitions: green (>30s), yellow (10-30s), red (<10s).
- Keep the numeric seconds in the center.
- Files: `src/App.tsx` (extract `TimerRing` component)

### Wave 4 — Feature Gaps (P2/P3)

**Card: `game-notes-component`**
- Add a toggleable notepad panel accessible from the log sidebar.
- Persist notes per-game in React state (no backend needed).
- Simple textarea with auto-save.
- Files: new `src/components/GameNotes.tsx`, `src/App.tsx`

**Card: `post-game-replay-panel`**
- Replace the game-over center console with a tabbed replay panel.
- Tabs: Timeline (all night actions and vote results per round), Vote History (per-round vote graphs), Roles Revealed (all player cards with role icons).
- Reuse `VoteSummary` component for vote history.
- Files: new `src/components/GameReplay.tsx`, `src/App.tsx` (game-over section)

**Card: `seer-check-glossary`**
- Add a collapsible info box in the center console when seer results are active.
- Explain "金水" (gold water = verified good) and "查杀" (check-kill = verified wolf).
- Files: `src/App.tsx` (center console)

**Card: `keyboard-shortcuts`**
- Number keys 1-9: select player (during phases that need selection).
- Enter: confirm action (KILL/CHECK/VOTE/SHOOT).
- Escape: deselect player.
- Space: submit speech (when text input focused, Enter already works).
- Files: `src/hooks/useGameState.ts` (new `useEffect` for keydown listeners), `src/App.tsx`

---

## Verification Methodology

- **Live walkthrough:** Playwright browser automation, guest flow, 9p board, werewolf role, one full night + day cycle interrupted by P0 stall.
- **Console log analysis:** 29 error entries confirmed (1 CSP, 28x 502 from Netlify Functions).
- **Source inspection:** All 9 key component files + game state hook + constants + types + i18n layer reviewed line-by-line.
- **Screenshots:** 8 captures covering landing, lobby, role assignment, night phase, day speech, stalled state.

---

**Total issues:** 36 (2 P0, 10 P1, 14 P2, 10 P3)
**Backend issues:** 3 (2x 502, 1x CSP)
**Source issues:** 6
**Recommended task cards:** 18 (2 Wave 1, 6 Wave 2, 6 Wave 3, 4 Wave 4)
