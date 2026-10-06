#!/usr/bin/env bun
// `bun run mutate [id]` — every mutant in scripts/lib/mutants.ts must be killed
// by its own `killedBy` test file. Each runs in a scratch copy of the tree
// (node_modules symlinked), so an interrupted run never leaves a bug in the
// checkout. Nothing tells the tests a mutation is running. Exit 1 when the
// unmutated suite fails, or any mutant survives or no longer applies.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMutant, MUTANTS } from "./lib/mutants";

const ROOT = join(import.meta.dir, "..");
const SKIP = new Set(["node_modules", ".git", ".eve", ".output", ".cell"]);
// The catalogue test asserts every mutant applies to the tree, so in a mutated
// copy it fails for every mutant. The runner checks applicability itself, and
// runs only killedBy files, so that test never runs here.
const CATALOGUE_TEST = "test/mutants.test.ts";

const only = process.argv[2];
const mutants = only ? MUTANTS.filter((m) => m.id === only) : MUTANTS;
if (mutants.length === 0) {
	console.error(`mutate: no mutant ${only}`);
	process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), "t-"));
cpSync(ROOT, scratch, { recursive: true, filter: (src) => !SKIP.has(src.slice(ROOT.length + 1).split("/")[0] ?? "") });
symlinkSync(join(ROOT, "node_modules"), join(scratch, "node_modules"));

const runTests = (files: string[]) =>
	Bun.spawnSync(["bun", "test", ...files.map((f) => `./${f}`)], { cwd: scratch, stdout: "pipe", stderr: "pipe" });

let survived = 0;
try {
	const killers = [...new Set(mutants.map((m) => m.killedBy))];
	if (killers.includes(CATALOGUE_TEST)) throw new Error(`${CATALOGUE_TEST} cannot be a killedBy file`);
	// Each killedBy file must pass unmutated, or every "kill" would be a pre-existing failure.
	const baseline = runTests(killers);
	if (baseline.exitCode !== 0) {
		console.log(
			`mutate: the unmutated killedBy files fail; fix them first:\n${baseline.stderr.toString().slice(-2000)}`,
		);
		survived = -1;
	}
	for (const m of survived < 0 ? [] : mutants) {
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
		const t = runTests([m.killedBy]);
		writeFileSync(file, original);
		if (t.exitCode === 0) {
			console.log(`SURVIVED ${m.id.padEnd(28)} ${m.why} (${m.killedBy} still passes)`);
			survived++;
		} else {
			console.log(`killed   ${m.id.padEnd(28)} ${m.why}`);
		}
	}
} finally {
	rmSync(scratch, { recursive: true, force: true });
}

if (survived < 0) process.exit(1);
console.log(`mutate: ${mutants.length - survived}/${mutants.length} killed`);
process.exit(survived === 0 ? 0 : 1);
