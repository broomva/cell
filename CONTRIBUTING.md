# Contributing

Humans and agents follow the same path. The gates do not distinguish between them.

## Setup

```bash
bun install            # bun 1.3.14, Node 24 (eve's runtime)
bun run hooks:install  # pre-commit: gitleaks + check · commit-msg: Conventional Commits · pre-push: verify
bun run doctor         # holon on PATH, verify-auth, sidecar smoke, PreToolUse gate, git/gh, Node 24, grant
```

## Definition of done

A change is done when **`bun run verify` exits 0** and the PR's `## Verification` section quotes its
`mutate: N/N killed` line:

| Step | What it refuses |
|---|---|
| `typecheck` | type errors (`tsc`, strict) |
| `lint` | anything `biome ci` reports, formatting included. Errors on explicit `any`, `@ts-ignore`, focused or skipped tests, `console` in `agent/` |
| `test` | a failing test, or coverage under the floor in `bunfig.toml`. Every module in `agent/lib` and `scripts/lib` is loaded, so an untested one shows up |
| `grep-gate` | `ANTHROPIC_` or a computed environment read in `agent/` outside the provider; a test reading the real key |
| `audit` | a known advisory in the dependency tree (one documented ignore, see SECURITY.md) |
| `build:fake` | an app eve cannot compile |
| `mutate` | a mutant in `scripts/lib/mutants.ts` that its own `killedBy` test file does not catch |
| `slop` | the diff rules below, against `origin/main` |

Anything on the model path also needs live evidence: `bun run eval` (runs on the subscription through
`holon sidecar`; never in CI). Paste its tail.

## The slop gate

`scripts/lib/slop.ts`, tested in `test/slop.test.ts`. What Biome checks from the syntax tree is left to Biome.

- no `.todo`, `.if`, `.skipIf` or `.failing` tests; no `@ts-nocheck`; `@ts-expect-error` needs a reason
- a `TODO` names its ticket (`BRO-123` or `#12`); no `--no-verify` in code or workflows
- every dependency is pinned to an exact version, in every dependency section
- each changed source file in `agent/` or `scripts/lib/` comes with a changed test or eval that names it
- the PR body has a visible `## Verification` section quoting `mutate: N/N killed`

There are no waivers. If a rule is wrong, fix the rule, which is a guarded change (below).

## The gate guard

`.github/workflows/gate-guard.yml` runs **`main`'s copy** of `scripts/gate-guard.ts` on every PR. It reads the PR's file
list through the API and never runs PR code, so a PR cannot weaken it. It fails a PR that:

- edits a gate: `.github/`, `.githooks/`, `.claude/`, the slop, mutation and guard scripts, the grep gate, the Stop
  hook, `bunfig.toml`, `biome.json` or `tsconfig.json`
- deletes a test, or renames one out of the suite
- changes `package.json` `scripts` or `overrides`

A guarded PR needs a human: review it, then merge with the ruleset's admin bypass. That is how the coverage floor,
the mutant catalogue and the rules themselves change: deliberately, visibly, and never by an agent.

## Raising the bar

When you add a boundary, add the test **and** a mutant whose `killedBy` is that test. The mutant proves the test
can fail. Raise the coverage floor when coverage rises.

## Commits and PRs

Conventional Commits (`feat(S2a): …`, `fix(provider): …`). One slice per PR where possible. `main` accepts changes only through PRs; `gate` and `gate-guard`
are the required checks. Update `CHANGELOG.md` under `[Unreleased]`.
