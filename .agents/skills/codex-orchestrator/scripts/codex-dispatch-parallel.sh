#!/usr/bin/env bash
# macOS ships Bash 3.2, where nounset treats an initialized empty array as
# unbound. Keep errexit and pipefail while validating all external inputs below.
set -eo pipefail

usage() {
  printf 'Usage: codex-dispatch-parallel.sh [--max-workers N] <task-id> [task-id ...]\n'
}

max_workers="${CODEX_MAX_WORKERS:-3}"
task_ids=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --max-workers)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      max_workers="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
    *)
      task_ids[${#task_ids[@]}]="$1"
      shift
      ;;
  esac
done

case "$max_workers" in
  *[!0-9]*|'')
    printf 'Invalid max worker count: %s\n' "$max_workers" >&2
    exit 2
    ;;
esac
[ "$max_workers" -ge 1 ] || {
  printf 'max_workers must be at least 1.\n' >&2
  exit 2
}
[ "${#task_ids[@]}" -gt 0 ] || { usage >&2; exit 2; }
command -v codex >/dev/null 2>&1 || {
  printf 'codex CLI is not available on PATH.\n' >&2
  exit 2
}

project_dir="$(git rev-parse --show-toplevel)"
run_dir="$project_dir/memory/coordination/runs"
worktree_base="$project_dir/.codex-worker-worktrees"
run_stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
run_worktree_dir="$worktree_base/$run_stamp"

if [ -n "$(git -C "$project_dir" status --short --untracked-files=no)" ]; then
  printf 'Warning: workers start from HEAD and will not include uncommitted tracked changes.\n' >&2
  printf 'Do not dispatch tasks that depend on those changes.\n' >&2
fi

required_context=(
  "$project_dir/AGENTS.md"
  "$project_dir/memory/coordination/PROJECT_STATE.md"
  "$project_dir/memory/project-overview.md"
  "$project_dir/memory/progress-report.md"
)
for context_file in "${required_context[@]}"; do
  [ -f "$context_file" ] || {
    printf 'Required shared context is missing: %s\n' "$context_file" >&2
    exit 2
  }
done

validated_ids=()
for task_id in "${task_ids[@]}"; do
  case "$task_id" in
    *[!a-zA-Z0-9._-]*|'')
      printf 'Invalid task id: %s\n' "$task_id" >&2
      exit 2
      ;;
  esac

  for existing_id in "${validated_ids[@]}"; do
    [ "$existing_id" != "$task_id" ] || {
      printf 'Duplicate task id: %s\n' "$task_id" >&2
      exit 2
    }
  done

  task_file="$project_dir/memory/coordination/tasks/$task_id.md"
  [ -f "$task_file" ] || {
    printf 'Task card does not exist: %s\n' "$task_file" >&2
    exit 2
  }
  validated_ids[${#validated_ids[@]}]="$task_id"
done

mkdir -p "$run_dir" "$run_worktree_dir"

worktrees=()
events_files=()
final_files=()
patch_files=()
meta_files=()

# Git worktree metadata is shared, so prepare worktrees sequentially before
# starting Codex processes in parallel.
for task_id in "${task_ids[@]}"; do
  worktree="$run_worktree_dir/$task_id"
  events_file="$run_dir/${task_id}-${run_stamp}.jsonl"
  final_file="$run_dir/${task_id}-${run_stamp}.final.md"
  patch_file="$run_dir/${task_id}-${run_stamp}.patch"
  meta_file="$run_dir/${task_id}-${run_stamp}.meta"

  git worktree add --detach "$worktree" HEAD >/dev/null
  mkdir -p \
    "$worktree/memory/coordination/tasks" \
    "$worktree/memory/coordination/reports"
  cp "$project_dir/AGENTS.md" "$worktree/AGENTS.md"
  cp "$project_dir/memory/coordination/PROJECT_STATE.md" \
    "$worktree/memory/coordination/PROJECT_STATE.md"
  cp "$project_dir/memory/project-overview.md" \
    "$worktree/memory/project-overview.md"
  cp "$project_dir/memory/progress-report.md" \
    "$worktree/memory/progress-report.md"
  cp "$project_dir/memory/coordination/tasks/$task_id.md" \
    "$worktree/memory/coordination/tasks/$task_id.md"
  if [ -d "$project_dir/node_modules" ] && [ ! -e "$worktree/node_modules" ]; then
    ln -s "$project_dir/node_modules" "$worktree/node_modules"
  fi

  {
    printf 'task_id=%s\n' "$task_id"
    printf 'run_stamp=%s\n' "$run_stamp"
    printf 'worktree_path=%s\n' "$worktree"
    printf 'events_file=%s\n' "$events_file"
    printf 'final_file=%s\n' "$final_file"
    printf 'patch_file=%s\n' "$patch_file"
  } >"$meta_file"
  printf '%s\n' "$meta_file" >"$run_dir/$task_id.latest"

  worktrees[${#worktrees[@]}]="$worktree"
  events_files[${#events_files[@]}]="$events_file"
  final_files[${#final_files[@]}]="$final_file"
  patch_files[${#patch_files[@]}]="$patch_file"
  meta_files[${#meta_files[@]}]="$meta_file"
done

run_worker() {
  task_id="$1"
  worktree="$2"
  events_file="$3"
  final_file="$4"
  patch_file="$5"
  meta_file="$6"

  prompt="You are an isolated Codex worker for aiwerewolf. Use the \$aiwerewolf-worker skill. Your assigned task card is memory/coordination/tasks/$task_id.md. Read AGENTS.md and all required files named by the task card before changing anything. Work only within the card's allowed scope. Run its verification. Do not commit, merge, or edit PROJECT_STATE.md. Before finishing, write memory/coordination/reports/$task_id.md and set the copied task card status to Ready for review or Blocked."

  printf '[%s] Codex worker started in %s\n' "$task_id" "$worktree"
  set +e
  codex exec \
    --cd "$worktree" \
    --sandbox workspace-write \
    --ask-for-approval never \
    --json \
    --output-last-message "$final_file" \
    "$prompt" >"$events_file"
  exit_code=$?
  set -e

  if [ -f "$worktree/memory/coordination/reports/$task_id.md" ]; then
    cp "$worktree/memory/coordination/reports/$task_id.md" \
      "$project_dir/memory/coordination/reports/$task_id.md"
  fi
  if [ -f "$worktree/memory/coordination/tasks/$task_id.md" ]; then
    cp "$worktree/memory/coordination/tasks/$task_id.md" \
      "$project_dir/memory/coordination/tasks/$task_id.md"
  fi

  # Intent-to-add makes new worker files visible to git diff. Shared context
  # and handoff files are excluded from the integration patch.
  git -C "$worktree" add -N -- . >/dev/null
  git -C "$worktree" diff --binary -- . \
    ':(exclude)node_modules' \
    ':(exclude)AGENTS.md' \
    ':(exclude)memory/project-overview.md' \
    ':(exclude)memory/progress-report.md' \
    ':(exclude)memory/coordination/**' >"$patch_file"

  {
    printf 'exit_code=%s\n' "$exit_code"
    if [ -s "$patch_file" ]; then
      printf 'has_patch=yes\n'
    else
      printf 'has_patch=no\n'
    fi
  } >>"$meta_file"

  printf '[%s] finished with exit code %s; report=%s; patch=%s\n' \
    "$task_id" "$exit_code" \
    "$project_dir/memory/coordination/reports/$task_id.md" "$patch_file"
  return "$exit_code"
}

overall_status=0
batch_pids=()
batch_ids=()

wait_for_batch() {
  index=0
  while [ "$index" -lt "${#batch_pids[@]}" ]; do
    if wait "${batch_pids[$index]}"; then
      :
    else
      printf '[%s] worker process failed.\n' "${batch_ids[$index]}" >&2
      overall_status=1
    fi
    index=$((index + 1))
  done
  batch_pids=()
  batch_ids=()
}

index=0
while [ "$index" -lt "${#task_ids[@]}" ]; do
  run_worker \
    "${task_ids[$index]}" \
    "${worktrees[$index]}" \
    "${events_files[$index]}" \
    "${final_files[$index]}" \
    "${patch_files[$index]}" \
    "${meta_files[$index]}" &
  batch_pids[${#batch_pids[@]}]=$!
  batch_ids[${#batch_ids[@]}]="${task_ids[$index]}"

  if [ "${#batch_pids[@]}" -ge "$max_workers" ]; then
    wait_for_batch
  fi
  index=$((index + 1))
done

[ "${#batch_pids[@]}" -eq 0 ] || wait_for_batch

printf 'Parallel dispatch complete. Review each report and worktree patch before integration.\n'
printf 'Run directory: %s\n' "$run_dir"
printf 'Worktree directory: %s\n' "$run_worktree_dir"
exit "$overall_status"
