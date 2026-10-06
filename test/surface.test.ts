import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// The root agent's model-facing surface, asserted on what eve itself reports.
// On eve 0.44.3 `eve info --json` listed disabled built-ins anyway, so the spec
// pinned the compiled manifest instead; 0.67.2 has no such file, and its
// `eve info --json` drops a disabled tool and lists it again when the
// disableTool() file is removed (measured both ways). So the info output is the
// artifact, and an eve bump that ships a new default tool fails here. The
// test asserts what eve reports, never the text of the tool files, so a
// mutation of a tool file is caught by its effect.

const ROOT = join(import.meta.dir, "..");

/** Built-ins the root must never have: shell, files, self-copies, egress, background-task control. */
export const DISABLED = ["bash", "read_file", "write_file", "agent", "web_fetch", "web_search", "task_cancel"] as const;

/** Every tool the root may expose. load_skill adds no execution surface; S4's handback skill needs it. */
export const ALLOWED = ["load_skill"] as const;

function eveInfo(): { tools: string[] } {
	const proc = Bun.spawnSync([join(ROOT, "node_modules/.bin/eve"), "info", "--json"], {
		cwd: ROOT,
		// Bun.spawn's env replaces the parent's, so PATH and HOME are carried explicitly.
		env: {
			PATH: process.env.PATH ?? "",
			HOME: process.env.HOME ?? "",
			EVE_TELEMETRY_DISABLED: "1",
			// A fake sidecar: provider.ts asserts the shape and never calls out.
			ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
			ANTHROPIC_API_KEY: "fake-sidecar-key-for-surface-test",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	if (proc.exitCode !== 0) throw new Error(`eve info failed (${proc.exitCode}): ${proc.stderr.toString()}`);
	return JSON.parse(proc.stdout.toString());
}

describe("root agent surface", () => {
	test(
		"eve reports exactly the allow-list, none of the disabled built-ins",
		() => {
			const { tools } = eveInfo();
			for (const name of DISABLED) expect(tools).not.toContain(name);
			expect([...tools].sort()).toEqual([...ALLOWED].sort());
		},
		{ timeout: 120_000 },
	);
});
