#!/usr/bin/env bash
# The billing mode lives in one file. In agent/ (the app eve runs), only the
# provider (and from S3 the one spawn helper) may name ANTHROPIC_ or read the
# environment by computed key. No test or eval reads the real key. Exit 1
# names every offending line.
set -euo pipefail
cd "$(dirname "$0")/.."
allowed='^(agent/lib/provider\.ts|agent/lib/holon\.ts):'
fail=0
report() { echo "grep-gate: $1"; echo "$2"; fail=1; }

hits=$(git grep -n 'ANTHROPIC_' -- agent evals 2>/dev/null | grep -Ev "$allowed" || true)
[ -n "$hits" ] && report "ANTHROPIC_ outside the provider:" "$hits"

# String-built names (process.env["ANTHROPIC" + "_API_KEY"]) and whole-env reads.
dyn=$(git grep -n -E 'process\.env\[|Bun\.env|import\.meta\.env|Object\.(entries|keys|values)\(process\.env\)' -- agent 2>/dev/null | grep -Ev "$allowed" || true)
[ -n "$dyn" ] && report "computed or whole-environment reads outside the provider:" "$dyn"

tests=$(git grep -n -E 'process\.env\.ANTHROPIC_API_KEY|env\[.ANTHROPIC_API_KEY.\]' -- test evals 2>/dev/null || true)
[ -n "$tests" ] && report "a test reads the real ANTHROPIC_API_KEY:" "$tests"

[ "$fail" -eq 0 ] && echo "grep-gate: ok"
exit "$fail"
