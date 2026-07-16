#!/usr/bin/env bash
# Production aiwerewolf dispatcher: planning -> coding <-> debugging loop.
#
# plan mode: single planner worker, writes task cards.
# code mode: one coder session + alternating debugger sessions.
#   Coder runs in a resumable Codex session (thread_id captured from JSONL).
#   Debugger reviews; on FAIL the same coder thread is resumed.
#   Returns only the final verdict + paths to the coordinator.
#   Default max 5 repair rounds; exceeding that sets Blocked.
#
# macOS ships Bash 3.2. Keep errexit/pipefail; validate all external inputs.
set -eo pipefail

# ---------------------------------------------------------------------------
# CODEX_PATH — resolve once, use everywhere.
# ---------------------------------------------------------------------------
CODEX_BIN=""
resolve_codex() {
  local c
  c="$(command -v codex 2>/dev/null || true)"
  [ -n "$c" ] && [ -x "$c" ] && { CODEX_BIN="$c"; return 0; }
  [ -x "/opt/homebrew/bin/codex" ] && { CODEX_BIN="/opt/homebrew/bin/codex"; return 0; }
  printf 'FATAL: codex not found in PATH nor /opt/homebrew/bin/codex.\n' >&2
  return 1
}
resolve_codex || exit 2

# ---------------------------------------------------------------------------
# Worker model policy.
# Codex workers run on a confirmed gpt-5.6 model only. CODEX_MODEL must be set
# by the coordinator from codex-model-preflight.sh. If preflight returned
# FALLBACK=claude, the coordinator orchestrates with the current Claude model
# and must NOT call this script: gpt-5.5 is not a permitted worker fallback.
# ---------------------------------------------------------------------------
CODEX_MODEL="${CODEX_MODEL:-}"
case "$CODEX_MODEL" in
  gpt-5.6-*) ;;
  '') printf 'FATAL: CODEX_MODEL unset. Run codex-model-preflight.sh first; on FALLBACK=claude do not dispatch Codex workers.\n' >&2; exit 2 ;;
  *)  printf 'FATAL: refusing worker model "%s"; only gpt-5.6-* is allowed (gpt-5.5 is not a permitted fallback).\n' "$CODEX_MODEL" >&2; exit 2 ;;
esac

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
project_dir="$(git rev-parse --show-toplevel)"
run_dir="$project_dir/memory/coordination/runs"
worktree_base="$project_dir/.codex-worker-worktrees"
mkdir -p "$run_dir"

now_stamp() { date -u +%Y%m%dT%H%M%SZ; }

die() { printf 'FATAL [%s]: %s\n' "$1" "$2" >&2; exit 2; }
log() { printf '[%s] %s\n' "$1" "$2"; }

# All shared context files that every worker worktree must receive.
CONTEXT_FILES=(
  "AGENTS.md"
  "memory/coordination/PROJECT_STATE.md"
  "memory/coordination/WORKFLOW.md"
  "memory/coordination/TASK_TEMPLATE.md"
  "memory/project-overview.md"
  "memory/progress-report.md"
)

copy_context() {
  local wt="$1"
  mkdir -p "$wt/memory/coordination/tasks" "$wt/memory/coordination/reports"
  for f in "${CONTEXT_FILES[@]}"; do
    [ -f "$project_dir/$f" ] && cp "$project_dir/$f" "$wt/$f"
  done
  if [ -d "$project_dir/node_modules" ] && [ ! -e "$wt/node_modules" ]; then
    ln -s "$project_dir/node_modules" "$wt/node_modules"
  fi
}

# Map a task difficulty hint to a reasoning effort override.
# Effort from "low" to "max"; empty => no override (use codex config default).
effort_for_difficulty() {
  case "${1:-medium}" in
    easy|trivial)   printf 'low'    ;;
    medium)         printf 'high'   ;;
    hard|complex)   printf 'xhigh'  ;;
    critical)       printf 'max'    ;;
    *)              printf 'high'   ;;   # default fallback
  esac
}

# Extract thread/session id from a codex --json event stream.
# Codex 0.144 emits {"type":"thread.started","thread_id":"..."} first.
thread_id_from() {
  python3 - "$1" <<'PY'
import sys, json
for l in open(sys.argv[1]):
    l=l.strip()
    if not l: continue
    try: o=json.loads(l)
    except: continue
    if o.get("type")=="thread.started" and o.get("thread_id"):
        print(o["thread_id"]); break
PY
}

sync_back() {
  local wt="$1" task_id="$2"
  for f in "reports/$task_id.md" "reports/$task_id-review.md" "tasks/$task_id.md"; do
    [ -f "$wt/memory/coordination/$f" ] && \
      cp "$wt/memory/coordination/$f" "$project_dir/memory/coordination/$f"
  done
}

set_task_status() {
  local wt="$1" task_id="$2" status="$3"
  local card="$wt/memory/coordination/tasks/$task_id.md"
  [ -f "$card" ] || return 1
  python3 - "$card" "$status" <<'PY'
import sys, re
s=open(sys.argv[1]).read()
s=re.sub(r'(## Status\n\n)(Queued|In progress|Ready for review|Blocked|Accepted)',
         r'\1'+sys.argv[2], s)
open(sys.argv[1],'w').write(s)
PY
}

# Run codex exec and return the exit code (does NOT swallow errors with ||true).
# Exports CODEX_EXIT, CODEX_EVENTS, CODEX_FINAL into the caller's scope via
# file-based capture.
run_codex() {
  local wt="$1" events="$2" final="$3"; shift 3
  local ec=0
  "$CODEX_BIN" exec --cd "$wt" --sandbox workspace-write \
    -c approval_policy="never" -m "$CODEX_MODEL" --skip-git-repo-check --json \
    --output-last-message "$final" "$@" >"$events" 2>&1 || ec=$?
  return "$ec"
}

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat >&2 <<'EOF'
Usage:
  codex-role-loop.sh plan   --requirement <slug> "<requirement text>"
  codex-role-loop.sh code   <task-id> [--max-rounds N]
EOF
  exit 2
}

mode="${1:-}"; shift || true
[ -n "$mode" ] || usage

# ===========================================================================
# PLAN MODE
# ===========================================================================
if [ "$mode" = "plan" ]; then
  req_slug=""; req_text=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --requirement) req_slug="$2"; shift 2 ;;
      *) req_text="$*"; break ;;
    esac
  done
  [ -n "$req_slug" ] && [ -n "$req_text" ] || { printf 'Missing --requirement or text\n' >&2; usage; }
  case "$req_slug" in *[!a-zA-Z0-9._-]*|'') die "plan" "invalid slug: $req_slug" ;; esac

  stamp="$(now_stamp)-$$"
  wt="$worktree_base/$stamp/plan-$req_slug"
  git worktree add --detach "$wt" HEAD >/dev/null 2>&1 || die "plan" "worktree add failed"
  copy_context "$wt"
  events="$run_dir/plan-$req_slug-$stamp.jsonl"
  final="$run_dir/plan-$req_slug-$stamp.final.md"

  prompt="USE SKILL: \$aiwerewolf-planner
Requirement slug: $req_slug
Requirement: $req_text

Read all context files (AGENTS.md, PROJECT_STATE.md, WORKFLOW.md, project-overview.md,
progress-report.md, and TASK_TEMPLATE.md). Then:

1. Decompose into bounded, non-overlapping task cards under memory/coordination/tasks/.
2. Write memory/coordination/reports/planning-$req_slug.md with task list, waves, and risks.
3. Do NOT write product code or edit PROJECT_STATE.md."

  run_codex "$wt" "$events" "$final" "$prompt"
  local ec=$?

  # Sync artifacts back.
  for c in "$wt"/memory/coordination/tasks/*.md; do
    [ -e "$c" ] || continue
    cp "$c" "$project_dir/memory/coordination/tasks/"
  done
  for r in "$wt"/memory/coordination/reports/planning-*.md; do
    [ -e "$r" ] || continue
    cp "$r" "$project_dir/memory/coordination/reports/"
  done

  log "plan" "exit=$ec | report=$run_dir/plan-$req_slug-$stamp.final.md"
  exit "$ec"
fi

# ===========================================================================
# CODE MODE (coder <-> debugger loop)
# ===========================================================================
if [ "$mode" = "code" ]; then
  task_id="${1:-}"; shift || true
  max_rounds=5
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --max-rounds) max_rounds="$2"; shift 2 ;;
      *) usage ;;
    esac
  done
  case "$task_id" in   *[!a-zA-Z0-9._-]*|'') die "code" "invalid task id: $task_id" ;; esac
  case "$max_rounds" in *[!0-9]*|'')          die "code" "invalid max-rounds" ;; esac

  card="$project_dir/memory/coordination/tasks/$task_id.md"
  [ -f "$card" ] || die "code" "task card missing: $card"

  stamp="$(now_stamp)-$$"
  wt="$worktree_base/$stamp/$task_id"
  git worktree add --detach "$wt" HEAD >/dev/null 2>&1 || die "code" "worktree add failed"
  copy_context "$wt"
  cp "$card" "$wt/memory/coordination/tasks/$task_id.md"

  meta="$run_dir/$task_id-$stamp.meta"
  patch_file="$run_dir/$task_id-$stamp.patch"
  { printf 'task_id=%s\nrun_stamp=%s\nworktree_path=%s\npatch_file=%s\n' \
      "$task_id" "$stamp" "$wt" "$patch_file"; } >"$meta"
  printf '%s\n' "$meta" >"$run_dir/$task_id.latest"

  # ---- ROUND 1: fresh coder -------------------------------------------------
  set_task_status "$wt" "$task_id" "In progress"
  coder_events="$run_dir/$task_id-$stamp.coder-r1.jsonl"
  coder_final="$run_dir/$task_id-$stamp.coder-r1.final.md"
  coder_prompt="USE SKILL: \$aiwerewolf-coder
Task card: memory/coordination/tasks/$task_id.md
Read AGENTS.md and all files named by the card. Implement within the allowed
scope, run the card's verification commands, write memory/coordination/reports/$task_id.md.
Leave changes uncommitted. Do NOT edit PROJECT_STATE.md."

  log "$task_id" "coder round 1"
  coder_ec=0; run_codex "$wt" "$coder_events" "$coder_final" "$coder_prompt" || coder_ec=$?

  # Capture thread_id. On failure -> Blocked immediately.
  thread_id="$(thread_id_from "$coder_events")"
  printf 'coder_exit_code=%s\nthread_id=%s\n' "$coder_ec" "$thread_id" >>"$meta"
  sync_back "$wt" "$task_id"

  if [ -z "$thread_id" ]; then
    log "$task_id" "BLOCKED: no thread_id captured from coder session"
    set_task_status "$wt" "$task_id" "Blocked"
    sync_back "$wt" "$task_id"
    printf 'final_verdict=BLOCKED\nreason=no_thread_id\n' >>"$meta"
    exit 1
  fi

  # ---- DEBUGGER LOOP ---------------------------------------------------------
  verdict="FAIL"; round=1; dbg_ec=0
  REVIEW_FAIL=""

  while [ "$round" -le "$max_rounds" ]; do
    dbg_events="$run_dir/$task_id-$stamp.dbg-r$round.jsonl"
    dbg_final="$run_dir/$task_id-$stamp.dbg-r$round.final.md"
    dbg_prompt="USE SKILL: \$aiwerewolf-debugger
Task card: memory/coordination/tasks/$task_id.md
Coder report: memory/coordination/reports/$task_id.md

Reproduce the card's verification commands yourself — do NOT trust the report.
Write memory/coordination/reports/$task_id-review.md.
Last line MUST be exactly VERDICT: PASS or VERDICT: FAIL
Do NOT edit product code."

    log "$task_id" "debugger round $round"
    run_codex "$wt" "$dbg_events" "$dbg_final" "$dbg_prompt" || true
    dbg_ec=$?
    printf 'debugger_r%s_exit_code=%s\n' "$round" "$dbg_ec" >>"$meta"
    sync_back "$wt" "$task_id"

    review="$wt/memory/coordination/reports/$task_id-review.md"
    if [ ! -f "$review" ]; then
      log "$task_id" "BLOCKED: debugger review not found at round $round"
      set_task_status "$wt" "$task_id" "Blocked"
      sync_back "$wt" "$task_id"
      printf 'final_verdict=BLOCKED\nreason=missing_review_r%s\n' "$round" >>"$meta"
      exit 1
    fi

    if grep -qiE '^VERDICT:[[:space:]]*PASS' "$review"; then
      verdict="PASS"
      break
    fi
    [ "$round" -lt "$max_rounds" ] || break

    # ---- RESUME SAME CODER THREAD --------------------------------------------
    round=$((round + 1))
    resume_events="$run_dir/$task_id-$stamp.coder-r$round.jsonl"
    resume_final="$run_dir/$task_id-$stamp.coder-r$round.final.md"
    resume_prompt="Review: memory/coordination/reports/$task_id-review.md
FAIL verdict. Address every unmet criterion and defect precisely.
Stay within the card's allowed scope. Re-run verification. Update
memory/coordination/reports/$task_id.md. Do NOT edit PROJECT_STATE.md."

    log "$task_id" "coder resume round $round (thread $thread_id)"
    run_codex "$wt" "$resume_events" "$resume_final" resume "$thread_id" "$resume_prompt" || true
    printf 'coder_resume_r%s_exit_code=%s\n' "$round" "$?" >>"$meta"
    sync_back "$wt" "$task_id"
  done

  # ---- FINALIZE ------------------------------------------------------------
  if [ "$verdict" = "PASS" ]; then
    set_task_status "$wt" "$task_id" "Ready for review"
  else
    log "$task_id" "BLOCKED: $max_rounds rounds exceeded without PASS"
    set_task_status "$wt" "$task_id" "Blocked"
  fi
  sync_back "$wt" "$task_id"

  # Build patch (exclude shared context).
  git -C "$wt" add -N -- . >/dev/null 2>&1 || true
  git -C "$wt" diff --binary -- . \
    ':(exclude)node_modules' ':(exclude)AGENTS.md' \
    ':(exclude)memory/project-overview.md' ':(exclude)memory/progress-report.md' \
    ':(exclude)memory/coordination/**' >"$patch_file" 2>/dev/null || true

  { printf 'final_verdict=%s\nrounds_used=%s\n' "$verdict" "$round"
    [ -s "$patch_file" ] && printf 'has_patch=yes\n' || printf 'has_patch=no\n'; } >>"$meta"

  printf '\n=== CODE LOOP RESULT ===\n'
  printf 'task_id=%s\nverdict=%s\nrounds=%s\nthread_id=%s\nreport=%s\nreview=%s\npatch=%s\n' \
    "$task_id" "$verdict" "$round" "$thread_id" \
    "$project_dir/memory/coordination/reports/$task_id.md" \
    "$project_dir/memory/coordination/reports/$task_id-review.md" \
    "$patch_file"

  [ "$verdict" = "PASS" ] && exit 0 || exit 1
fi

usage
