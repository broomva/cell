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

/**
 * Each changed source file under agent/ or scripts/lib/ needs a changed test
 * that imports it and adds an assertion. agent/ files no test imports (tool
 * slots, agent.ts, channels) need the surface test or an eval to change
 * instead. A test that merely mentions the module's name does not count.
 */
export function untestedChangeFindings(
	changes: FileChange[],
	readFile: (path: string) => string,
	added: AddedLine[],
): Finding[] {
	const live = changes.filter((c) => c.status !== "D");
	const tests = live.filter((c) => TEST.test(c.path));
	const asserts = (path: string) =>
		added.some(
			(l) => l.path === path && /\bexpect\(|\bt\.(check|require|called|succeeded|usedNoTools|notCalled)/.test(l.text),
		);
	const out: Finding[] = [];
	for (const c of live) {
		if (!/^(agent\/|scripts\/lib\/)/.test(c.path) || !TS.test(c.path) || TEST.test(c.path)) continue;
		const modulePath = c.path.replace(TS, "");
		const imports = new RegExp(`["'](?:\\.{1,2}/)+${escapeRe(modulePath)}(?:\\.ts)?["']`);
		const covered = tests.some((t) => imports.test(readFile(t.path)) && asserts(t.path));
		const surface =
			/^agent\//.test(c.path) &&
			tests.some((t) => (t.path === "test/surface.test.ts" || /^evals\//.test(t.path)) && asserts(t.path));
		if (!covered && !surface) {
			out.push({
				rule: "source-without-test",
				where: c.path,
				detail: `no changed test imports ${modulePath} and adds an assertion`,
			});
		}
	}
	return out;
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
				rule: "pr-live-evidence",
				where: "PR body",
				detail:
					"the model path changed: quote `bun run eval`'s `Results: N passed (N total)`, or `Live eval not run: <reason>`",
			});
		}
	}
	return out;
}
