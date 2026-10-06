// The slop gate's rules, as pure functions over a diff. scripts/slop-gate.ts
// feeds them `git diff base...HEAD` and the PR body; every rule here has a
// test in test/slop.test.ts and a mutant in scripts/lib/mutants.ts.
//
// A rule can be waived only in the PR body, where a reviewer sees it:
//   Slop-waiver: <rule-id> — <reason of at least a few words>

export interface Finding {
	rule: string;
	where: string;
	detail: string;
}

export interface FileChange {
	status: "A" | "M" | "D" | "R";
	path: string;
}

export interface AddedLine {
	path: string;
	line: number;
	text: string;
}

const TS = /\.(ts|tsx|mts|cts)$/;
const TEST = /(^test\/|\.test\.ts$|\.eval\.ts$)/;
const TICKET = /(\b[A-Z]{2,}-\d+\b|#\d+\b)/;
/** The rules and their fixtures spell out every pattern they ban; they are exempt from the line rules. */
const SELF = /^(scripts\/lib\/slop\.ts|test\/slop\.test\.ts)$/;

interface LineRule {
	id: string;
	applies: (path: string) => boolean;
	bad: RegExp;
	detail: string;
	unless?: RegExp;
}

export const LINE_RULES: LineRule[] = [
	{
		id: "focused-or-skipped-test",
		applies: (p) => TEST.test(p),
		bad: /\.(only|skip|todo)\(/,
		detail: "a focused, skipped or todo test hides the rest of the suite",
	},
	{
		id: "ts-suppression",
		applies: (p) => TS.test(p),
		bad: /@ts-(ignore|nocheck)\b/,
		detail: "suppressing the type checker; fix the type or use @ts-expect-error with a reason",
	},
	{
		id: "ts-expect-error-no-reason",
		applies: (p) => TS.test(p),
		bad: /@ts-expect-error\s*$/,
		detail: "@ts-expect-error needs a reason after it",
	},
	{
		id: "explicit-any",
		applies: (p) => TS.test(p),
		bad: /(:\s*any\b|\bas\s+any\b|<any>)/,
		detail: "an explicit any switches the type checker off for this value",
	},
	{
		id: "console-log-in-agent",
		applies: (p) => p.startsWith("agent/") && TS.test(p),
		bad: /\bconsole\.log\(/,
		detail: "the agent reports through the run record, not stdout",
	},
	{
		id: "todo-without-ticket",
		applies: (p) => !p.endsWith(".md"),
		bad: /\b(TODO|FIXME|XXX|HACK)\b/,
		unless: TICKET,
		detail: "a TODO must name the ticket that will close it",
	},
	{
		id: "wrong-linter",
		applies: (p) => TS.test(p),
		bad: /eslint-disable|prettier-ignore/,
		detail: "this repo lints with Biome; ESLint and Prettier directives do nothing",
	},
	{
		id: "skip-hooks",
		// Prose may name the flag to forbid it; code and workflows may not use it.
		applies: (p) => !p.endsWith(".md"),
		bad: /--no-verify\b/,
		detail: "never bypass the git hooks",
	},
];

/** Parse `git diff -U0` output into added lines with their new-file line numbers. */
export function parseAddedLines(diff: string): AddedLine[] {
	const out: AddedLine[] = [];
	let path = "";
	let line = 0;
	for (const raw of diff.split("\n")) {
		if (raw.startsWith("+++ ")) {
			path = raw.startsWith("+++ b/") ? raw.slice(6) : "";
			continue;
		}
		const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (hunk?.[1]) {
			line = Number(hunk[1]);
			continue;
		}
		if (path && raw.startsWith("+")) {
			out.push({ path, line, text: raw.slice(1) });
			line++;
		}
	}
	return out;
}

export function lineFindings(lines: AddedLine[]): Finding[] {
	const out: Finding[] = [];
	for (const l of lines) {
		if (SELF.test(l.path)) continue;
		for (const r of LINE_RULES) {
			if (!r.applies(l.path) || !r.bad.test(l.text)) continue;
			if (r.unless?.test(l.text)) continue;
			out.push({ rule: r.id, where: `${l.path}:${l.line}`, detail: r.detail });
		}
	}
	return out;
}

/** Every dependency is pinned to an exact version; ranges let a release change behaviour without a diff. */
export function dependencyRangeFindings(packageJson: string): Finding[] {
	const pkg = JSON.parse(packageJson) as Record<string, Record<string, string> | undefined>;
	const out: Finding[] = [];
	for (const section of ["dependencies", "devDependencies", "optionalDependencies", "overrides"]) {
		for (const [name, version] of Object.entries(pkg[section] ?? {})) {
			if (/^[\^~*]|^latest$|^x$/.test(version) || /\s|\|\||>|</.test(version)) {
				out.push({
					rule: "dependency-range",
					where: `package.json ${section}.${name}`,
					detail: `"${version}" is a range; pin an exact version`,
				});
			}
		}
	}
	return out;
}

/** Changed source must come with a changed test, or a stated reason. */
export function untestedChangeFindings(changes: FileChange[]): Finding[] {
	const source = changes.filter(
		(c) => c.status !== "D" && /^(agent|scripts)\//.test(c.path) && TS.test(c.path) && !TEST.test(c.path),
	);
	const tests = changes.filter((c) => c.status !== "D" && TEST.test(c.path));
	if (source.length === 0 || tests.length > 0) return [];
	return [
		{
			rule: "source-without-test",
			where: source.map((c) => c.path).join(", "),
			detail: "source changed and no test or eval did",
		},
	];
}

export function deletedTestFindings(changes: FileChange[]): Finding[] {
	return changes
		.filter((c) => c.status === "D" && TEST.test(c.path))
		.map((c) => ({ rule: "test-deleted", where: c.path, detail: "a test file was deleted" }));
}

/** Read every `coverageThreshold` number out of bunfig.toml. */
export function coverageFloor(bunfig: string): number[] {
	const m = bunfig.match(/coverageThreshold\s*=\s*(\{[^}]*\}|[\d.]+)/);
	if (!m?.[1]) return [];
	return [...m[1].matchAll(/[\d.]+/g)].map((x) => Number(x[0]));
}

export function coverageFindings(baseBunfig: string | null, headBunfig: string): Finding[] {
	const head = coverageFloor(headBunfig);
	if (head.length === 0) return [{ rule: "coverage-floor", where: "bunfig.toml", detail: "no coverageThreshold" }];
	if (baseBunfig === null) return [];
	const base = coverageFloor(baseBunfig);
	if (Math.min(...head) < Math.min(...base) || head.reduce((a, b) => a + b, 0) < base.reduce((a, b) => a + b, 0)) {
		return [{ rule: "coverage-floor", where: "bunfig.toml", detail: `lowered from ${base} to ${head}` }];
	}
	return [];
}

export function countMutants(mutantsSource: string): number {
	return (mutantsSource.match(/^\t\tid: "/gm) ?? []).length;
}

export function mutantFindings(baseSource: string | null, headSource: string): Finding[] {
	if (baseSource === null) return [];
	const base = countMutants(baseSource);
	const head = countMutants(headSource);
	return head < base
		? [
				{
					rule: "mutant-removed",
					where: "scripts/lib/mutants.ts",
					detail: `the catalogue shrank from ${base} to ${head}`,
				},
			]
		: [];
}

/** The PR body must carry the evidence: a Verification section with something in it. */
export function prBodyFindings(body: string): Finding[] {
	const verification = body.match(/^##\s+Verification\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m);
	if (!verification) {
		return [{ rule: "pr-verification", where: "PR body", detail: "no `## Verification` section" }];
	}
	const content = (verification[1] ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
	if (content.length < 40) {
		return [{ rule: "pr-verification", where: "PR body", detail: "the Verification section is empty or a stub" }];
	}
	return [];
}

/** Waivers stated in the PR body: `Slop-waiver: <rule> — <reason>`, reason of at least three words. */
export function waivers(body: string): Set<string> {
	const out = new Set<string>();
	for (const m of body.matchAll(/^Slop-waiver:\s*([a-z-]+)\s*[—:-]+\s*(.+)$/gm)) {
		if (m[1] && (m[2] ?? "").trim().split(/\s+/).length >= 3) out.add(m[1]);
	}
	return out;
}

export function applyWaivers(findings: Finding[], waived: Set<string>): { kept: Finding[]; waived: Finding[] } {
	return {
		kept: findings.filter((f) => !waived.has(f.rule) || f.rule === "pr-verification"),
		waived: findings.filter((f) => waived.has(f.rule) && f.rule !== "pr-verification"),
	};
}
