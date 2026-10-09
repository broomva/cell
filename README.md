# cell

A template for purpose-built software factories: one [eve](https://www.npmjs.com/package/eve) app that drives
[holon](https://github.com/broomva/holon) worker units, reaching the model only through `holon sidecar`.
Design: `broomva/workspace` → `docs/specs/2026-09-07-factory-cell-architecture.html`.

**Personal, local, single-user.** The sidecar carries the operator's own Claude subscription on loopback.
Never deploy the sidecar path, never put it on a shared host, never make this repository public.

## Status: S1, the template runs on holon

| Slice | What | State |
|---|---|---|
| S1 | template on `holon sidecar`, root without shell/files/egress, doctor, substrate eval, D13 grant check | this tree |
| S2a/S2b | intake + claim + record; plan + gates + verdict | not started |
| S3 | build as a detached `holon factory` fanout | not started |
| S4 | approvals on open/merge PR, verifier + critic | not started |
| S5 | MCP channel for Claude Code, Linear connection | not started |
| S6 | deployed mode, only if a run needs one | not started |

## Commands

```bash
bun install && bun run hooks:install
bun run doctor [target-repo]   # machine checks: holon, verify-auth, sidecar smoke, PreToolUse gate, git/gh, Node 24, git hooks, ruleset, grant
bun run verify                 # the definition of done: check · audit · build · mutate · slop (CI runs the same)
bun run eval                   # live: holon sidecar -- eve eval --tag live (Opus, on the subscription; never in CI)
bun run dev                    # holon sidecar -- eve dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for what each gate refuses, [SECURITY.md](SECURITY.md) for the boundaries
and how to report a problem, and [AGENTS.md](AGENTS.md) for the rules agents work under.

## The boundaries S1 pins

- `agent/lib/provider.ts` — two modes, never mixed: loopback sidecar + per-run key, or (deployed) a real
  API key with no base URL. Anything else refuses to start.
- `agent/tools/*.ts` — `disableTool()` for `bash`, `read_file`, `write_file`, `agent`, `web_fetch`,
  `web_search`, `task_cancel`. `test/surface.test.ts` asserts `eve info --json` lists exactly the allow-list
  (`load_skill`), so an eve bump that ships a new default tool fails CI.
- `agent/sandbox/sandbox.ts` — pinned to just-bash (no native processes) since the root never drives it.
- `agent/lib/grant.ts` — D13: refuse holon work whose worst-case duration
  (`timeout × (requeues+1) + pause × requeues` + 10 min) outlives the OAuth grant, so holon never refreshes
  the grant Claude Code owns. S3's spawn helper calls it before every plan and build.
- `scripts/grep-gate.sh` — `ANTHROPIC_` only in the provider (and S3's spawn helper); no test reads the real key.
