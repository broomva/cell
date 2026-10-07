# Security

## Reporting

Report a vulnerability privately to the owner via a GitHub security advisory on this repository
(**Security → Report a vulnerability**), not in an issue or a PR. Expect an acknowledgement within a week.

## What this repository must never do

These are the boundaries the tests and CI enforce. A change that weakens one is a security bug.

| Boundary | Enforced by |
|---|---|
| The OAuth grant never enters the eve process; it lives in `holon` and reaches the app only as a per-run loopback key | `agent/lib/provider.ts`, `test/provider.test.ts`, mutants `provider-*` |
| The sidecar is loopback-only; api mode sends the real key only to `api.anthropic.com`, whatever the process environment says | same |
| The root agent has no shell, file, fetch, search or self-copy tool | `agent/tools/*.ts`, `test/surface.test.ts`, mutants `surface-*` |
| The environment is read in one file of the app | `scripts/grep-gate.sh`: any `process.env`, `globalThis`, `Bun.env`, `import.meta.env` or `process` import in `agent/` outside the provider |
| No holon work starts that could outlive the grant (Claude Code is the only refresher) | `agent/lib/grant.ts`, mutants `grant-*` |
| No secret is committed | gitleaks in the pre-commit hook (refuses the commit if gitleaks is missing) and in CI over the full history |
| A PR cannot weaken the checks that judge it | `gate-guard`, run from `main`'s copy under `pull_request_target`, reading the PR through the API only. A `ruleset` check fails while `main` does not require `gate` and `gate-guard` (bound to the Actions app): one copy inside the required `gate` blocks every PR, and `gate-guard` runs `main`'s copy, which a PR cannot edit. Neither stops an admin who removes the requirements and merges; they make that state visible. The PR that introduces `gate-guard` (PR #1) cannot be checked by it and is merged by a human, following its bootstrap checklist. |
| Agents in this repository do not use the admin bypass, rewrite the ruleset or push to `main` by habit or instruction | `scripts/agent-pretool-gate.ts` (Claude Code PreToolUse) refuses the common and quote-split spellings and fails closed. **Not a boundary:** `eval`, variables, scripts or encodings evade a shell-text match, and an agent outside this repository is not covered. The boundary is a non-admin GitHub identity for agents (an owner decision). |

## Scope and use

The sidecar path carries the operator's own Claude subscription and is **personal, local and single-user**.
Do not deploy it, put it on a shared host, or route anyone else's requests through it. Deployed mode (S6) uses a
real API key and the provider's `api` mode only. This repository is private by design; do not publish it.

## Known advisories

`bun run audit` ignores GHSA-hp3w-g68c-fv3c (sprintf-js, moderate, no fixed release), reached only through
just-bash, the sandbox the root agent never drives. Revisit when sprintf-js ships a fix or just-bash drops it.
