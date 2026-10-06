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

/** Shell words of one command, quotes kept together and then removed, so a quoted message is one word. */
export function words(raw: string): string[] {
	return (raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((w) => dequote(w));
}

/**
 * `git commit -n` skips the hooks. git reads options anywhere before `--`, so
 * every word after `commit` is checked, except the value of -m/-F/--message/
 * --file: `-n` inside a message ("drop the -only flag") is text, not a flag.
 * Judged on raw text, before dequoting merges a quoted message into words.
 */
export function commitSkipsHooks(raw: string): boolean {
	const w = words(raw);
	const at = w.indexOf("commit");
	if (at < 0 || !w.slice(0, at).includes("git")) return false;
	for (let i = at + 1; i < w.length; i++) {
		const t = w[i] ?? "";
		if (t === "--") return false;
		if (t === "--no-edit" || t === "--amend") continue;
		if (/^--(message|file)$/.test(t)) {
			i++;
			continue;
		}
		if (/^-[a-zA-Z]+$/.test(t)) {
			const flags = t.slice(1);
			const value = flags.search(/[mF]/);
			const n = flags.indexOf("n");
			if (n >= 0 && (value < 0 || n < value)) return true;
			if (value >= 0 && value === flags.length - 1) i++;
		}
	}
	return false;
}

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
		test: (c) => has(c, /\bgh\s+auth\s+token\b/) || has(c, /\$\{?(GH|GITHUB)_TOKEN\b|\b(GH|GITHUB)_TOKEN=/),
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
		test: (c) => has(c, /\bgit\b/) && has(c, NO_VERIFY),
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
		rule: "obfuscated",
		why: "ANSI-C quoting or a line continuation in a git or gh command hides what it runs; spell it plainly",
		test: (c) => has(c, /\b(git|gh)\b/) && has(c, /\$'|\\\n/),
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
/** Command separators, and the start of a command substitution. A bare `)` is not one. */
const SEPARATORS = /&&|\|\||;|\||\n|\$\(|`/;

/**
 * Split a shell line into commands: on separators and at the start of a
 * command substitution. A bare `)` is not a separator, so parentheses inside
 * an argument (a GraphQL input object) do not fragment the command around them.
 */
export function commands(line: string): string[] {
	return dequote(line.replace(/\\\n/g, ""))
		.split(SEPARATORS)
		.map((s) => s.trim())
		.filter(Boolean);
}

const OBFUSCATION = RULES.find((r) => r.rule === "obfuscated");

export function refusals(line: string): Refusal[] {
	const out: Refusal[] = [];
	// Obfuscation is judged on the raw text, before dequoting erases it.
	if (OBFUSCATION?.test(line)) out.push({ rule: OBFUSCATION.rule, why: OBFUSCATION.why });
	const parts = commands(line);
	for (const cmd of parts) {
		for (const r of RULES) if (r !== OBFUSCATION && r.test(cmd)) out.push({ rule: r.rule, why: r.why });
	}
	// commit -n is judged on the raw segments, where a quoted message is still one word.
	const raw = line.replace(/\\\n/g, "").split(SEPARATORS);
	if (!out.some((r) => r.rule === "skip-hooks") && raw.some(commitSkipsHooks)) {
		out.push({ rule: "skip-hooks", why: "the git hooks are the local gate; never bypass them" });
	}
	return out;
}
