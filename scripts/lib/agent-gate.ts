// The agent-side speed bump in front of the gate guard. GitHub cannot tell an
// agent from its owner when both use the owner's token, so the ruleset's admin
// bypass and the ruleset itself are reachable from any agent shell. This
// PreToolUse hook (.claude/settings.json → scripts/agent-pretool-gate.ts)
// refuses those commands, in their common and quote-split spellings, to agents
// working in this repository, so an agent does not do them by habit or because
// a prompt told it to.
//
// It is NOT a security boundary: matching shell text cannot see through eval,
// variables, scripts or encodings, and an agent outside this repository is not
// covered at all. The boundary is a non-admin identity for agents.

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
/** gh api sends a write when given a method, a field or an input file, in any spelling. */
const GH_WRITE = /(\s|^)(-X|--method|-f|-F|--field|--raw-field|--input)(\s|=|[A-Z]|$)/;
const PROTECTED_API =
	/(rulesets|\/protection|\/collaborators|actions\/permissions|\/git\/refs|\/contents\/|\/pulls\/\d+\/merge|\/merges\b)/;

export const RULES: Rule[] = [
	{
		rule: "admin-merge",
		why: "merging with the ruleset bypass is a human act; a guarded PR waits for its owner",
		test: (c) => has(c, /\bgh\b/) && has(c, /--admin\b/),
	},
	{
		rule: "protection-write",
		why: "rulesets, protection, refs, contents, merges and permissions are changed by a human or through a PR",
		test: (c) =>
			has(c, /\bgh\s+api\b/) &&
			((has(c, GH_WRITE) && has(c, PROTECTED_API)) || (has(c, /\bgraphql\b/) && has(c, /\bmutation\b/i))),
	},
	{
		rule: "raw-token",
		why: "the GitHub token is not handed to other tools; use gh, which this hook can see",
		test: (c) => has(c, /\bgh\s+auth\s+token\b/) || has(c, /GH_TOKEN|GITHUB_TOKEN/),
	},
	{
		rule: "force-push",
		why: "history on the remote is never rewritten by an agent",
		test: (c) =>
			has(c, /\bgit\b.*\bpush\b/) && has(c, /(\s--force(-with-lease|-if-includes)?\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s\+\S)/),
	},
	{
		rule: "push-main",
		why: "main changes only through a PR",
		test: (c) => has(c, /\bgit\b.*\bpush\b/) && has(c, /(\s|:)(refs\/heads\/)?main(\s|$)/),
	},
	{
		rule: "skip-hooks",
		why: "the git hooks are the local gate; never bypass them",
		test: (c) => has(c, /\bgit\b/) && (has(c, NO_VERIFY) || has(c, /\bcommit\b.*\s-[a-zA-Z]*n[a-zA-Z]*\b/)),
	},
	{
		rule: "hooks-path",
		why: "core.hooksPath stays .githooks",
		test: (c) =>
			has(c, /core\.hookspath/i) &&
			!has(c, /^\s*git\s+config\s+(--local\s+)?core\.hooksPath\s+\.githooks\s*$/i) &&
			!has(c, /^\s*git\s+config\s+(--get\s+)?core\.hooksPath\s*$/i),
	},
	{
		rule: "visibility",
		why: "this repository stays private and is never deleted by an agent",
		test: (c) => has(c, /\bgh\s+repo\s+(edit\b.*--visibility|delete\b)/),
	},
];

/**
 * Undo the quoting the shell would undo before running the command, so
 * `--adm""in` and `m'a'in` are judged as `--admin` and `main`.
 */
export function dequote(line: string): string {
	return line.replace(/\$'/g, "").replace(/\\(.)/g, "$1").replace(/["']/g, "");
}

/** Split a shell line on separators so each command is judged on its own. */
export function commands(line: string): string[] {
	return dequote(line)
		.split(/&&|\|\||;|\||\n|\$\(|`|\)/)
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
