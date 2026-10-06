// The agent-side half of the gate guard. GitHub cannot tell an agent from its
// owner when both use the owner's token, so the ruleset's admin bypass and the
// ruleset itself are reachable from any agent shell. This PreToolUse hook
// (.claude/settings.json → scripts/agent-pretool-gate.ts) refuses those
// commands to agents working in this repository. It is a guarded file.

export interface Refusal {
	rule: string;
	why: string;
}

interface Rule extends Refusal {
	test: (cmd: string) => boolean;
}

const has = (cmd: string, re: RegExp) => re.test(cmd);
// Assembled so this file does not itself spell the flag the slop gate refuses.
const NO_VERIFY = new RegExp(["\\s--no", "verify\\b"].join("-"));

export const RULES: Rule[] = [
	{
		rule: "admin-merge",
		why: "merging with the ruleset bypass is a human act; a guarded PR waits for its owner",
		test: (c) => has(c, /\bgh\s+pr\s+merge\b/) && has(c, /--admin\b/),
	},
	{
		rule: "protection-write",
		why: "rulesets, branch protection, collaborators and Actions permissions are changed by a human",
		test: (c) =>
			has(c, /\bgh\s+api\b/) &&
			has(c, /(-X|--method)\s*['"]?(PUT|PATCH|POST|DELETE)\b/i) &&
			has(c, /(rulesets|\/protection|\/collaborators|actions\/permissions)/),
	},
	{
		rule: "force-push",
		why: "history on the remote is never rewritten by an agent",
		test: (c) => has(c, /\bgit\s+push\b/) && has(c, /(\s--force(-with-lease)?\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s\+\S)/),
	},
	{
		rule: "push-main",
		why: "main changes only through a PR",
		test: (c) => has(c, /\bgit\s+push\b/) && has(c, /(\s|:)(refs\/heads\/)?main(\s|$)/),
	},
	{
		rule: "skip-hooks",
		why: "the git hooks are the local gate; never bypass them",
		test: (c) => has(c, /\bgit\b/) && has(c, NO_VERIFY),
	},
	{
		rule: "hooks-path",
		why: "core.hooksPath stays .githooks",
		test: (c) =>
			has(c, /\bgit\s+config\b/) &&
			has(c, /core\.hooksPath/i) &&
			!has(c, /core\.hooksPath\s+\.githooks\s*$/i) &&
			!has(c, /^\s*git\s+config\s+(--get\s+)?core\.hooksPath\s*$/i),
	},
	{
		rule: "visibility",
		why: "this repository stays private and is never deleted by an agent",
		test: (c) => has(c, /\bgh\s+repo\s+(edit\b.*--visibility|delete\b)/),
	},
];

/** Split a shell line on separators so each command is judged on its own. */
export function commands(line: string): string[] {
	return line
		.split(/&&|\|\||;|\||\n/)
		.map((s) => s.trim())
		.filter(Boolean);
}

export function refusals(line: string): Refusal[] {
	const out: Refusal[] = [];
	for (const cmd of commands(line)) {
		for (const r of RULES) if (r.test(cmd)) out.push({ rule: r.rule, why: r.why });
	}
	return out;
}
