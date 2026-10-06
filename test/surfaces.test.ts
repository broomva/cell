import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preToolUseSurfaces } from "../scripts/lib/surfaces";

function settings(root: string, rel: string, body: unknown) {
	const f = join(root, rel);
	mkdirSync(join(f, ".."), { recursive: true });
	writeFileSync(f, typeof body === "string" ? body : JSON.stringify(body));
}

const hook = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "gate.sh" }] }] } };

describe("preToolUseSurfaces", () => {
	test("finds project, project-local and user surfaces", () => {
		const project = mkdtempSync(join(tmpdir(), "cell-proj-"));
		const home = mkdtempSync(join(tmpdir(), "cell-home-"));
		settings(project, ".claude/settings.json", hook);
		settings(project, ".claude/settings.local.json", hook);
		settings(home, ".claude/settings.json", hook);
		expect(preToolUseSurfaces(project, home)).toHaveLength(3);
	});

	test("an empty matcher, a missing key or broken JSON is no gate", () => {
		const project = mkdtempSync(join(tmpdir(), "cell-proj-"));
		const home = mkdtempSync(join(tmpdir(), "cell-home-"));
		settings(project, ".claude/settings.json", { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }] } });
		settings(project, ".claude/settings.local.json", "{not json");
		settings(home, ".claude/settings.json", { hooks: { Stop: [] } });
		expect(preToolUseSurfaces(project, home)).toEqual([]);
	});
});
