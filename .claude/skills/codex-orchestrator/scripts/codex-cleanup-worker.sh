#!/usr/bin/env bash
set -euo pipefail

task_id="${1:?Usage: codex-cleanup-worker.sh <task-id>}"
case "$task_id" in
  *[!a-zA-Z0-9._-]*|'')
    printf 'Invalid task id: %s\n' "$task_id" >&2
    exit 2
    ;;
esac

project_dir="$(git rev-parse --show-toplevel)"
run_dir="$project_dir/memory/coordination/runs"
latest_pointer="$run_dir/$task_id.latest"

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
case "$worktree" in
  "$project_dir/.codex-worker-worktrees/"*) ;;
  *)
    printf 'Refusing unexpected worktree path: %s\n' "$worktree" >&2
    exit 2
    ;;
esac

if [ -d "$worktree" ]; then
  git -C "$project_dir" worktree remove --force "$worktree"
fi
git -C "$project_dir" worktree prune
printf 'Cleaned worker worktree for %s. Run logs and reports were preserved.\n' "$task_id"
