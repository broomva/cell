#!/usr/bin/env bash
# Claude Code Stop hook (.claude/settings.json): an agent that changed anything
# (uncommitted, or committed but not yet on origin/main) may not end its turn
# on a red `bun run check`. Exit 2 sends stderr back to the agent and keeps it
# working. On the second consecutive stop (stop_hook_active) it warns
# instead, so a stuck agent cannot loop forever; CI's required checks are the
# hard stop.
set -uo pipefail
cd "$(dirname "$0")/.."
input=$(cat)
dirty=$(git status --porcelain 2>/dev/null)
ahead=""
if git rev-parse --verify -q origin/main >/dev/null; then
  ahead=$(git diff --no-ext-diff --name-only origin/main...HEAD 2>/dev/null)
fi
[ -z "$dirty" ] && [ -z "$ahead" ] && exit 0
if out=$(bun run --silent check 2>&1); then exit 0; fi
echo "cell: \`bun run check\` is red after your changes. Fix it before stopping:" >&2
printf '%s\n' "$out" | tail -n 40 >&2
if printf '%s' "$input" | grep -q '"stop_hook_active": *true'; then exit 0; fi
exit 2
