import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatesBash, preToolUseSurfaces } from "../scripts/lib/surfaces";

function settings(root: string, rel: string, body: unknown) {
	const f = join(root, rel);
	mkdirSync(join(f, ".."), { recursive: true });
	writeFileSync(f, typeof body === "string" ? body : JSON.stringify(body));
}

const gate = { matcher: "Bash", hooks: [{ type: "command", command: "/usr/local/bin/control-gate.sh" }] };
const hook = { hooks: { PreToolUse: [gate] } };

function dirs() {
	const root = mkdtempSync(join(tmpdir(), "cell-surf-"));
	return { project: join(root, "p"), home: join(root, "h"), managed: join(root, "managed.json") };
}

describe("gatesBash", () => {
	test("a matcher that reaches Bash with a real command", () => {
		expect(gatesBash(gate)).toBe(true);
		expect(gatesBash({ ...gate, matcher: undefined })).toBe(true);
		expect(gatesBash({ ...gate, matcher: "*" })).toBe(true);
		expect(gatesBash({ ...gate, matcher: "Bash|Edit" })).toBe(true);
	});

	test("a matcher that misses Bash, or a hook that does nothing, is no gate", () => {
		expect(gatesBash({ ...gate, matcher: "Edit" })).toBe(false);
		expect(gatesBash({ ...gate, matcher: "Bash(" })).toBe(false);
		expect(gatesBash({ ...gate, hooks: [] })).toBe(false);
		expect(gatesBash({ ...gate, hooks: "nope" })).toBe(false);
		for (const command of ["true", ":", "exit 0", "echo ok", "  true ; "]) {
			expect(gatesBash({ ...gate, hooks: [{ type: "command", command }] })).toBe(false);
		}
		expect(gatesBash({ ...gate, hooks: [{ type: "prompt", command: "x.sh" }] })).toBe(false);
	});
});

describe("preToolUseSurfaces", () => {
	test("finds managed, project, project-local and user surfaces", () => {
		const d = dirs();
		settings(d.project, ".claude/settings.json", hook);
		settings(d.project, ".claude/settings.local.json", hook);
		settings(d.home, ".claude/settings.json", hook);
		writeFileSync(d.managed, JSON.stringify(hook));
		expect(preToolUseSurfaces(d.project, d.home, [d.managed])).toHaveLength(4);
	});

	test("an empty hook list, a trivial hook, a missing key or broken JSON is no gate", () => {
		const d = dirs();
		settings(d.project, ".claude/settings.json", { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }] } });
		settings(d.project, ".claude/settings.local.json", "{not json");
		settings(d.home, ".claude/settings.json", {
			hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "true" }] }] },
		});
		expect(preToolUseSurfaces(d.project, d.home, [d.managed])).toEqual([]);
	});
});
