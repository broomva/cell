#!/usr/bin/env bun
// `bun run mutate` — the tests must catch every mutant in scripts/lib/mutants.ts.
// Each mutant runs in a scratch copy of the tree (node_modules symlinked), so an
// interrupted run never leaves a bug behind in the checkout. Exit 1 when any
// mutant survives or no longer applies.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMutant, MUTANTS } from "./lib/mutants";

const ROOT = join(import.meta.dir, "..");
const SKIP = new Set(["node_modules", ".git", ".eve", ".output", ".cell"]);

const only = process.argv[2];
const mutants = only ? MUTANTS.filter((m) => m.id === only) : MUTANTS;
if (mutants.length === 0) {
	console.error(`mutate: no mutant ${only}`);
	process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), "cell-mutate-"));
cpSync(ROOT, scratch, { recursive: true, filter: (src) => !SKIP.has(src.slice(ROOT.length + 1).split("/")[0] ?? "") });
symlinkSync(join(ROOT, "node_modules"), join(scratch, "node_modules"));

let survived = 0;
try {
	// A suite that is already red would "kill" every mutant; the unmutated copy must pass first.
	const baseline = Bun.spawnSync(["bun", "test"], {
		cwd: scratch,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, CELL_MUTANT: "baseline" },
	});
	if (baseline.exitCode !== 0) {
		console.log("mutate: the unmutated suite fails; fix it before mutation testing");
		rmSync(scratch, { recursive: true, force: true });
		process.exit(1);
	}
	for (const m of mutants) {
		const file = join(scratch, m.file);
		const original = readFileSync(file, "utf8");
		let mutated: string;
		try {
			mutated = applyMutant(original, m);
		} catch (e) {
			console.log(`STALE    ${m.id.padEnd(28)} ${(e as Error).message}`);
			survived++;
			continue;
		}
		writeFileSync(file, mutated);
		const t = Bun.spawnSync(["bun", "test"], {
			cwd: scratch,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, CELL_MUTANT: m.id },
		});
		writeFileSync(file, original);
		if (t.exitCode === 0) {
			console.log(`SURVIVED ${m.id.padEnd(28)} ${m.why}`);
			survived++;
		} else {
			console.log(`killed   ${m.id.padEnd(28)} ${m.why}`);
		}
	}
} finally {
	rmSync(scratch, { recursive: true, force: true });
}

console.log(`mutate: ${mutants.length - survived}/${mutants.length} killed`);
process.exit(survived === 0 ? 0 : 1);
