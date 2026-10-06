#!/usr/bin/env bun
// `bun run doctor [target-repo]` — checks the machine, not the code. One line per
// check; exits non-zero on the first failure. The target defaults to the cwd.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { checkGrant } from "../agent/lib/grant";

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

/**
 * holon's gate reads PreToolUse hooks from exactly these surfaces
 * (holon src/gate/surfaces.rs), and treats an absent surface as no gate.
 * A target with no registered hook would run every unit ungated.
 */
export function preToolUseSurfaces(project: string, home: string): string[] {
	const candidates = [
		"/Library/Application Support/ClaudeCode/managed-settings.json",
		join(project, ".claude/settings.json"),
		join(project, ".claude/settings.local.json"),
		join(home, ".claude/settings.json"),
	];
	return candidates.filter((f) => {
		if (!existsSync(f)) return false;
		try {
			const hooks = JSON.parse(readFileSync(f, "utf8"))?.hooks?.PreToolUse;
			return Array.isArray(hooks) && hooks.some((m) => Array.isArray(m?.hooks) && m.hooks.length > 0);
		} catch {
			return false;
		}
	});
}

if (import.meta.main) {
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
		fail("verify-auth", `exit ${va.code}, verdict ${auth.verdict ?? "unreadable"}`);
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

	// 7. D13: how long the grant has, against a one-attempt, ten-minute budget
	const st = run(["holon", "auth", "status"]);
	const g13 = checkGrant(st.out, { taskTimeout: 600, maxRequeues: 0, maxPause: 0 });
	if (!g13.ok) fail("grant", g13.reason);
	pass("grant", `${Math.floor(g13.remainingSeconds / 60)}m left (expires ${auth.credential?.expires_at ?? "?"})`);
}
