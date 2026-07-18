# Planning Report: ai-speech-wrong-player-name

Requirement: AI speech references wrong player names / names not in the current
game roster. Diagnosis-first: build a reproducible detection loop before any
fix; fix must be evidence-driven and minimal.

## Cards created (queue order)

| # | Card | Wave | Depends on |
|---|------|------|------------|
| 1 | `tasks/ai-speech-name-detection-harness.md` | Wave 1 (alone) | none |
| 2 | `tasks/ai-speech-roster-name-fix.md` | Wave 2 (alone) | card 1 Accepted |

Strictly sequential — one wave each, no parallelism. Card 2's exact fix scope
is finalized from card 1's evidence report (only CONFIRMED hypotheses get code
changes).

### Why only two cards

A third "translation-protection" card was considered and rejected: translation
referent-protection (H5) and the final output guard (invariant 6 / H8) operate
on the same final-text boundary and would share `translationService.ts` plus
the guard utility — overlapping allowed paths violate the non-overlap rule, and
splitting them risks two half-guards instead of one boundary. If card 1's
evidence shows translation is a dominant independent cause with large scope,
the coordinator can split card 2 at review time.

## The red→green contract

- Card 1 delivers ONE command that FAILS on the current codebase:
  `SPEECH_NAME_AUDIT=1 npx vitest run src/diagnostics/` (wired as
  `npm run audit:speech-names`), plus a static corpus scan
  `node scripts/speech-corpus-name-audit.mjs` (non-zero exit).
- Card 2 must make those exact commands PASS without weakening any detector
  assertion (weakening = automatic FAIL at debugger review).
- Default `npm run test:run` stays green (268+) throughout: audit assertions
  are env-gated so the baseline suite never carries an expected failure.

## Evidence status (what we know vs what card 1 must establish)

Already coordinator-verified (cards must not re-derive, only quantify/attribute):

- Corpus `src/data/*_speeches.json` holds raw AIWolf entities: ≥368 `Agent[XX]`
  entries (werewolf 100, villager 138, seer 83, possessed 47) + many Japanese
  personal names. No name sanitization exists anywhere in code. → H1 evidence
  is strong; card 1 quantifies it exactly per pool.
- `speechLibrary.ts` filters only self-reveals + display language; picked text
  flows to display essentially verbatim (`libText.slice(0,160)`), so corpus
  names reach players directly whenever the library layer fires — which was
  EVERY production game before 2026-07-17 (functions 502'd silently).
- `translationService.ts` prompt has no roster protection; cache key is
  `logId:language` (game-scoping unverified → H6 open).
- `aiOrchestrator.ts` prompts use stable ids (`${p.id}号`), but the wolf-chat
  fallback indexes `aliveGood[i % aliveGood.length]` (H4 candidate) and
  hardcoded fallback lines exist (H7 — appear id-based, needs audit).

Unconfirmed — card 1 must produce verdicts (CONFIRMED/REFUTED/UNTESTABLE-OFFLINE)
for H1–H8, under the strict attribution rule: names from static library/prompt
samples = data un-sanitized / template pollution, never "model memory" (no
fine-tuning exists in this project). H8 (live-model hallucination) is likely
UNTESTABLE-OFFLINE; the fix covers it structurally via the always-in-scope
output guard rather than offline proof.

## Risks

1. **Corpus-edit blast radius** — `*_speeches.json` are large (11,449 entries);
   hand-editing is un-reviewable. Mitigated: sanitization must run through a
   committed, re-runnable script (`scripts/sanitize-speech-corpus.mjs`) with
   per-pool sanitized/dropped stats in the report.
2. **Detector over/under-fitting** — a name detector that's too loose passes
   bad text; too strict flags legitimate game terms (悍跳/金水) or style names.
   Mitigated: fixed roster fixture + explicit AIWolf-name allowlist-of-bad;
   debugger review reproduces both red (pre-fix) and green (post-fix) runs.
3. **Non-determinism** — `Math.random` throughout the pick/fallback paths.
   Card 1 mandates a seeded PRNG and identical counts across two runs.
4. **Gaming the harness** — card 2 could pass by weakening assertions. Both
   cards forbid it explicitly; card 2 may touch `src/diagnostics/` fixtures
   only for a documented fixture bug.
5. **Baseline drift** — audit tests leaking into `npm run test:run` would break
   the 268-test baseline pre-fix. Env-gating (`SPEECH_NAME_AUDIT`) prevents it.
6. **Live-call temptation** — call-chain confirmation must stay dry-run/
   zero-token; no paid calls, no printed keys/auth headers. Encoded in card 1.

## Coordinator notes

- After card 2 is Accepted, the audit command should be considered a permanent
  regression gate (coordinator may fold `audit:speech-names` into CI later —
  out of scope for these cards).
- Deployment of the fix (corpus JSONs change asset hashes) requires owner
  approval per standing rules.
