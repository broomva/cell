#!/usr/bin/env bun
// `bun run slop [base]` — refuses a change that adds slop, weakens a gate or
// lands without evidence. Base defaults to the merge-base with origin/main.
// In CI the PR body arrives in $PR_BODY; locally the body checks are skipped
// unless $PR_BODY is set.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	applyWaivers,
	coverageFindings,
	deletedTestFindings,
	dependencyRangeFindings,
	type FileChange,
	type Finding,
	lineFindings,
	mutantFindings,
	parseAddedLines,
	prBodyFindings,
	untestedChangeFindings,
	waivers,
} from "./lib/slop";

const ROOT = join(import.meta.dir, "..");
// Diffs are read raw: no external diff driver or textconv may rewrite them.
const RAW = ["--no-ext-diff", "--no-textconv"];

function git(args: string[]): { ok: boolean; out: string } {
	const p = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
	return { ok: p.exitCode === 0, out: p.stdout.toString() };
}

function showAt(rev: string, path: string): string | null {
	const r = git(["show", `${rev}:${path}`]);
	return r.ok ? r.out : null;
}

const base = process.argv[2] ?? git(["merge-base", "HEAD", "origin/main"]).out.trim();
if (!base) {
	console.log("slop: no base (no origin/main yet); nothing to compare");
	process.exit(0);
}

const nameStatus = git(["diff", ...RAW, "--name-status", "-M", `${base}...HEAD`]).out;
const changes: FileChange[] = nameStatus
	.split("\n")
	.filter(Boolean)
	.map((l) => {
		const [status = "M", ...paths] = l.split("\t");
		return { status: status[0] as FileChange["status"], path: paths.at(-1) ?? "" };
	});
const diff = git(["diff", ...RAW, "-U0", `${base}...HEAD`]).out;

const findings: Finding[] = [
	...lineFindings(parseAddedLines(diff)),
	...dependencyRangeFindings(readFileSync(join(ROOT, "package.json"), "utf8")),
	...untestedChangeFindings(changes),
	...deletedTestFindings(changes),
	...coverageFindings(showAt(base, "bunfig.toml"), readFileSync(join(ROOT, "bunfig.toml"), "utf8")),
	...mutantFindings(showAt(base, "scripts/lib/mutants.ts"), readFileSync(join(ROOT, "scripts/lib/mutants.ts"), "utf8")),
];

const body = process.env.PR_BODY;
if (body !== undefined) findings.push(...prBodyFindings(body));
else console.log("slop: PR_BODY unset; skipping the PR body checks (CI sets it)");

const { kept, waived } = applyWaivers(findings, waivers(body ?? ""));
for (const f of waived) console.log(`waived  ${f.rule.padEnd(26)} ${f.where}`);
for (const f of kept) console.log(`SLOP    ${f.rule.padEnd(26)} ${f.where} — ${f.detail}`);
console.log(
	`slop: ${changes.length} file(s) vs ${base.slice(0, 9)}; ${kept.length} finding(s), ${waived.length} waived`,
);
process.exit(kept.length === 0 ? 0 : 1);
