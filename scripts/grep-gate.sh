#!/usr/bin/env bash
# The billing mode lives in one file. In agent/ (the app eve runs), only the
# provider (and from S3 the one spawn helper) may name ANTHROPIC_ or touch the
# environment at all. No test or eval reads the real key. Exit 1 names every
# offending line. A grep, not a parser: it refuses broad patterns on purpose.
set -euo pipefail
cd "$(dirname "$0")/.."
allowed='^(agent/lib/provider\.ts|agent/lib/holon\.ts):'
fail=0
report() { echo "grep-gate: $1"; echo "$2"; fail=1; }

hits=$(git grep -n 'ANTHROPIC_' -- agent evals 2>/dev/null | grep -Ev "$allowed" || true)
[ -n "$hits" ] && report "ANTHROPIC_ outside the provider:" "$hits"

# The environment is read in the provider only. Any other read in agent/,
# however spelled (an alias, a computed key, globalThis, an import of
# process), is refused rather than parsed.
envr=$(git grep -n -E 'process\.env|globalThis|Bun\.env|import\.meta\.env|["'"'"'](node:)?process["'"'"']' -- agent 2>/dev/null | grep -Ev "$allowed" || true)
[ -n "$envr" ] && report "environment access outside the provider:" "$envr"

tests=$(git grep -n -E 'ANTHROPIC_API_KEY' -- test evals 2>/dev/null | grep -E 'process\.env|Bun\.env' || true)
[ -n "$tests" ] && report "a test reads the real ANTHROPIC_API_KEY:" "$tests"

[ "$fail" -eq 0 ] && echo "grep-gate: ok"
exit "$fail"
