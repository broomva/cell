#!/usr/bin/env bash
# The billing mode lives in one file. In agent/ (the app eve runs), only the
# provider may name ANTHROPIC_ or touch the environment at all. (S3's spawn
# helper joins it in the PR that creates it, which is a guarded change.) No test or eval reads the real key. Exit 1 names every
# offending line. A grep, not a parser: it refuses broad patterns on purpose.
set -euo pipefail
cd "$(dirname "$0")/.."
# Portable identifier boundaries: \b is not ERE, and macOS git grep ignores it.
B='(^|[^A-Za-z0-9_$])'
E='([^A-Za-z0-9_$]|$)'

allowed='^agent/lib/provider\.ts:'
fail=0
report() { echo "grep-gate: $1"; echo "$2"; fail=1; }

hits=$(git grep -n 'ANTHROPIC_' -- agent evals 2>/dev/null | grep -Ev "$allowed" || true)
[ -n "$hits" ] && report "ANTHROPIC_ outside the provider:" "$hits"

# The environment is read in the provider only. Any other read in agent/,
# however spelled, is refused rather than parsed: the bare `process`
# identifier, globalThis, Bun, import.meta and require are all out.
envr=$(git grep -n -E "${B}(process|globalThis|Bun|require)${E}|import\\.meta" -- agent 2>/dev/null | grep -Ev "$allowed" || true)
[ -n "$envr" ] && report "environment access outside the provider:" "$envr"

tests=$(git grep -n -E 'ANTHROPIC_API_KEY' -- test evals 2>/dev/null | grep -E "${B}(process|Bun)${E}" || true)
[ -n "$tests" ] && report "a test reads the real ANTHROPIC_API_KEY:" "$tests"

[ "$fail" -eq 0 ] && echo "grep-gate: ok"
exit "$fail"
