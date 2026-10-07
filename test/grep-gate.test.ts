import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs scripts/grep-gate.sh in a scratch git repository, so the gate is judged
// by what it refuses on this machine's git and grep, not by its regex text.
const SCRIPT = join(import.meta.dir, "../scripts/grep-gate.sh");

function gate(files: Record<string, string>): { code: number; out: string } {
	const root = mkdtempSync(join(tmpdir(), "cell-grep-"));
	mkdirSync(join(root, "scripts"), { recursive: true });
	cpSync(SCRIPT, join(root, "scripts/grep-gate.sh"));
	for (const [path, body] of Object.entries(files)) {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), body);
	}
	const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
	git("init", "-q");
	git("add", "-A");
	const p = Bun.spawnSync(["bash", "scripts/grep-gate.sh"], { cwd: root, stdout: "pipe", stderr: "pipe" });
	return { code: p.exitCode ?? -1, out: new TextDecoder().decode(p.stdout) };
}

const env = ["pro", "cess"].join("");

describe("grep gate", () => {
	test("a clean tree passes, and lookalike names are not refused", () => {
		const r = gate({ "agent/lib/x.ts": "export const processed = 1;\nexport const BunnyEars = 2;\n" });
		expect(r).toEqual({ code: 0, out: "grep-gate: ok\n" });
	});

	test("every spelling of environment access in agent/ is refused", () => {
		for (const body of [
			`export const k = ${env}["env"]["ANTHROPIC" + "_API_KEY"];`,
			`const p = ${env}; export const e = p["env"];`,
			'export const k = Bun["env"];',
			"export const m = import.meta;",
			"export const g = globalThis;",
		]) {
			const r = gate({ "agent/lib/x.ts": `${body}\n` });
			expect({ body, code: r.code }).toEqual({ body, code: 1 });
		}
	});

	test("the provider may read the environment; nothing else in agent/ may name ANTHROPIC_", () => {
		expect(gate({ "agent/lib/provider.ts": `export const e = ${env}.env.ANTHROPIC_API_KEY;\n` }).code).toBe(0);
		expect(gate({ "agent/lib/other.ts": 'export const n = "ANTHROPIC_BASE_URL";\n' }).code).toBe(1);
	});

	test("a test that reads the real key is refused", () => {
		expect(gate({ "test/x.test.ts": `const { ANTHROPIC_API_KEY: k } = ${env}["env"];\n` }).code).toBe(1);
		expect(gate({ "test/x.test.ts": 'const fake = { ANTHROPIC_API_KEY: "fake" };\n' }).code).toBe(0);
	});
});
