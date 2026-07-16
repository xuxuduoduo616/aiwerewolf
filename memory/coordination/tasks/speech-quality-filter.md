# Task: speech-quality-filter

## Status

Accepted

## Objective

Speech-library hygiene in `src/services/speechLibrary.ts`: (a) filter out day/discussion picks whose text self-reveals the speaker's hidden role (e.g. a werewolf saying 「私は人狼だ」), and (b) prefer entries matching the current display language (zh default) with graceful fallback — both unit-tested.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/reports/browser-verification-cycle2.md` (Japanese-dominant picks observed in zh mode)

## Context

- **QA evidence (cycle 2)**: speech-library picks are often Japanese-dominant, and day speeches sometimes leak the speaker's hidden role (info leakage that breaks the game, e.g. a werewolf's pick literally saying 「私は人狼だ」/「我是狼人」/"I am a werewolf").
- **Current code** (`src/services/speechLibrary.ts`): `pickSpeech(role, preferTags, round)` loads a per-role JSON pool, filters by day proximity, then applies `isChineseText` with a `>= 3` fallback to the mixed pool — that fallback is why Japanese entries leak through. No leakage filtering exists anywhere. `pickWolfNightSpeech`, `pickSeerReportSpeech`, and `pickMultipleSpeches` build on the same pool.
- **(a) Leakage filter** — for day/discussion picks, exclude entries whose text self-reveals the speaker's hidden role:
  - Werewolf speakers: exclude patterns like `私は人狼`, `我是狼人`, `I am (a )?werewolf` and analogous obvious wolf self-reveals.
  - Also exclude possessed/狂人 self-reveals (`私は狂人`, `我是狂人`, `I am (the )?possessed` and similar).
  - Do **NOT** filter legitimate role claims: Seer CO (预言家/占い師/"I am the seer") is a legit strategy and must remain pickable. Only WEREWOLF self-reveals and possessed/狂人 self-reveals are filtered.
  - The filter must not apply where a wolf self-identifying is fine by design (e.g. wolf night chat among teammates) — scope it to day/discussion picks.
- **(b) Language preference** — prefer entries matching the current display language (zh default; `DisplayLanguage` from `src/i18n/index.ts` if a parameter is added), with graceful fallback to the existing pool when too few match (keep the existing thin-pool threshold spirit — never return '' just because filtering emptied the pool, except where the API already does).
- **API stability**: existing exported functions and their signatures must keep working — `aiOrchestrator` calls them today. Optional parameters with defaults are acceptable; breaking changes are not.
- **Testing**: unit tests with small crafted pools (inject/mock the pool rather than depending on the real 11k-entry corpus) proving: wolf self-reveal excluded in day picks, seer CO retained, possessed self-reveal excluded, language preference honored, fallback when too few matches.
- **Scope boundary**: `speechLibrary.ts` only. Do not restructure the JSON corpus files or touch `aiOrchestrator`.
- **Dependencies**: none.
- **Parallel wave**: wave 3 — may run concurrently with `dead-player-vote-autoresolve` and `en-display-translation-improvement` (non-overlapping paths).

## Allowed changes

- `src/services/speechLibrary.ts`
- Test files (e.g. `src/services/speechLibrary.test.ts`)

## Do not change

- `src/ai/aiOrchestrator.ts` or any caller of speechLibrary.
- `src/data/*_speeches.json` corpus files.
- Public API signatures in a breaking way (additive optional params only).
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. Day/discussion picks for a Werewolf speaker never return an entry matching wolf self-reveal patterns (私は人狼 / 我是狼人 / `I am (a )?werewolf`, and analogous); same for possessed/狂人 self-reveals.
2. Seer role claims (预言家 CO, 占い師 CO, "I am the seer") are NOT filtered and remain pickable.
3. Picks prefer entries in the current display language (zh by default), falling back gracefully to the wider pool when too few matches exist — no empty results introduced.
4. All existing exported functions keep their current signatures working; `aiOrchestrator` compiles and behaves unchanged without modification.
5. Unit tests with crafted pools cover both behaviors (leakage filter incl. the seer-CO exemption, and language preference incl. fallback).
6. Baseline 163 tests still pass, plus the new tests; zero regressions.

## Verification

```bash
npm run test:run   # baseline 163 pass + new tests, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/speech-quality-filter.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
