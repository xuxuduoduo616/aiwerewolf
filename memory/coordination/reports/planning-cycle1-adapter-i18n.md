# Planning Report — Cycle 1: Provider Adapter + i18n/Translation

Date: 2026-07-16
Planner baseline: 55/55 tests pass, build clean, HEAD b7a8529, 0 ahead of origin/main.

## Cards created (7)

| Card | Wave | Depends on | Primary paths |
| --- | --- | --- | --- |
| `provider-adapter-refactor` | 1 | none | `netlify/functions/provider-adapter.js`, `netlify/__tests__/provider-adapter.test.js` |
| `language-switch-and-ai-translation` | 1 | none | `src/i18n/**`, `src/services/translationService.ts`, `src/App.tsx` (toggle + log display only) |
| `role-behavior-distillation` | 1 | none | `src/ai/behaviorSchema.ts`, `src/services/roleProfiles.ts` |
| `ai-role-evaluation` | 1 | none | `src/ai/evaluation.ts`, `src/ai/benchmark.ts` (additive) |
| `runtime-model-routing` | 2 | provider-adapter-refactor | `src/ai/geminiAdapter.ts`, optional `src/ai/llmClient.ts` |
| `model-routing-cost-guard` | 2 | provider-adapter-refactor | `netlify/functions/provider-adapter.js` + its test |
| `provider-adapter-dry-run` | 2 | provider-adapter-refactor | `scripts/provider-dry-run.mjs` + test + results report |

## Dependency graph

```
Wave 1 (all independent, non-overlapping paths):
  provider-adapter-refactor
  language-switch-and-ai-translation
  role-behavior-distillation
  ai-role-evaluation

Wave 2 (all depend on provider-adapter-refactor Accepted):
  provider-adapter-refactor ──> runtime-model-routing        (frontend only)
                            ──> model-routing-cost-guard     (edits provider-adapter.js + its test)
                            ──> provider-adapter-dry-run     (imports provider-adapter.js read-only)
```

Soft ordering inside Wave 2: `runtime-model-routing` is path-disjoint from the
other two and can run any time. `model-routing-cost-guard` WRITES
`provider-adapter.js` while `provider-adapter-dry-run` imports it; run them
sequentially (cost-guard first, then dry-run) or accept that dry-run validates
the pre-cost-guard handler and re-run the script after integration.

## Wave grouping rationale

- Wave 1 cards touch four disjoint areas: new Netlify function, frontend display
  layer, AI config/schema, offline evaluation. No shared allowed paths.
- `ai-role-evaluation` intentionally does NOT depend on
  `role-behavior-distillation`: it consumes only the existing backward-compatible
  `RoleBehaviorProfile` API, and distillation is required to keep that API stable.

## Risks

1. **App.tsx contention** — `language-switch-and-ai-translation` is the only
   Wave 1 card allowed to touch `src/App.tsx`, but App.tsx is a hot file for any
   future UI card. Integrate this card's patch early to reduce rebase pain.
2. **provider-adapter.js write contention in Wave 2** —
   `model-routing-cost-guard` edits the file `provider-adapter-dry-run` imports.
   Mitigation is stated on both cards: coordinator sequences them.
3. **Response-contract coupling** — `runtime-model-routing` and
   `model-routing-cost-guard` both rely on the `{text, model_used, cost_estimate,
   fallback_used}` contract; cost-guard is restricted to additive fields only.
4. **vibecoder.store unreachable** — TLS handshake fails from this network
   (per `provider-discovery-initial.md`). Excluded from PROVIDER_REGISTRY;
   revisit after a retest from a different network path.
5. **aicodemirror error shape** — its proxy wraps errors as `{"error": "string"}`
   rather than Anthropic's shape; error classification in
   `provider-adapter-refactor` must handle both (noted in the card context).
6. **Circuit breaker / budget state is per warm Lambda instance** — not global.
   Both cards require this limitation documented in code; it is a soft guard,
   not billing truth.
7. **Live keys unavailable to workers** — all cards are network-free in tests;
   real provider validation is deferred to `provider-adapter-dry-run`'s
   `LIVE_PROBE=true` mode, run manually by the coordinator with env keys, and
   even then only against models endpoints (no token spend).
8. **Japanese detection heuristic** — kana detection distinguishes ja from zh
   reliably, but kanji-only Japanese sentences could be misread as zh; acceptable
   for a display-layer heuristic, fallback is showing the original text.

## Queue recommendation

Dispatch Wave 1 as one parallel wave (4 workers). After
`provider-adapter-refactor` is Accepted and integrated, dispatch
`runtime-model-routing` + `model-routing-cost-guard` in parallel, then
`provider-adapter-dry-run` last.

No secrets appear in any card. All cards verify with `npm run test:run` +
`npm run build` against the 55/55 baseline.
