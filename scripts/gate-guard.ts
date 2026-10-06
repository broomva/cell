#!/usr/bin/env bun
// Run by .github/workflows/gate-guard.yml from the default branch. Needs
// GH_TOKEN, REPO (owner/name), PR (number), BASE_SHA and HEAD_SHA. Reads the
// PR through the API only; never checks out or runs PR code.
import { completeness, fileFindings, type PrFile, packageFindings } from "./lib/guard";

const { REPO, PR, BASE_SHA, HEAD_SHA } = process.env;
if (!REPO || !PR || !BASE_SHA || !HEAD_SHA) {
	console.error("gate-guard: REPO, PR, BASE_SHA and HEAD_SHA are required");
	process.exit(2);
}

function gh(args: string[]): string | null {
	const p = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
	return p.exitCode === 0 ? p.stdout.toString() : null;
}

const listed = gh(["api", "--paginate", "--slurp", `repos/${REPO}/pulls/${PR}/files?per_page=100`]);
if (listed === null) {
	console.error("gate-guard: could not list the PR's files");
	process.exit(2);
}
const files = (JSON.parse(listed) as PrFile[][]).flat();
// The file list is the PR's current one; it must belong to the head this run reports on.
const pr = gh(["api", `repos/${REPO}/pulls/${PR}`, "--jq", '"\\(.changed_files) \\(.head.sha)"']);
const [count = "", head = ""] = (pr ?? "").trim().split(" ");
if (!/^\d+$/.test(count) || !head) {
	console.error("gate-guard: could not read the PR's changed_files count and head");
	process.exit(2);
}
if (head !== HEAD_SHA) {
	console.error(`gate-guard: the PR moved from ${HEAD_SHA} to ${head}; the run for the new head decides`);
	process.exit(1);
}

const blob = (sha: string) =>
	gh(["api", "-H", "Accept: application/vnd.github.raw", `repos/${REPO}/contents/package.json?ref=${sha}`]);

// Fetch package.json only when the PR touches it; a fetch that fails is an
// error, never "no change".
let pkg: ReturnType<typeof packageFindings> = [];
const pkgFile = files.find((f) => f.filename === "package.json" || f.previous_filename === "package.json");
if (pkgFile) {
	const base = pkgFile.status === "added" ? "{}" : blob(BASE_SHA);
	const head = pkgFile.status === "removed" ? "{}" : blob(HEAD_SHA);
	if (base === null || head === null) {
		console.error("gate-guard: could not read package.json at base or head");
		process.exit(2);
	}
	pkg = packageFindings(base, head);
}

const findings = [...completeness(files.length, Number(count)), ...fileFindings(files), ...pkg];
for (const f of findings) console.log(`GUARDED ${f.path} — ${f.reason}`);
console.log(`gate-guard: ${files.length} file(s); ${findings.length} guarded change(s)`);
if (findings.length > 0) {
	console.log("A human must review this PR and merge it with the ruleset's admin bypass. Agents never bypass.");
	process.exit(1);
}
