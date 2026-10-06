# Security

## Reporting

Report a vulnerability privately to the owner via a GitHub security advisory on this repository
(**Security → Report a vulnerability**), not in an issue or a PR. Expect an acknowledgement within a week.

## What this repository must never do

These are the boundaries the tests and CI enforce. A change that weakens one is a security bug.

| Boundary | Enforced by |
|---|---|
| The OAuth grant never enters the eve process; it lives in `holon` and reaches the app only as a per-run loopback key | `agent/lib/provider.ts`, `test/provider.test.ts`, mutants `provider-*` |
| The sidecar is loopback-only; the provider refuses any other base URL | same |
| The root agent has no shell, file, fetch, search or self-copy tool | `agent/tools/*.ts`, `test/surface.test.ts`, mutants `surface-*` |
| `ANTHROPIC_*` is read in one file | `scripts/grep-gate.sh` |
| No holon work starts that could outlive the grant (Claude Code is the only refresher) | `agent/lib/grant.ts`, mutants `grant-*` |
| No secret is committed | gitleaks in the pre-commit hook and in CI over full history |

## Scope and use

The sidecar path carries the operator's own Claude subscription and is **personal, local and single-user**.
Do not deploy it, put it on a shared host, or route anyone else's requests through it. Deployed mode (S6) uses a
real API key and the provider's `api` mode only. This repository is private by design; do not publish it.

## Known advisories

`bun run audit` ignores GHSA-hp3w-g68c-fv3c (sprintf-js, moderate, no fixed release), reached only through
just-bash, the sandbox the root agent never drives. Revisit when sprintf-js ships a fix or just-bash drops it.
