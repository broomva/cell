import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Claude Code's managed-settings file: macOS, then Linux. */
export const MANAGED_SETTINGS = [
	"/Library/Application Support/ClaudeCode/managed-settings.json",
	"/etc/claude-code/managed-settings.json",
];

/** A hook command that does nothing is not a gate. */
const TRIVIAL = /^\s*(true|:|exit\s+0|echo\b[^|;&]*)\s*;?\s*$/;

interface Matcher {
	matcher?: unknown;
	hooks?: unknown;
}

/** Does this matcher entry gate the Bash tool with at least one non-trivial command? */
export function gatesBash(entry: Matcher): boolean {
	const m = entry.matcher;
	let matchesBash = false;
	if (m === undefined || m === "" || m === "*") matchesBash = true;
	else if (typeof m === "string") {
		try {
			matchesBash = new RegExp(`^(?:${m})$`).test("Bash");
		} catch {
			matchesBash = false;
		}
	}
	if (!matchesBash || !Array.isArray(entry.hooks)) return false;
	return entry.hooks.some(
		(h: { type?: unknown; command?: unknown }) =>
			h?.type === "command" && typeof h.command === "string" && !TRIVIAL.test(h.command),
	);
}

/**
 * holon's gate reads PreToolUse hooks from exactly these surfaces
 * (holon src/gate/surfaces.rs) and treats an absent surface as no gate, so a
 * target with no real Bash hook would run every unit ungated. Returns the
 * files that register one.
 */
export function preToolUseSurfaces(project: string, home: string, managed: string[] = MANAGED_SETTINGS): string[] {
	const candidates = [
		...managed,
		join(project, ".claude/settings.json"),
		join(project, ".claude/settings.local.json"),
		join(home, ".claude/settings.json"),
	];
	return candidates.filter((f) => {
		if (!existsSync(f)) return false;
		try {
			const hooks = JSON.parse(readFileSync(f, "utf8"))?.hooks?.PreToolUse;
			return Array.isArray(hooks) && hooks.some((m: Matcher) => gatesBash(m));
		} catch {
			return false;
		}
	});
}
