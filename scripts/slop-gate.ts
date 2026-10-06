#!/usr/bin/env bun
// `bun run slop [base]` — refuses a change that adds slop or lands without
// evidence. Base defaults to the merge-base with origin/main. In CI the PR body
// arrives in $PR_BODY; locally the body check is skipped unless it is set.
// Any git failure is exit 2: a gate that cannot read the diff does not pass.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	dependencyRangeFindings,
	type FileChange,
	type Finding,
	lineFindings,
	parseAddedLines,
	prBodyFindings,
	untestedChangeFindings,
} from "./lib/slop";

const ROOT = join(import.meta.dir, "..");
// Diffs are read raw: no external diff driver or textconv may rewrite them.
const RAW = ["--no-ext-diff", "--no-textconv"];

function git(args: string[]): string {
	const p = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
	if (p.exitCode !== 0) {
		console.error(`slop: git ${args.join(" ")} failed: ${p.stderr.toString().trim()}`);
		process.exit(2);
	}
	return p.stdout.toString();
}

let base = process.argv[2];
if (!base) {
	const mb = Bun.spawnSync(["git", "merge-base", "HEAD", "origin/main"], { cwd: ROOT, stdout: "pipe" });
	base = mb.exitCode === 0 ? mb.stdout.toString().trim() : "";
}
if (!base) {
	if (process.env.CI) {
		console.error("slop: no base to compare against in CI");
		process.exit(2);
	}
	console.log("slop: no base (no origin/main yet); nothing to compare");
	process.exit(0);
}

const changes: FileChange[] = git(["diff", ...RAW, "--name-status", "-M", `${base}...HEAD`])
	.split("\n")
	.filter(Boolean)
	.map((l) => {
		const [status = "M", ...paths] = l.split("\t");
		return { status: status[0] as FileChange["status"], path: paths.at(-1) ?? "" };
	});
const diff = git(["diff", ...RAW, "-U0", `${base}...HEAD`]);

const findings: Finding[] = [
	...lineFindings(parseAddedLines(diff)),
	...dependencyRangeFindings(readFileSync(join(ROOT, "package.json"), "utf8")),
	...untestedChangeFindings(changes, (p) => readFileSync(join(ROOT, p), "utf8")),
];

const body = process.env.PR_BODY;
if (body !== undefined) findings.push(...prBodyFindings(body));
else console.log("slop: PR_BODY unset; skipping the PR body check (CI sets it)");

for (const f of findings) console.log(`SLOP    ${f.rule.padEnd(26)} ${f.where} — ${f.detail}`);
console.log(`slop: ${changes.length} file(s) vs ${base.slice(0, 9)}; ${findings.length} finding(s)`);
process.exit(findings.length === 0 ? 0 : 1);
