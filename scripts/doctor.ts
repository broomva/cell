#!/usr/bin/env bun
// `bun run doctor [target-repo]` — checks the machine, not the code. One line per
// check; exits non-zero on the first failure. The target defaults to the cwd.
import { homedir } from "node:os";
import { resolve } from "node:path";
import { checkGrant } from "../agent/lib/grant";
import { preToolUseSurfaces } from "./lib/surfaces";

const target = resolve(process.argv[2] ?? process.cwd());

function run(argv: string[], timeoutMs = 90_000): { code: number; out: string; err: string } {
	const p = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
	return { code: p.exitCode ?? -1, out: p.stdout.toString(), err: p.stderr.toString() };
}

function pass(name: string, detail: string) {
	console.log(`ok   ${name.padEnd(14)} ${detail}`);
}
function fail(name: string, detail: string): never {
	console.log(`FAIL ${name.padEnd(14)} ${detail}`);
	process.exit(1);
}

// 1. holon on the PATH
const v = run(["holon", "--version"]);
if (v.code !== 0) fail("holon", "not on the PATH (build broomva/holon and install to ~/.local/bin)");
pass("holon", v.out.trim());

// 2. the substrate holds right now, metered on the plan
const va = run(["holon", "verify-auth", "--json", "--billing"]);
let auth: { verdict?: string; billing?: { verdict?: string }; credential?: { expires_at?: string } } = {};
try {
	auth = JSON.parse(va.out);
} catch {}
if (va.code !== 0 || auth.verdict !== "ASSUMPTION_HOLDS")
	fail(
		"verify-auth",
		`exit ${va.code}, verdict ${auth.verdict ?? "unreadable"}${auth.verdict === "EXPIRED" ? "; run any `claude` command so Claude Code refreshes the grant (D13: the cell never refreshes it)" : ""}`,
	);
if (auth.billing?.verdict !== "SUBSCRIPTION") fail("billing", `verdict ${auth.billing?.verdict ?? "unreadable"}`);
pass("verify-auth", `${auth.verdict}, billing ${auth.billing.verdict}`);

// 3. sidecar exec mode works with a trivial child
const sc = run(["holon", "sidecar", "--", "true"]);
if (sc.code !== 0) fail("sidecar", `holon sidecar -- true exited ${sc.code}: ${sc.err.split("\n").at(-2) ?? ""}`);
pass("sidecar", "holon sidecar -- true exited 0");

// 4. a PreToolUse surface is registered for the target
const surfaces = preToolUseSurfaces(target, homedir());
if (surfaces.length === 0) fail("gate", `no PreToolUse hook registered for ${target}; holon would run units ungated`);
pass("gate", `${surfaces.length} surface(s): ${surfaces.join(", ")}`);

// 5. git and gh
const g = run(["git", "--version"]);
if (g.code !== 0) fail("git", "not found");
const gh = run(["gh", "auth", "status"]);
if (gh.code !== 0) fail("gh", "not authenticated (gh auth login)");
pass("git+gh", `${g.out.trim()}; gh authenticated`);

// 6. Node 24, eve's runtime
const n = run(["node", "--version"]);
if (n.code !== 0 || !/^v24\./.test(n.out.trim())) fail("node", `eve needs Node 24, found ${n.out.trim() || "none"}`);
pass("node", n.out.trim());

// 7. this checkout's git hooks are the repository's
const hp = run(["git", "-C", resolve(import.meta.dir, ".."), "config", "core.hooksPath"]);
if (hp.out.trim() !== ".githooks") fail("hooks", `core.hooksPath is "${hp.out.trim()}"; run \`bun run hooks:install\``);
pass("hooks", "core.hooksPath = .githooks");

// 8. main's ruleset requires both gates, bound to the Actions app
// The cell's own repository, resolved from this checkout, not from the cwd.
const cellRoot = resolve(import.meta.dir, "..");
const remote = run(["git", "-C", cellRoot, "remote", "get-url", "origin"]).out.trim();
const repo = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/)?.[1] ?? "";
const rs = run(["bun", resolve(cellRoot, "scripts/ruleset-check.ts"), repo]);
if (!repo || rs.code !== 0)
	fail(
		"ruleset",
		rs.out
			.split("\n")
			.filter((l) => l.startsWith("RULESET"))
			.join("; ") || `could not resolve the repository from ${remote}`,
	);
pass("ruleset", "main: PRs only, no force push or deletion, gate + gate-guard required");

// 9. D13: how long the grant has, against a one-attempt, ten-minute budget
const st = run(["holon", "auth", "status"]);
const g13 = checkGrant(st.out, { taskTimeout: 600, maxRequeues: 0, maxPause: 0 });
if (!g13.ok) fail("grant", g13.reason);
pass("grant", `${Math.floor(g13.remainingSeconds / 60)}m left (expires ${auth.credential?.expires_at ?? "?"})`);
