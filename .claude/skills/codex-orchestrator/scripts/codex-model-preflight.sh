#!/usr/bin/env bash
# Decide which model the Codex workers should use, or whether to fall back to
# the current Claude Code model.
#
# Probes the gpt-5.6 variants (Sol -> Terra -> Luna by default) through the
# Codex proxy with a tiny read-only request. Prints ONE decision line:
#
#   CODEX_MODEL=<model>   -> a gpt-5.6 model answered; pass it to the workers.
#   FALLBACK=claude       -> no gpt-5.6 model is reachable. Do NOT silently use
#                            gpt-5.5; the coordinator must orchestrate with the
#                            current Claude Code model instead.
#
# Exit 0 = a gpt-5.6 model is usable. Exit 3 = fall back to Claude.
# Never prints CODEX_MODEL=gpt-5.5: gpt-5.5 is intentionally not an option here.
#
# Note: a failing probe is slow because the Codex proxy retries ~5x before it
# gives up. Three dead candidates can take a couple of minutes. This runs once
# per orchestration session.
#
# macOS ships Bash 3.2. Keep errexit/pipefail.
set -eo pipefail

CANDIDATES=("gpt-5.6-Sol" "gpt-5.6-Terra" "gpt-5.6-Luna")
[ "$#" -gt 0 ] && CANDIDATES=("$@")

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

sentinel="CODEX_PROBE_OK_$$"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

# A candidate is usable only if its final assistant message echoes the sentinel.
# Transport errors (503 熔断 / 502 Bad gateway / missing metadata) never write a
# final message, so they fall through to failure.
probe() {
  local model="$1"
  local out="$tmpdir/${model}.out"
  local final="$tmpdir/${model}.final"
  "$CODEX_BIN" exec \
    --sandbox read-only \
    -c approval_policy="never" \
    -c model="$model" \
    -c model_reasoning_effort="low" \
    --skip-git-repo-check \
    --output-last-message "$final" \
    "Reply with exactly this token and nothing else: $sentinel" \
    >"$out" 2>&1 || true
  [ -f "$final" ] && grep -q "$sentinel" "$final" 2>/dev/null
}

for m in "${CANDIDATES[@]}"; do
  printf 'probing %s ...\n' "$m" >&2
  if probe "$m"; then
    printf 'CODEX_MODEL=%s\n' "$m"
    exit 0
  fi
  printf '  %s unavailable\n' "$m" >&2
done

printf 'FALLBACK=claude\n'
exit 3
