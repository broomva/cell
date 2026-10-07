#!/usr/bin/env bun
// `bun scripts/ruleset-check.ts [owner/repo]` — fails while main's ruleset does
// not require gate and gate-guard bound to the GitHub Actions app. CI runs it
// inside the required `gate`, so removing a requirement turns every PR red.
// An unreadable ruleset is a failure, never a pass.
import { rulesetGaps } from "./lib/ruleset";

const repo = process.argv[2] ?? process.env.GITHUB_REPOSITORY;
if (!repo) {
	console.error("ruleset: pass owner/repo or set GITHUB_REPOSITORY");
	process.exit(2);
}
const p = Bun.spawnSync(["gh", "api", `repos/${repo}/rules/branches/main`], { stdout: "pipe", stderr: "pipe" });
let gaps = [`could not read the ruleset: ${new TextDecoder().decode(p.stderr).trim()}`];
if (p.exitCode === 0) {
	try {
		gaps = rulesetGaps(JSON.parse(new TextDecoder().decode(p.stdout)));
	} catch (e) {
		gaps = [`unparseable ruleset: ${(e as Error).message}`];
	}
}
for (const g of gaps) console.log(`RULESET ${g}`);
console.log(`ruleset: ${gaps.length === 0 ? "ok" : `${gaps.length} gap(s)`}`);
process.exit(gaps.length === 0 ? 0 : 1);
