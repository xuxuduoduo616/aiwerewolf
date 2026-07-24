# Report: TC-001 Memory Cleanup (2026-07-23)

## Outcome

Status: Ready for review.

Completed a checksum-backed repository-governance checkpoint from Stage 0
baseline `650460360913c3b83c9cd4b706788ec0f82d55ac`. The audit classified
canonical memory, 49 task cards, historical reports/evidence, ADRs, docs,
configuration, skills, and runtime prompt/source surfaces while keeping
sensitive/auth/browser-capture content out of the evidence.

## Changed Files

- Corrected allowed stale and unsupported claims in `README.md` and `AGENTS.md`.
- Retained canonical `.cjs` Functions and removed only the byte-identical
  `payment-escrow.js` and `provider-adapter.js` aliases.
- Added this historical report and the pending coordinator delta.
- Added redacted manifests and the detailed developer audit under
  `.codex-coordinator/runs/20260723T023929Z-b2258e1d/reports/TC-001/`.

## Evidence

- Function duplicate hashes and retained paths are recorded in
  `duplicate-groups.tsv` under the run report directory.
- `scoped-governance-files.tsv` classifies 686 paths by owner, evidence type,
  disposition, digest policy, and rationale.
- `excluded-artifacts.tsv` records sensitive/capture exclusions by path only;
  their contents and hashes were not routed.
- No eligible report text duplicate group was found; every unique/uncertain
  report, ADR, research item, archive, and dual-platform skill was preserved.

## Decisions And Risks

- Historical reports remain evidence only and never override
  `memory/coordination/PROJECT_STATE.md`.
- External speech provenance/license and provider-adapter live status are
  `未验证` until primary or endpoint-specific evidence exists.
- Canonical stale facts were not edited by the worker; exact proposals are in
  `memory/coordination/handoffs/2026-07-23T030000Z-TC-001-memory-cleanup.md`.
- The final Wave 1 baseline commit is coordinator-owned after tester PASS.

## Handoff

Coordinator should validate and apply the pending canonical delta, then route
the combined observable change to an independent tester. No commit, push,
deploy, credential access, or external-service mutation was performed.
