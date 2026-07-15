# Project Coordination State

**Last verified:** 2026-07-15  
**Project phase:** Cycles 1-2 committed (P0 + P1 vote-summary + P2 AI infra PoC). Cycle 3 P1 UI design-system in progress.

## Verified Baseline

- Local tests: `npm run test:run` passed 158/158 tests (26 test files).
- Local production build: `npm run build` succeeded.
- Current branch head: `91a8789` (wave 1 + 2 accepted).
- The build has one non-blocking Gemini import warning; see `memory/progress-report.md`.
- No task card is active or accepted yet.

## Release Readiness

| Surface | State | Evidence / Owner |
| --- | --- | --- |
| Game rules and core UI | Locally verified | Tests and production build pass. |
| AI fallback and Gemini integration | Code complete | Requires a real browser game to validate runtime behavior. |
| Supabase schema, RLS, OTP template | Unverified externally | Project owner must verify in Supabase Dashboard. |
| Netlify environment, function, domain | Unverified externally | Project owner must verify deployed behavior and CORS. |
| Metadata, crawler guidance, CSP | Incomplete | Create focused code/config tasks. |
| Full browser E2E playthrough | Not recorded | Test 9-player and 12-player games before public demo. |

## Coordinator Rules

- **Claude Code** plans, creates task cards, reviews reports, accepts work,
  updates this file, and owns commit/push, Netlify deployment, and online
  Supabase/Netlify changes. It does not implement product code in
  `/codex-orchestrator` mode. Before every deployment it reports the intended
  changes/optimizations and waits for the project owner's approval.
- **Codex** owns only one assigned task card, isolated worktree, and matching
  report. It must not edit this file or integrate its own patch. Codex has three
  role skills — `$aiwerewolf-planner`, `$aiwerewolf-coder` (resumable session),
  `$aiwerewolf-debugger`. See `memory/coordination/WORKFLOW.md`.
- **Project owner** approves deployments, secrets, and scope. Dashboard actions
  the owner still performs directly are the Supabase/Netlify external checks.

## Next Work

No worker is currently dispatched. When the project owner selects the scope,
create non-overlapping cards in this order:

1. `legacy-ai-player-cleanup` — delete the unused legacy AI implementation and
   prove no import/regression.
2. `type-safety-cleanup` — replace `any` in authentication and the action type
   cast without changing behavior.
3. `seo-robots` — add metadata and `public/robots.txt`.
4. `netlify-csp` — define a restrictive CSP from actual external dependencies,
   then verify Netlify behavior separately.

## Handoff Protocol

| Status | Owner | Meaning |
| --- | --- | --- |
| Queued | Claude Code | Defined and ready to dispatch. |
| In progress | Codex | Worker has started and owns the card. |
| Blocked | Codex / Claude Code | A report names the decision or external dependency. |
| Ready for review | Codex | Report contains implementation and verification evidence. |
| Accepted | Claude Code | Coordinator reviewed the diff and recorded the resulting state. |

Read `memory/project-overview.md` and `memory/progress-report.md` before
creating a task card. Shared files represent project process, not private agent
conversation history.

Parallel waves may contain only dependency-free tasks with non-overlapping
allowed paths. The default concurrency limit is ten, chosen by task difficulty.
Claude Code reviews each worker patch, applies accepted patches sequentially,
runs combined verification, and only then records `Accepted`.

Each worker worktree starts from the current Git `HEAD`. Shared memory and the
assigned task card are copied into it, but unrelated uncommitted product changes
are intentionally not inherited.
