# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/) once it has a release.

## [Unreleased]

### Added

- S1: the template runs on `holon sidecar` (eve 0.67.2). Two-mode provider, root agent without shell, files,
  egress or self-copies, `bun run doctor`, the D13 grant-validity check, live `substrate` and `no-shell` evals.
- Verification gates: `bun run verify` (types, Biome, tests with a coverage floor, grep gate, audit, eve build,
  mutation gate, slop gate), repository git hooks, a Claude Code Stop hook, and CI that runs all of it.
- `gate-guard`: a required check run from `main`'s copy that fails any PR touching the gates, deleting or moving a
  test out of its suite, changing a non-dependency `package.json` key, or listing fewer files than it changes.
- Agent PreToolUse hook: refuses the admin bypass, ruleset writes, pushes to `main`, force pushes and hook bypasses.
- `bun run doctor` checks `main`'s ruleset requires `gate` and `gate-guard`, bound to the GitHub Actions app.
