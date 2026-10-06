import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
