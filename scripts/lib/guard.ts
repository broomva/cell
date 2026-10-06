// The gate guard: decides whether a PR touches the machinery that judges PRs.
// It runs from the DEFAULT branch under `pull_request_target`
// (.github/workflows/gate-guard.yml), reads only the PR's file list and two
// package.json blobs through the API, and never executes PR code. A PR cannot
// weaken it, because the copy that runs is main's.
//
// A guarded PR fails this check. Merging one takes a human: the ruleset's
// admin bypass, which the repository's agent hook (.claude/) refuses to agents.

export interface PrFile {
	filename: string;
	status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
	previous_filename?: string;
}

/** The files that define, run or configure a gate, or change what CI installs. */
export const GUARDED: RegExp[] = [
	/^\.github\//,
	/^\.githooks\//,
	/^\.claude\//,
	/^scripts\/lib\/(slop|mutants|guard|agent-gate)\.ts$/,
	/^scripts\/(slop-gate|mutate|gate-guard|agent-pretool-gate)\.ts$/,
	/^scripts\/[^/]+\.sh$/,
	/^bunfig\.toml$/,
	/^biome\.json$/,
	/^tsconfig\.json$/,
	/^\.npmrc$/,
	/^patches\//,
];

/** What `bun test` runs (bunfig root = "test"), and what `eve eval` runs. */
const SUITES: RegExp[] = [/^test\/.+\.test\.ts$/, /^evals\/.+\.eval\.ts$/];
const suiteOf = (p: string) => SUITES.findIndex((s) => s.test(p));

export interface GuardFinding {
	path: string;
	reason: string;
}

export function fileFindings(files: PrFile[]): GuardFinding[] {
	const out: GuardFinding[] = [];
	for (const f of files) {
		const paths = [f.filename, f.previous_filename].filter((p): p is string => !!p);
		const guarded = paths.find((p) => GUARDED.some((g) => g.test(p)));
		if (guarded) out.push({ path: guarded, reason: "changes a gate" });
		if (f.status === "removed" && suiteOf(f.filename) >= 0) out.push({ path: f.filename, reason: "deletes a test" });
		if (f.status === "renamed" && f.previous_filename) {
			const from = suiteOf(f.previous_filename);
			if (from >= 0 && suiteOf(f.filename) !== from) {
				out.push({ path: `${f.previous_filename} → ${f.filename}`, reason: "moves a test out of its suite" });
			}
		}
	}
	return out;
}

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** Key-order-insensitive JSON, so a reordered object is not a change. */
function canonical(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
	if (v && typeof v === "object") {
		const o = v as Record<string, unknown>;
		return `{${Object.keys(o)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
			.join(",")}}`;
	}
	return JSON.stringify(v);
}

/**
 * Every package.json change except adding, removing or re-versioning a
 * dependency is guarded: scripts run the gates, and overrides, patches,
 * trustedDependencies or imports change what CI installs and resolves. A
 * missing side reads as `{}`; it never means "no change".
 */
export function packageFindings(base: string | null, head: string | null): GuardFinding[] {
	const b = JSON.parse(base ?? "{}") as Record<string, unknown>;
	const h = JSON.parse(head ?? "{}") as Record<string, unknown>;
	const out: GuardFinding[] = [];
	for (const key of [...new Set([...Object.keys(b), ...Object.keys(h)])].sort()) {
		if (DEPENDENCY_SECTIONS.includes(key)) continue;
		if (canonical(b[key]) !== canonical(h[key])) {
			out.push({ path: `package.json ${key}`, reason: "changes how the gates run or what CI installs" });
		}
	}
	return out;
}

/** GitHub lists at most 3000 files per PR; a truncated list cannot clear one. */
export function completeness(listed: number, changedFiles: number): GuardFinding[] {
	return listed === changedFiles
		? []
		: [{ path: "(file list)", reason: `listed ${listed} of ${changedFiles} changed files; cannot judge the rest` }];
}
