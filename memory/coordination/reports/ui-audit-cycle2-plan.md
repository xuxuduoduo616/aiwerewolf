# Planning Report — UI Audit Cycle 2 (Implementation Cards)

**Date:** 2026-07-16
**Planner:** $aiwerewolf-planner
**Input:** `memory/coordination/reports/ui-audit-cycle1.md` (36 issues) + coordinator skip/priority directives
**Baseline verified:** HEAD `6137659` (cycle 5 integrated) — `npm run test:run` 231/231 tests, 21 files, pass; `npm run build` assumed green per PROJECT_STATE (not re-run by planner).

## Card List by Priority

### Wave 1 — P0 fix (mandatory)

| Card | Files | Summary |
|---|---|---|
| `speech-timer-autoskip-fix` | `src/hooks/useGameState.ts` + new test | Timer tick `v <= 1 ? null : v - 1` never hits 0, so the `speechTimer !== 0` auto-skip guard never fires — human speech phase stalls forever. Make the tick land on 0 via an exported pure helper (repo pattern: `shouldAutoResolveVote`). |

### Wave 2 — High-impact P1

| Card | Files | Summary |
|---|---|---|
| `action-bar-i18n` | `src/components/ActionBar.tsx` + test | Localize KILL/CHECK/SAVE/POISON/PASS/SHOOT/VOTE/NO VOTE → 刀人/查验/救人/毒药/跳过/开枪/投票/弃票 via `useDisplayLanguage()` inside the component (file-isolated). |
| `quick-speech-buttons` | `src/components/SpeechInput.tsx`, `src/App.tsx` (SpeechInput block), tests | 7 NetEase-style preset buttons (zh/en) above the free-text input; "X号" templates arm a tap-a-player autofill flow using the existing `selectedPlayer` plumbing. |
| `lobby-difficulty-i18n` | `src/types.ts`, `src/App.tsx` (lobby), test | Additive `labelEn`/`descriptionEn` on `DifficultyConfig` (新手→Beginner, 进阶→Intermediate, 高手→Expert) rendered by `displayLanguage`. |
| `phase-labels-i18n` | `src/constants.ts`, `src/App.tsx` (2 expressions), `src/hooks/useGameState.ts` (expose `gameLanguage`), test | `PHASE_LABELS_EN` + `getPhaseLabel(phase, language)`; both render sites use the game language (cycle-5 authority), not the lobby state. |
| `player-card-speaking-status` | `src/hooks/useGameState.ts`, `src/components/PlayerCard.tsx`, `src/App.tsx` (seat stage), test | Track `spokenPlayerIds` per day round (all 5 finish points, reset in `handleDayAnnounce`, hunter re-entry safe); green checkmark + slight dim for 已发言 during discussion. |

### Wave 3 — P2 visual polish

| Card | Files | Summary |
|---|---|---|
| `dead-player-card-readability` | `src/components/PlayerCard.tsx` | One line: `opacity-60 grayscale brightness-[0.5]` → `opacity-75 brightness-[0.65]` so dead players' name/number stay legible. |
| `header-icon-tooltips` | `src/App.tsx` (header block) | `title` + `aria-label` on mute (静音/取消静音 · Mute / Unmute) and return-to-lobby (返回大厅 · Return to lobby) buttons, language-aware. |
| `speech-input-placeholder-i18n` | `src/components/SpeechInput.tsx` + test | Placeholder 轮到你发言... / Your turn to speak... via `useDisplayLanguage()`. |

## Parallel Execution Waves (file-disjoint)

Priority waves above ≠ dispatch waves: several cards share `App.tsx` /
`useGameState.ts` / `SpeechInput.tsx` / `PlayerCard.tsx`, so dispatch is
re-grouped for non-overlapping paths:

| Dispatch wave | Cards (parallel) | Why grouped |
|---|---|---|
| 1 (5 workers) | speech-timer-autoskip-fix, action-bar-i18n, lobby-difficulty-i18n, dead-player-card-readability, speech-input-placeholder-i18n | Fully disjoint files: useGameState / ActionBar / {types, App-lobby} / PlayerCard / SpeechInput. Includes the mandatory P0. |
| 2 (2 workers) | quick-speech-buttons, header-icon-tooltips | Both touch `App.tsx` but in disjoint regions (SpeechInput render block ~307–311 vs header buttons ~220–223); cards mandate region confinement. Sequential integration should merge cleanly; if a conflict appears, integrate quick-speech first and re-apply the 2-line tooltip change manually. |
| 3 (1 worker) | phase-labels-i18n | Shares `App.tsx` + `useGameState.ts` return object with wave 4 — serialized. |
| 4 (1 worker) | player-card-speaking-status | Runs after wave 3 is integrated; also builds on the wave-1 timer fix (its auto-skip effect gains a spoken-mark). |

Integration order within waves follows the table order; run
`npm run test:run` + `npm run build` after each accepted patch per WORKFLOW.

## Dependencies

- `quick-speech-buttons` ← `speech-input-placeholder-i18n` (same file,
  integrated first).
- `player-card-speaking-status` ← `speech-timer-autoskip-fix` (extends the
  auto-skip finish point) and ← `phase-labels-i18n` (shared return object /
  App.tsx, serialization only).
- All other cards: none.

## Risk Notes

1. **`useGameState.ts` contention** — 3 cards touch it (timer fix, phase-labels
   export, spoken tracking). Mitigated by serialization (waves 1→3→4) and
   region-confinement clauses in each card.
2. **P0 timer fix semantics** — after the fix the interval keeps returning 0
   until the effect cleanup runs; cards require the tick helper to be
   idempotent at 0 and the guard to stay null-safe. Debugger should reproduce
   the stall scenario reasoning via the new unit tests.
3. **Test infra reality** — the repo has NO jsdom/@testing-library; all cards
   mandate the existing pure-helper test pattern (`shouldAutoResolveVote`,
   `PlayerCard.wolfvision.test.ts`). Workers must not add DOM test
   infrastructure.
4. **Brief corrections applied:** `DIFFICULTY_CONFIGS` lives in `src/types.ts`
   (not `constants.ts` as in the brief); the current baseline is 231 tests
   (cycle 5), not 216. POISON label follows the brief's 毒药 (audit said 毒人).
5. **`quick-speech-buttons` scope** — the brief listed `useGameState.ts`, but
   the existing `userInput`/`selectedPlayer` plumbing likely makes hook changes
   unnecessary; the card allows the file only with justification.
6. **Visual cards lack automated coverage** (dead-card readability, tooltips,
   badge placement) — coordinator's browser QA pass after integration is the
   real gate; earmark one Playwright walkthrough (guest, 9p) covering: timer
   reaching 0 + auto-skip, quick-speech fill + send, zh/en label spot checks,
   dead-card legibility, spoken badges.

## Skip List (per coordinator directive)

| Item | Reason |
|---|---|
| in-game-language-toggle (audit M05) | Conflicts with deployed cycle 5 — owner explicitly removed the in-game pill; lobby is the sole language authority. `header-icon-tooltips` card explicitly forbids reintroducing it. |
| A12 AI model label removal | Owner wants model transparency badges on AI cards — keep. |
| speech-log-ja-filter (F02) / wolfchat-ja-to-zh-translation (F01) | Data issue: JA-dominant AIWolf corpus needs a data pipeline, not a code change. Future cycle. |
| Backend 502s (B01/B02) | Netlify function ops/debugging, not a UI card. |
| CSP / Cloudflare insights (B03) | Ops config, out of cycle scope. |
| Remaining audit P2/P3 (notes pad, replay panel, timer ring, glossary, keyboard shortcuts, vote arrows, etc.) | Below the impact/effort cut for a 3-cycle budget; candidates for a future cycle. |

## Created Cards

- `memory/coordination/tasks/speech-timer-autoskip-fix.md`
- `memory/coordination/tasks/action-bar-i18n.md`
- `memory/coordination/tasks/quick-speech-buttons.md`
- `memory/coordination/tasks/lobby-difficulty-i18n.md`
- `memory/coordination/tasks/phase-labels-i18n.md`
- `memory/coordination/tasks/player-card-speaking-status.md`
- `memory/coordination/tasks/dead-player-card-readability.md`
- `memory/coordination/tasks/header-icon-tooltips.md`
- `memory/coordination/tasks/speech-input-placeholder-i18n.md`
