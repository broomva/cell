#!/usr/bin/env bash
# The billing mode lives in one file. ANTHROPIC_ may appear only in the provider
# and (from S3) the one spawn helper; and no test reads ANTHROPIC_API_KEY from
# the real environment. Exit 1 names every offending line.
set -euo pipefail
cd "$(dirname "$0")/.."
allowed='^(agent/lib/provider\.ts|agent/lib/holon\.ts|test/surface\.test\.ts|test/provider\.test\.ts|scripts/grep-gate\.sh):'
fail=0
hits=$(git grep -n 'ANTHROPIC_' -- 'agent' 'evals' 'scripts' 'test' 2>/dev/null | grep -Ev "$allowed" || true)
if [ -n "$hits" ]; then echo "grep-gate: ANTHROPIC_ outside the provider:"; echo "$hits"; fail=1; fi
tests=$(git grep -n -E 'process\.env\.ANTHROPIC_API_KEY|env\[.ANTHROPIC_API_KEY.\]' -- 'test' 'evals' 2>/dev/null || true)
if [ -n "$tests" ]; then echo "grep-gate: a test reads the real ANTHROPIC_API_KEY:"; echo "$tests"; fail=1; fi
[ "$fail" -eq 0 ] && echo "grep-gate: ok"
exit "$fail"
