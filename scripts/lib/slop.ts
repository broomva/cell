// The slop gate's rules, as pure functions over a diff. scripts/slop-gate.ts
// feeds them `git diff base...HEAD` and the PR body; each rule has a test in
// test/slop.test.ts.
//
// Division of labour, so no check is owned twice:
// - Biome (biome.json, errors): explicit any, ts-ignore directives, focused and
//   skipped tests, console in agent/. It reads the syntax tree; a regex here would not.
// - This file: what Biome has no rule for, read from the added lines.
// - The gate guard (scripts/lib/guard.ts, run from main): edits to the gates,
//   deleted or moved tests, package.json scripts and overrides. Nothing a PR
//   says about itself can waive those, so this gate has no waivers either.

export interface Finding {
	rule: string;
	where: string;
	detail: string;
}

export interface FileChange {
	status: "A" | "M" | "D" | "R" | "C" | "T";
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
/** This file spells out every pattern it bans. It is exempt from the line rules; the gate guard holds it instead. */
const SELF = /^scripts\/lib\/slop\.ts$/;
const LITERAL_ASSERTION = /\bexpect\(\s*(true|false|null|undefined|-?\d+(\.\d+)?|"[^"]*"|'[^']*'|`[^`$]*`)\s*\)/;
/** The ${…} expressions of a template literal, scanned with brace depth so nested objects stay whole. */
export function templateExpressions(t: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < t.length; i++) {
		if (t[i] !== "$" || t[i + 1] !== "{") continue;
		let depth = 1;
		let j = i + 2;
		for (; j < t.length && depth > 0; j++) {
			if (t[j] === "{") depth++;
			else if (t[j] === "}") depth--;
		}
		out.push(t.slice(i + 2, j - 1));
		i = j - 1;
	}
	return out;
}

/** A line with its string literals and trailing comment removed, so a name inside a string is not a use. */
const code = (line: string) =>
	line
		// A template literal keeps its ${…} expressions: they are code.
		.replace(/`(?:[^`\\]|\\.)*`/g, (t) => templateExpressions(t).join(" ") || '""')
		.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
		.replace(/\/\/.*$/, "");

interface LineRule {
	id: string;
	applies: (path: string) => boolean;
	bad: RegExp;
	detail: string;
	unless?: RegExp;
}

export const LINE_RULES: LineRule[] = [
	{
		id: "conditional-test",
		applies: (p) => TEST.test(p),
		// Biome's noSkippedTests covers .skip( and x-prefixed tests; these slip past it.
		bad: /\.(todo|todoIf|skipIf|if|failing)\b|\.skip\.|\.each\(\s*\[\s*\]/,
		detail: "a todo, conditional or expected-to-fail test can switch itself off",
	},
	{
		id: "assertion-on-literal",
		applies: (p) => TEST.test(p),
		bad: LITERAL_ASSERTION,
		detail: "an assertion on a literal (expect(true), expect(1)) checks nothing",
	},
	{
		id: "ts-nocheck",
		applies: (p) => TS.test(p),
		bad: /@ts-nocheck\b/,
		detail: "switches the type checker off for the whole file",
	},
	{
		id: "ts-expect-error-no-reason",
		applies: (p) => TS.test(p),
		bad: /@ts-expect-error\s*$/,
		detail: "@ts-expect-error needs a reason after it",
	},
	{
		id: "todo-without-ticket",
		applies: (p) => !p.endsWith(".md"),
		bad: /\b(TODO|FIXME|XXX|HACK)\b/,
		unless: TICKET,
		detail: "a TODO must name the ticket that will close it",
	},
	{
		id: "skip-hooks",
		// Prose may name the flag to forbid it; code and workflows may not use it.
		applies: (p) => !p.endsWith(".md"),
		bad: /--no-verify\b/,
		detail: "never bypass the git hooks",
	},
];

/**
 * Parse `git diff -U0` into added lines with their new-file line numbers.
 * Inside a hunk, lines are counted against the hunk header's lengths, so an
 * added line whose own text starts with `++ ` is content, not a file header.
 */
export function parseAddedLines(diff: string): AddedLine[] {
	const out: AddedLine[] = [];
	let path = "";
	let line = 0;
	let oldLeft = 0;
	let newLeft = 0;
	for (const raw of diff.split("\n")) {
		if (oldLeft > 0 || newLeft > 0) {
			if (raw.startsWith("+")) {
				if (path) out.push({ path, line, text: raw.slice(1) });
				line++;
				newLeft--;
			} else if (raw.startsWith("-")) {
				oldLeft--;
			} else if (raw.startsWith(" ")) {
				line++;
				oldLeft--;
				newLeft--;
			}
			continue;
		}
		if (raw.startsWith("+++ ")) {
			path = raw.startsWith("+++ b/") ? raw.slice(6) : "";
			continue;
		}
		const hunk = raw.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
		if (hunk?.[2]) {
			oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
			line = Number(hunk[2]);
			newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
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

const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Every dependency is pinned to an exact version; anything else lets a release change behaviour without a diff. */
export function dependencyRangeFindings(packageJson: string): Finding[] {
	const pkg = JSON.parse(packageJson) as Record<string, unknown>;
	const out: Finding[] = [];
	const sections = [
		"dependencies",
		"devDependencies",
		"peerDependencies",
		"optionalDependencies",
		"overrides",
		"resolutions",
	];
	for (const section of sections) {
		const deps = pkg[section];
		if (deps === undefined) continue;
		if (typeof deps !== "object" || deps === null) {
			out.push({ rule: "dependency-range", where: `package.json ${section}`, detail: "not an object" });
			continue;
		}
		for (const [name, version] of Object.entries(deps)) {
			if (typeof version !== "string" || !EXACT.test(version)) {
				out.push({
					rule: "dependency-range",
					where: `package.json ${section}.${name}`,
					detail: `${JSON.stringify(version)} is not an exact version`,
				});
			}
		}
	}
	return out;
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Model-path files: changing one needs live evidence (an eval run) or a stated reason it was not run. */
export const MODEL_PATH = /^(agent\/|evals\/|package\.json$)/;

/** agent/ files no test can import (eve loads them by slot); the surface test or an eval covers them. */
const SLOTS = /^agent\/(tools|channels|sandbox|instructions)\/|^agent\/agent\.ts$/;

const ASSERTION = /\bexpect\(|\bt\.(check|require|calledTool|notCalledTool|succeeded|usedNoTools|messageIncludes)\(/;

/** The names a test file imports from a module path (named, renamed, default and namespace imports). */
export function importedNames(testSource: string, modulePath: string): string[] {
	const spec = `["'](?:\\.{1,2}/)+${escapeRe(modulePath)}(?:\\.ts)?["']`;
	const names: string[] = [];
	for (const m of testSource.matchAll(new RegExp(`import\\s+([^;]*?)\\s+from\\s+${spec}`, "g"))) {
		// A type-only import runs nothing from the module, so it is not coverage.
		if (/^type\s/.test(m[1] ?? "")) continue;
		const clause = m[1] ?? "";
		const braces = clause.match(/\{([^}]*)\}/)?.[1] ?? "";
		for (const part of braces.split(",")) {
			if (/^\s*type\s/.test(part)) continue;
			const name = part
				.split(/\s+as\s+/)
				.at(-1)
				?.trim();
			if (name) names.push(name);
		}
		const outside = clause.replace(/\{[^}]*\}/, "").replace(/\*\s+as\s+/, "");
		for (const name of outside.split(",").map((x) => x.trim())) if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
	}
	for (const m of testSource.matchAll(new RegExp(`\\{([^}]*)\\}\\s*=\\s*await\\s+import\\(\\s*${spec}\\s*\\)`, "g"))) {
		for (const part of (m[1] ?? "").split(",")) {
			const name = part.split(":").at(-1)?.trim();
			if (name) names.push(name);
		}
	}
	return names;
}

/**
 * Each changed source file under agent/ or scripts/lib/ needs a changed test
 * that imports it and adds an assertion using something it imported from it.
 * agent/ slot files no test can import need an added assertion in the surface
 * test or an eval instead. A name mention, an unrelated assertion in a test
 * that happens to import the module, or an assertion on a literal does not count.
 */
export function untestedChangeFindings(
	changes: FileChange[],
	readFile: (path: string) => string,
	added: AddedLine[],
): Finding[] {
	const live = changes.filter((c) => c.status !== "D");
	const tests = live.filter((c) => TEST.test(c.path));
	const assertions = (path: string) =>
		added.filter((l) => l.path === path && ASSERTION.test(l.text) && !LITERAL_ASSERTION.test(l.text));
	const out: Finding[] = [];
	for (const c of live) {
		if (!/^(agent\/|scripts\/lib\/)/.test(c.path) || !TS.test(c.path) || TEST.test(c.path)) continue;
		const modulePath = c.path.replace(TS, "");
		const covered = tests.some((t) => {
			const names = importedNames(readFile(t.path), modulePath);
			return (
				names.length > 0 &&
				assertions(t.path).some((l) => names.some((n) => new RegExp(`\\b${escapeRe(n)}\\b`).test(code(l.text))))
			);
		});
		const slot =
			SLOTS.test(c.path) &&
			tests.some(
				(t) => (t.path === "test/surface.test.ts" || /^evals\//.test(t.path)) && assertions(t.path).length > 0,
			);
		if (!covered && !slot) {
			out.push({
				rule: "source-without-test",
				where: c.path,
				detail: `no changed test imports ${modulePath} and adds an assertion that uses it`,
			});
		}
	}
	return out;
}

const LOCKFILES = new Set(["bun.lock", "bun.lockb"]);
const DEPENDENCY_MAPS = new Set(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]);

/**
 * A dependency bump: every change modifies the lockfile or package.json, and package.json differs
 * only inside its dependency maps (a script, a key like trustedDependencies or overrides, or an
 * added or deleted file is not a bump). Such a PR skips the PR-body evidence rule (owner,
 * 2026-10-21, BRO-2967): a bot cannot write the Verification section, and CI still reruns the
 * tests and the mutation gate on the PR itself. Pins are still checked by dependencyRangeFindings.
 */
export function isDependencyOnlyChange(
	changes: FileChange[],
	packageJsonBefore: string | undefined,
	packageJsonAfter: string,
): boolean {
	if (changes.length === 0) return false;
	for (const c of changes) {
		if (c.status !== "M") return false;
		if (!LOCKFILES.has(c.path) && c.path !== "package.json") return false;
	}
	if (!changes.some((c) => c.path === "package.json")) return true;
	if (packageJsonBefore === undefined) return false;
	let before: unknown;
	let after: unknown;
	try {
		before = JSON.parse(packageJsonBefore);
		after = JSON.parse(packageJsonAfter);
	} catch {
		return false;
	}
	const isObject = (v: unknown): v is Record<string, unknown> =>
		typeof v === "object" && v !== null && !Array.isArray(v);
	if (!isObject(before) || !isObject(after)) return false;
	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (DEPENDENCY_MAPS.has(key)) continue;
		if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) return false;
	}
	return true;
}

export interface EvidenceNeeds {
	/** The mutant catalogue's size: the verdict must report every one killed. */
	mutants: number;
	/** The PR changes a model-path file (MODEL_PATH). */
	modelPath: boolean;
}

/**
 * The PR body must carry evidence, visible on the rendered page, in a
 * `## Verification` section: `mutate: N/N killed` with N the catalogue size,
 * and, when the model path changed, eve's `Results: N passed (N total)` line
 * or `Live eval not run: <reason>`. Text can be forged and CI reruns the
 * mutation gate anyway; the section exists for what CI cannot run (live
 * evals) and so a reviewer sees what the author ran.
 */
export function prBodyFindings(body: string, needs: EvidenceNeeds): Finding[] {
	const visible = body.replace(/<!--[\s\S]*?(-->|$)/g, "");
	const verification = visible.match(/^##\s+Verification\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m);
	if (!verification) {
		return [{ rule: "pr-verification", where: "PR body", detail: "no visible `## Verification` section" }];
	}
	const section = verification[1] ?? "";
	const out: Finding[] = [];
	const verdict = section.match(/mutate: (\d+)\/(\d+) killed/);
	if (!verdict || verdict[1] !== verdict[2] || Number(verdict[2]) !== needs.mutants) {
		out.push({
			rule: "pr-verification",
			where: "PR body",
			detail: `the Verification section does not quote \`mutate: ${needs.mutants}/${needs.mutants} killed\``,
		});
	}
	if (needs.modelPath) {
		const ran = /Results: (\d+) passed \(\1 total\)/.test(section);
		const declined = /^Live eval not run: \S+(\s+\S+){4,}/m.test(section);
		if (!ran && !declined) {
			out.push({
				rule: "pr-live-status",
				where: "PR body",
				detail:
					"the model path changed: quote `bun run eval`'s `Results: N passed (N total)`, or `Live eval not run: <reason>`",
			});
		}
	}
	return out;
}
