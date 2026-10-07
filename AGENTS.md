# eve Agent App

This project uses the eve framework: an agent is a directory of files under `agent/`, and eve compiles and runs it.

For a content-only change to the root agent's identity, purpose, tone, or response guidelines, edit its existing authored instructions. Fresh projects use `agent/instructions.md`; a project may instead use `agent/instructions.ts` or files under `agent/instructions/`. You do not need to read the framework docs for a content-only instructions change. A fresh project already has its selected model in `agent/agent.ts`; preserve that file unless the user asks to change the model.

## Read the docs before writing code

```sh
ls node_modules/eve/docs
```

Start with `docs/README.md`: it maps each task to the page that covers it. Read that page before authoring tools, connections, channels, skills, subagents, schedules, or deployment. In a workspace or local package install, resolve the installed `eve` package location first. If the package docs are missing, use https://eve.dev/docs.

Use a bounded authoring loop:

1. Read the relevant page and inspect only files you will modify or need to imitate.
2. Stop discovery once the file location, imports, and definition shape are clear. Implement the smallest complete behavior the user requested.
3. Run one narrow verification. Expand investigation only when it fails or the request needs project-specific details.

Follow links or inspect public types only when the routed page leaves the task unanswered. Do not recursively glob `node_modules`, enumerate the entire docs tree, or read unrelated scaffold files when the direct path is known. Package-manager links can hide files from recursive glob tools even though direct reads work.

## Prefer an existing integration

When a task names an external product or service, search the registry before implementing its integration. For a generic capability, author a tool instead.

```sh
eve registry search <query> --json
eve registry view <item>
```

Prefer items whose `implementation` is `native`; use Chat SDK adapters when no native channel fits. `registry view` links the item's documentation.

Install without driving interactive prompts:

```sh
eve add <item> --non-interactive
```

Exit code 0 means setup completed, 1 failed, and 2 needs an answer or a prerequisite. On exit 2, run the `next.command` from the final NDJSON event. For a non-secret question, replace its `<JSON value>` answer placeholder with the answer you collected; string values need JSON quotes. Never pass a secret in `--answer`. See `docs/install-integrations.mdx` for setup prerequisites.

## Use eve for Vercel operations

Use eve to link and deploy Vercel projects:

```sh
eve link --non-interactive --project <name-or-id> [--team <team-id-or-slug>]
eve deploy --non-interactive --yes [--project <name-or-id>]
```

A setup may report `eve link` as a prerequisite; run it, then retry the continuation. When a completed setup event has `deploymentRequired: true`, run the `next` command it reports.

## Validate the change

Run the validation the task requests. When it does not establish the behavior you changed, run the narrowest relevant check.

## Cell rules (on top of eve's guide above)

### Definition of done for an agent

1. `bun run verify` exits 0. Paste its tail into the PR's `## Verification` section; CI refuses a PR without the
   `mutate: N/N killed` line.
2. If you touched `agent/`, `evals/` or `package.json`, run `bun run eval` and paste its `Results:` line, or write
   `Live eval not run: <reason>`. CI refuses neither-nor.
3. A new boundary gets a test that imports it and asserts behaviour, **and** a mutant naming that test by its exact title.
4. Never edit a gate, delete or move a test, lower the coverage floor, shrink the mutant catalogue, float a
   dependency version, bypass a hook, or merge with the ruleset bypass. `gate-guard` (run from `main`) fails a PR
   that touches the gates; only a human merges one.

Two Claude Code hooks back this up (`.claude/settings.json`): a PreToolUse hook refuses the common spellings of the
admin merge bypass, ruleset and protection writes, pushes to `main`, force pushes, hook bypasses and raw token use; a
Stop hook runs `bun run check` when you have changed anything and sends you back to work while it is red. The
PreToolUse hook is a speed bump, not a wall: working around it is a violation of these rules, not a clever fix.

### Boundaries

- The root agent never gets a shell, file, fetch, search or self-copy tool. Code work is a holon unit, behind the
  workspace's PreToolUse gate. Adding a tool means adding it to `ALLOWED` in `test/surface.test.ts` with a reason.
- `ANTHROPIC_*` and the environment are read in `agent/lib/provider.ts` only; S3's spawn helper joins it in a guarded PR. `scripts/grep-gate.sh`
  enforces it.
- Every `holon factory` start passes `--task-timeout`, `--max-requeues` and `--max-pause` explicitly
  (`budgetArgv`) and runs `checkLiveGrant` first.
- Live evals are tagged `live` and never run in CI.
- Bun + Biome for the cell's code; Node 24 is eve's runtime. Every dependency is pinned exactly; an eve bump
  re-runs `bun run verify` and `bun run eval`.
