#!/usr/bin/env bash
# Batch parallel role-loop dispatcher for aiwerewolf.
#
# Accepts multiple task IDs, each gets its own independent worktree and thread.
# Each task runs the full codex-role-loop.sh code <task-id> in parallel.
# Default concurrency is chosen by task count/difficulty; max 10.
# Dependent tasks (not in the same wave) wait for producer tasks to be Accepted.
#
# macOS Bash 3.2 compatible.
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLE_LOOP="$SCRIPT_DIR/codex-role-loop.sh"

usage() {
  cat >&2 <<'EOF'
Usage: codex-role-batch.sh [--max-workers N] <task-id> [task-id...]
EOF
}

max_workers="${CODEX_MAX_WORKERS:-5}"
task_ids=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --max-workers)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      max_workers="$2"
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *)
      task_ids[${#task_ids[@]}]="$1"
      shift
      ;;
  esac
done

# Workers run on a confirmed gpt-5.6 model only; CODEX_MODEL propagates via env
# to each codex-role-loop.sh child. On FALLBACK=claude do not call this script.
case "${CODEX_MODEL:-}" in
  gpt-5.6-*) ;;
  '') printf 'FATAL: CODEX_MODEL unset. Run codex-model-preflight.sh first; on FALLBACK=claude do not dispatch Codex workers.\n' >&2; exit 2 ;;
  *)  printf 'FATAL: refusing worker model "%s"; only gpt-5.6-* is allowed (gpt-5.5 is not a permitted fallback).\n' "${CODEX_MODEL}" >&2; exit 2 ;;
esac

case "$max_workers" in *[!0-9]*|'') printf 'Invalid max-workers\n' >&2; exit 2 ;; esac
[ "$max_workers" -ge 1 ] && [ "$max_workers" -le 10 ] || {
  printf 'max-workers must be 1-10\n' >&2; exit 2; }
[ "${#task_ids[@]}" -gt 0 ] || { usage >&2; exit 2; }

project_dir="$(git rev-parse --show-toplevel)"
run_dir="$project_dir/memory/coordination/runs"

# Validate all cards before dispatching any.
for tid in "${task_ids[@]}"; do
  case "$tid" in *[!a-zA-Z0-9._-]*|'') printf 'Invalid task id: %s\n' "$tid" >&2; exit 2 ;; esac
  [ -f "$project_dir/memory/coordination/tasks/$tid.md" ] || {
    printf 'Task card missing: %s\n' "$tid" >&2; exit 2; }
done

printf 'Dispatching %s task(s), max %s workers\n' "${#task_ids[@]}" "$max_workers"

# Run one task through the full code loop.
run_one() {
  local tid="$1"; local ec=0
  local log="$run_dir/batch-$tid-$$.log"
  bash "$ROLE_LOOP" code "$tid" >"$log" 2>&1 || ec=$?
  printf 'BATCH RESULT [%s]: exit=%s (log=%s)\n' "$tid" "$ec" "$log"
  return 0  # never kill the batch on one task failure
}

index=0; running=0; declare -a pids tids

while [ "$index" -lt "${#task_ids[@]}" ]; do
  run_one "${task_ids[$index]}" &
  pids[${#pids[@]}]=$!
  tids[${#tids[@]}]="${task_ids[$index]}"
  running=$((running + 1))
  index=$((index + 1))

  if [ "$running" -ge "$max_workers" ] || [ "$index" -ge "${#task_ids[@]}" ]; then
    i=0
    while [ "$i" -lt "${#pids[@]}" ]; do
      wait "${pids[$i]}" 2>/dev/null || true
      i=$((i + 1))
    done
    running=0; pids=(); tids=()
  fi
done

printf 'Batch wave complete. Logs in %s\n' "$run_dir"
exit 0
