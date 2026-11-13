# AI Quality Report

This report records an offline, reproducible quality check of the AI players in AI Werewolf. It uses three anonymized replays of real local matches played against the local speech-library fallback, converts each replay into a benchmark record with the deterministic evaluation runner, and compares six metrics with published thresholds. The sample is small and local: it is not data from deployed users, and it says nothing about the quality of any external model provider.

## Overview

- **What is measured:** day-vote legality, role consistency, vote rationality, speech repetition, rule-matched hidden-information leakage, and a token-volume cost proxy.
- **Sample:** three anonymous `schemaVersion: 1` replays from local real matches (two nine-player boards, one twelve-player board; all `normal`, `zh`, guest).
- **Measured work:** 69 AI speeches and 62 AI votes. Human speech is omitted and human votes are not evaluated.
- **Headline:** zero illegal vote proposals, zero exact duplicate AI speeches, and zero rule-matched leakage in this sample; one werewolf-to-werewolf vote lowered both 0–1 score metrics to 35/36; the largest proxy cost is 0.001536 USD; every fixture is inside every published bound.
- **Scope:** every number below comes from the committed fixtures and the two commands in [Reproduction](#reproduction). No live model is called while measuring.

A zero rate means "no violation was detected by this rule set in this sample", not that the underlying behavior is impossible.

## Method

```text
anonymous replay (*.replay.json, schemaVersion 1)
  -> ReplayInput / ScriptedTurn        (src/ai/benchmarkFixtures.ts)
  -> runReplay()                       (src/ai/evaluation.ts, deterministic mock provider)
  -> RoleEvaluationReport
       + voteRationalityScore / roleConsistencyScore (derived in benchmarkFixtures.ts)
  -> GameBenchmarkResult               (src/ai/benchmark.ts)
```

- The dataset version is `local-replay-v1` and the method label is `replay-evaluation-runner-v1`.
- Only AI turns are replayed: human speeches (fixed placeholder) and human votes are skipped.
- Within each round, recorded AI speeches are replayed first, then that round's AI votes. Abstentions (`targetId: null`) are not action proposals.
- A recorded vote target is used when it passes the validity filter; otherwise the real action selector supplies the target. The schema has no per-round liveness snapshot, so every seat is treated as alive and only self/unknown targets can be illegal.
- The mock provider echoes the recorded speech. This evaluates the recorded decisions and expression, not live model generation; no network request is made.
- The behavior variant is fixed to `balanced` because the replay does not record that expression-layer setting.
- `estimatedCostUSD` applies a nominal proxy rate of 0.001 USD per 1,000 estimated tokens (about 4 characters per token). It is regression arithmetic, not a price or a bill.

The conversion details and privacy guards are documented in [AI quality benchmark](ai-quality-benchmark.md).

## Samples

| Fixture | Board | Difficulty | Language | Human role | Winner | Rounds | AI speeches | AI votes | `schemaVersion` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `local-9p-001` | `9-standard` | `normal` | `zh` | Werewolf | WEREWOLVES | 2 | 16 | 14 | 1 |
| `local-9p-002` | `9-standard` | `normal` | `zh` | Seer | VILLAGERS | 2 | 14 | 12 | 1 |
| `local-12p-001` | `12-standard` | `normal` | `zh` | Villager | WEREWOLVES | 5 | 39 | 36 | 1 |

- All three matches were played as a guest on the local Vite server at `127.0.0.1:5173` on 2026-11-12, captured with Playwright after `GAME_OVER` from `localStorage['werewolf.replays.v1']`, and sanitized.
- The capture session made zero `/.netlify/functions/` requests and no external model calls. The local speech-library fallback supplied AI expression.
- The human seer in `local-9p-002` was eliminated on night one, so that match has no human public speech; its human votes remain in the replay but are not evaluated.
- `players` contains only seat, role, and human/non-human; human utterances are replaced by `[human speech omitted]`. Details are in the fixture README.

These are local matches, not data from deployed users, and not a population sample.

## Metrics

| Metric | Direction | Unit | Definition |
| --- | --- | --- | --- |
| `roleConsistencyScore` | higher is better | 0–1 ratio | AI votes that did not target a werewolf teammate / all AI votes with a concrete target |
| `illegalActionRate` | lower is better | 0–1 ratio | AI vote proposals rejected by the validity filter / all AI vote proposals |
| `voteRationalityScore` | higher is better | 0–1 ratio | AI votes whose target was in the voter's same-round top-2 suspicion / AI votes with a same-round belief snapshot |
| `speechRepetitionRate` | lower is better | 0–1 ratio | AI speeches whose normalized text was already spoken in the match / all AI speeches |
| `infoLeakageRate` | lower is better | 0–1 ratio | AI speeches matching any of the four `LEAKAGE_RULES` / all AI speeches |
| `estimatedCostUSD` | lower is better | USD (proxy) | estimated prompt + response tokens × 0.001 USD per 1,000 tokens |

Denominators exclude human entries, abstentions, and, for vote rationality, votes without a same-round snapshot. A zero denominator is scored as 1 for the two derived scores. The leakage rules cover a werewolf self-reveal, a werewolf referring to teammates, a non-seer claiming seer checks, and a witch revealing potion state; all four patterns are Chinese-language regexes.

## Results

Values are reported as the measured value with the underlying count in parentheses:

| Fixture | `roleConsistencyScore` | `illegalActionRate` | `voteRationalityScore` | `speechRepetitionRate` | `infoLeakageRate` | `estimatedCostUSD` |
| --- | --- | --- | --- | --- | --- | --- |
| `local-9p-001` | 1.000000 (14/14) | 0.000000 (0/14) | 1.000000 (14/14) | 0.000000 (0/16) | 0.000000 (0/16) | 0.000564 |
| `local-9p-002` | 1.000000 (12/12) | 0.000000 (0/12) | 1.000000 (12/12) | 0.000000 (0/14) | 0.000000 (0/14) | 0.000519 |
| `local-12p-001` | 0.972222 (35/36) | 0.000000 (0/36) | 0.972222 (35/36) | 0.000000 (0/39) | 0.000000 (0/39) | 0.001536 |
| All three | 61/62; minimum 0.972222 | 0/62 | 61/62; minimum 0.972222 | 0/69 | 0/69 | maximum 0.001536 |

All three fixtures are inside every published bound, so both verification commands pass. The only non-perfect scored event is the teammate vote in `local-12p-001` round 1, described as failure case 1. The twelve-player match has the largest proxy cost because it contains the most AI turns (39 speeches and 36 votes); the published cost bound is about 2.6 times this maximum.

The table is the golden conversion output asserted by `benchmark.test.ts` and compared field by field by `--check`. The commands fail on an unsynchronized fixture, golden value, or bound; a deliberate change must update the fixture, the golden table, and the thresholds together.

## Thresholds

The bounds are defined in `src/ai/benchmark.ts` and applied per fixture:

| Constant | Bound | Measured | Margin basis |
| --- | --- | --- | --- |
| `MAX_ILLEGAL_ACTION_RATE` | ≤ 0.10 | 0/62 = 0.000000 | One illegal vote in the smallest fixture is 1/12 ≈ 0.083, rounded up to 0.10 |
| `MAX_SPEECH_REPETITION_RATE` | ≤ 0.08 | 0/69 = 0.000000 | One repeat in the smallest fixture is 1/14 ≈ 0.071, rounded up to 0.08 |
| `MAX_INFO_LEAKAGE_RATE` | ≤ 0.08 | 0/69 = 0.000000 | Same smallest-fixture arithmetic as repetition |
| `MAX_ESTIMATED_COST_USD` | ≤ 0.004 | maximum 0.001536 | About 2.6× the measured maximum, rounded up to 0.004 |
| `MIN_ROLE_CONSISTENCY_SCORE` | ≥ 0.90 | minimum 0.972222 (35/36) | Margin 0.072; one teammate vote in the smallest 12-vote fixture (11/12 ≈ 0.917) still passes |
| `MIN_VOTE_RATIONALITY_SCORE` | ≥ 0.80 | minimum 0.972222 (35/36) | Margin 0.172; two random targets in a 12-vote match (10/12 ≈ 0.833) still pass |

The 0–1 bounds use one additional violation in the smallest relevant denominator, rounded up; the cost bound uses about 2.6× headroom over the measured maximum. These are regression guards for the committed sample, not industry benchmarks and not target quality levels for new models or new samples.

## Failure cases

**1. A werewolf voted for a teammate.**

- **Fixture field:** `local-12p-001.replay.json` → `votes` with `round: 1`, `voterId: 7`; `targetId: 8`; `reason: "（低难度）随机选择"`. `players` shows seats 7 and 8 are both Werewolves.
- **Phenomenon:** the recorded AI vote violates team consistency and was produced by the difficulty randomizer rather than by suspicion evidence.
- **Impact:** `roleConsistencyScore` and `voteRationalityScore` both fall from 36/36 to 35/36 (0.972222). Both remain above their bounds.
- **Status:** observed, inside the published bounds; not repaired. This is the only scored violation in the sample.

**2. Randomized votes are labelled "low difficulty" in normal matches.**

- **Fixture field:** `votes[].reason` across all fixtures. Fourteen of 62 AI votes carry `reason: "（低难度）随机选择"` (7 in `local-12p-001`, 2 in `local-9p-001`, 5 in `local-9p-002`), although every replay has `difficulty: "normal"`.
- **Phenomenon:** the recorded vote rationale is a randomizer label, not an evidence-based reason. The label says "low difficulty" even when the match is normal.
- **Impact:** `voteRationalityScore` checks only whether the chosen target happened to be top-2, so randomized votes can still count as rational; the 61/62 score measures target agreement, not rationale quality.
- **Status:** observed; no current threshold covers rationale text. This is a candidate for a future metric, not a threshold failure.

**3. Public speech contains placeholder-style references and mixed Chinese/Japanese text.**

- **Fixture field:** `local-12p-001.replay.json` → `speeches` with `round: 3`, `speakerId: 10`, whose text contains `@あの人` and `@もう一人`; the same fixture has 14 of 39 AI speeches containing literal `@` tokens and 34 of 39 containing kana, although `language` is `zh`.
- **Phenomenon:** the local speech library emits mixed-language sentences and literal `@...` references instead of clean seat references.
- **Impact:** readability and immersion suffer, and neither `speechRepetitionRate` nor `infoLeakageRate` measures this defect.
- **Status:** observed; outside the six metrics, and not fixed by the benchmark. It is one reason the zero rates are not a language-quality claim.

**4. The leakage detector has a mixed-language blind spot.**

- **Fixture field:** `local-9p-002.replay.json` → `speeches` with `round: 2`, `speakerId: 6` (Witch), text beginning `"あの人 は私の占い師としての洞察を信じる。..."`; the same template appears in `local-12p-001` round 1, seat 11 (Witch).
- **Phenomenon:** a non-seer publicly claims seer insight, but the four `LEAKAGE_RULES` are Chinese-only, so no `leakageFindings` entry is produced and `infoLeakageRate` stays 0.
- **Impact:** the zero rate is a statement about rule coverage, not proof that hidden information never leaks; mixed-language output can evade the current detector.
- **Status:** observed detector gap; documented here as a limitation. No rule-matched leakage finding exists in this sample.

**Not observed in this sample:** illegal vote proposals (0/62), exact normalized duplicate AI speeches (0/69), rule-matched info leakage (0/69), and a cost overrun (maximum 0.001536 against a 0.004 bound). Absence in three local matches is not evidence of absence in general.

## Limitations

- **Local sample, not deployed-user data.** The three matches were played by the developer on a local server. They do not describe live-user behavior, retention, satisfaction, or any external provider's quality.
- **Small sample.** Three matches (one twelve-player, two nine-player), all `normal`, `zh`, and guest. This is too small to compare boards, difficulties, or roles.
- **Incomplete role coverage.** The twelve-player sample uses one role assignment and does not exercise every combination of human and AI roles on that board; only one twelve-player match exists.
- **Fallback expression only.** AI speech comes from the repository's local Chinese/English speech-library fallback. No external provider was called, so no external-provider quality conclusion is possible.
- **Proxy cost only.** `estimatedCostUSD` is token-heuristic arithmetic at a nominal 0.001 USD per 1,000 tokens; the mock provider never calls a model, so this is neither a price nor a bill.
- **Limited replay coverage.** Replays omit night actions, per-round liveness, and system logs. `illegalActionRate` covers day-vote proposals only; a vote for a dead seat is not measurable from this schema.
- **Rule-based leakage detection.** The four rules are Chinese regexes; Japanese or paraphrased claims can be missed, as failure case 4 shows. A zero rate does not prove the absence of leakage.
- **Operational score definitions.** `roleConsistencyScore` only measures whether a wolf voted for a teammate; `voteRationalityScore` only measures top-2 suspicion agreement. Neither is a standard or complete definition of role play.
- **Recorded behavior only.** The runner echoes recorded speech through a mock provider, so it does not evaluate live generation, model variance, or latency.
- **Human content is omitted.** Human speech is a placeholder and human votes are excluded; the report cannot evaluate human players.
- **Thresholds are regression guards.** They are derived from this sample plus explicit margins, not from industry benchmarks; new samples must be measured rather than forced through the current bounds.

## Reproduction

Both commands are offline and require no credentials. Run them from the repository root:

```bash
node scripts/replay-to-benchmark.mjs --check
```

Expected output:

```text
local-12p-001 (12-standard): OK
local-9p-001 (9-standard): OK
local-9p-002 (9-standard): OK
benchmark check: PASS (3 fixtures, golden values and thresholds match, output stable)
```

```bash
npx vitest run src/ai/benchmark.test.ts
```

Expected result: `17 passed` in one test file. The test file asserts the golden values in the Results table, the per-fixture threshold bounds, fixture privacy, and conversion determinism. `--check` independently compares the same golden values and bounds, and verifies that repeated conversion is byte-identical. Neither command calls a model or reads a credential; `--check` has separately been verified to make zero network calls and listen on no port, and the test file runs on the committed fixtures through the mock provider.
