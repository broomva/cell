// The gate guard: decides whether a PR touches the machinery that judges PRs.
// It runs from the DEFAULT branch under `pull_request_target`
// (.github/workflows/gate-guard.yml), reads only the PR's file list and two
// package.json blobs through the API, and never executes PR code. A PR cannot
// weaken it, because the copy that runs is main's.
//
// A guarded PR fails this check. Merging one takes a repository admin's
// ruleset bypass: a deliberate, logged human act. Agents never bypass.

export interface PrFile {
	filename: string;
	status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
	previous_filename?: string;
}

/** The files that define, run or configure a gate. */
export const GUARDED: RegExp[] = [
	/^\.github\//,
	/^\.githooks\//,
	/^\.claude\//,
	/^scripts\/lib\/(slop|mutants|guard)\.ts$/,
	/^scripts\/(slop-gate|mutate|gate-guard)\.ts$/,
	/^scripts\/(grep-gate|agent-stop-gate)\.sh$/,
	/^bunfig\.toml$/,
	/^biome\.json$/,
	/^tsconfig\.json$/,
];

const TEST = /(^test\/|\.test\.ts$|\.eval\.ts$)/;

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
		if (f.status === "removed" && TEST.test(f.filename)) out.push({ path: f.filename, reason: "deletes a test" });
		if (f.status === "renamed" && f.previous_filename && TEST.test(f.previous_filename) && !TEST.test(f.filename)) {
			out.push({ path: `${f.previous_filename} → ${f.filename}`, reason: "moves a test out of the suite" });
		}
	}
	return out;
}

/** `scripts` runs the gates and `overrides` rewires the dependency tree; neither may change unseen. */
export function packageFindings(base: string | null, head: string | null): GuardFinding[] {
	if (base === null || head === null) return [];
	const b = JSON.parse(base) as Record<string, unknown>;
	const h = JSON.parse(head) as Record<string, unknown>;
	const out: GuardFinding[] = [];
	for (const key of ["scripts", "overrides"]) {
		if (JSON.stringify(b[key] ?? null) !== JSON.stringify(h[key] ?? null)) {
			out.push({ path: `package.json ${key}`, reason: "changes how the gates run" });
		}
	}
	return out;
}
