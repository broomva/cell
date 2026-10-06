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

`scripts/lib/slop.ts`, tested in `test/slop.test.ts`. Biome already checks what it can from the syntax tree.

- no `.todo`, `.todoIf`, `.if`, `.skipIf`, `.failing`, `.skip.each` or empty `.each([])` tests; no `@ts-nocheck`;
  `@ts-expect-error` needs a reason
- a `TODO` names its ticket (`BRO-123` or `#12`); no `--no-verify` in code or workflows
- every dependency is pinned to an exact version, in every dependency section
- each changed source file in `agent/` or `scripts/lib/` comes with a changed test that **imports it and adds an
  assertion**. Files under `agent/` that no test imports (tool slots, channels) count as tested by the surface test or
  an eval.
- the PR body has a visible `## Verification` section quoting `mutate: N/N killed`, where N is the catalogue size. When
  `agent/`, `evals/` or `package.json` changed, it must also quote `bun run eval`'s `Results: N passed (N total)`, or
  say `Live eval not run: <reason>`.

There are no waivers. If a rule is wrong, fix the rule, which is a guarded change (below).

## The gate guard

`.github/workflows/gate-guard.yml` runs **`main`'s copy** of `scripts/gate-guard.ts` on every PR. It reads the PR's file
list through the API and never runs PR code, so a PR cannot weaken it. It fails a PR that:

- edits a gate: `.github/`, `.githooks/`, `.claude/`, the slop, mutation, guard and agent-gate scripts, any
  `scripts/*.sh`, `bunfig.toml`, `biome.json`, `tsconfig.json`, `.npmrc` or `patches/`
- deletes a test or an eval, or moves one out of its suite (`test/**/*.test.ts`, `evals/**/*.eval.ts`)
- changes any `package.json` key except the dependency lists (scripts, overrides, `trustedDependencies`,
  `patchedDependencies`, `imports`, …)
- lists fewer files than the PR changes (GitHub caps the list at 3000): it fails closed

A guarded PR needs a human: review it, then merge with the ruleset's admin bypass. GitHub cannot tell an agent from you
when they share a token, so the repository's Claude Code hook (`scripts/agent-pretool-gate.ts`) refuses agents the bypass,
writes to rulesets or branch protection, pushes to `main`, force pushes, `--no-verify`, hook-path changes and visibility
changes. An agent working outside this repository, or with another harness, is not covered by that hook; a separate
non-admin identity for agents is what closes that.

## Mutation testing

Each mutant in `scripts/lib/mutants.ts` names the one test that must fail (`killedBy` file, `killedByTest` name). The
runner checks that test passes unmutated, then applies the mutant and runs that test alone. A kill therefore means that
test's assertions caught the change. Tests that kill mutants must assert behaviour, never read the source text; a test
in `test/mutants.test.ts` refuses a killedBy file that reads files.

## Raising the bar

When you add a boundary, add the test **and** a mutant whose `killedBy`/`killedByTest` names that test. The mutant proves the test
can fail. Raise the coverage floor when coverage rises.

## Commits and PRs

Conventional Commits (`feat(S2a): …`, `fix(provider): …`). One slice per PR where possible. `main` accepts changes only through PRs; `gate` and `gate-guard`
are the required checks. Update `CHANGELOG.md` under `[Unreleased]`.
