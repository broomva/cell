# Contributing

Humans and agents follow the same path. The gates do not distinguish between them.

## Setup

```bash
bun install            # bun 1.3.14, Node 24 (eve's runtime)
bun run hooks:install  # pre-commit: gitleaks + check · commit-msg: Conventional Commits · pre-push: verify
bun run doctor         # holon on PATH, verify-auth, sidecar smoke, PreToolUse gate, git/gh, Node 24, grant
```

## Definition of done

A change is done when **`bun run verify` exits 0** and the PR's `## Verification` section shows it:

| Step | What it refuses |
|---|---|
| `typecheck` | type errors (`tsc`, strict) |
| `lint` | anything `biome ci` flags, formatting included (`bun run format` fixes most) |
| `test` | a failing test, or coverage under the floor in `bunfig.toml` |
| `grep-gate` | `ANTHROPIC_` outside the provider; a test reading the real key |
| `audit` | a known advisory in the dependency tree (one documented ignore, see SECURITY.md) |
| `build:fake` | an app eve cannot compile |
| `mutate` | a test suite that does not catch every mutant in `scripts/lib/mutants.ts` |
| `slop` | the diff rules below, against `origin/main` |

Anything on the model path also needs live evidence: `bun run eval` (runs on the subscription through
`holon sidecar`; never in CI). Paste its tail.

## The slop gate

`scripts/lib/slop.ts`, one test each in `test/slop.test.ts`:

- no `.only` / `.skip` / `.todo` in tests; no `@ts-ignore` / `@ts-nocheck`; `@ts-expect-error` needs a reason
- no explicit `any`; no `console.log` in `agent/`; no ESLint or Prettier directives; no `--no-verify`
- a `TODO` names its ticket (`BRO-123` or `#12`)
- every dependency is pinned exactly (no `^`, `~`, `*`, `latest`)
- source under `agent/` or `scripts/` does not change without a test or eval changing too
- no test file is deleted; the coverage floor never drops; the mutant catalogue never shrinks
- the PR body has a non-empty `## Verification` section

A rule can be waived only in the PR body (`Slop-waiver: <rule-id> — <reason>`), where a reviewer sees it.
The Verification section cannot be waived.

## Raising the bar

When you add a boundary, add the test **and** a mutant for it. The mutant proves the test can fail.
Raise the coverage floor when coverage rises. Neither ratchet moves down.

## Commits and PRs

Conventional Commits (`feat(S2a): …`, `fix(provider): …`). One slice per PR where possible. CI's `gate` job is
the one check that must be green. Update `CHANGELOG.md` under `[Unreleased]`.
