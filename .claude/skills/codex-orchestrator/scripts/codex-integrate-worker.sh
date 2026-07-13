#!/usr/bin/env bash
# Integration script: apply an accepted worker patch to the coordinator worktree.
# Gate: task card must be Ready for review AND meta must say final_verdict=PASS.
set -euo pipefail

task_id="${1:?Usage: codex-integrate-worker.sh <task-id>}"
case "$task_id" in
  *[!a-zA-Z0-9._-]*|'')
    printf 'Invalid task id: %s\n' "$task_id" >&2
    exit 2
    ;;
esac

project_dir="$(git rev-parse --show-toplevel)"
run_dir="$project_dir/memory/coordination/runs"
latest_pointer="$run_dir/$task_id.latest"
task_file="$project_dir/memory/coordination/tasks/$task_id.md"
report_file="$project_dir/memory/coordination/reports/$task_id.md"

[ -f "$latest_pointer" ] || {
  printf 'No worker run found for task: %s\n' "$task_id" >&2
  exit 2
}
IFS= read -r meta_file <"$latest_pointer"
[ -f "$meta_file" ] || {
  printf 'Worker metadata is missing: %s\n' "$meta_file" >&2
  exit 2
}

worktree="$(sed -n 's/^worktree_path=//p' "$meta_file" | tail -n 1)"
patch_file="$(sed -n 's/^patch_file=//p' "$meta_file" | tail -n 1)"
final_verdict="$(sed -n 's/^final_verdict=//p' "$meta_file" | tail -n 1)"
integrated_marker="$meta_file.integrated"

# ---- Gate checks ----------------------------------------------------------
case "$worktree" in
  "$project_dir/.codex-worker-worktrees/"*) ;;
  *) printf 'Refusing unexpected worktree path: %s\n' "$worktree" >&2; exit 2 ;;
esac
[ -f "$task_file" ]  || { printf 'Task card is missing.\n' >&2; exit 2; }
[ -f "$report_file" ]|| { printf 'Worker report is missing.\n' >&2; exit 2; }
[ ! -e "$integrated_marker" ] || {
  printf 'Task patch was already integrated: %s\n' "$task_id" >&2; exit 2; }

# HARD GATE: only debugger PASS patches enter the main tree.
case "$final_verdict" in
  PASS) ;;
  *) printf 'Task verdict is %s, not PASS. Integration refused.\n' "$final_verdict" >&2; exit 2 ;;
esac

grep -q '^Ready for review$' "$task_file" || {
  printf 'Task must be Ready for review before integration: %s\n' "$task_id" >&2; exit 2; }

# ---- Apply ----------------------------------------------------------------
if [ ! -s "$patch_file" ]; then
  touch "$integrated_marker"
  printf 'Task has no code patch to apply: %s\n' "$task_id"
  exit 0
fi

git -C "$project_dir" apply --check "$patch_file"
git -C "$project_dir" apply "$patch_file"
touch "$integrated_marker"

printf 'Applied accepted worker patch for %s. Run project verification before marking Accepted.\n' "$task_id"
