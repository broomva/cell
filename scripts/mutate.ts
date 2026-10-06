#!/usr/bin/env bun
// `bun run mutate [id]` — every mutant in scripts/lib/mutants.ts must be killed
// by the one test it names (`killedBy` file, `killedByTest` name, run alone
// with -t). Each runs in a scratch copy of the tree
// (node_modules symlinked), so an interrupted run never leaves a bug in the
// checkout. Nothing tells the tests a mutation is running. Exit 1 when a
// named test fails unmutated, or any mutant survives, crashes its test
// instead of failing an assertion, or no longer applies.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMutant, MUTANTS } from "./lib/mutants";

const ROOT = join(import.meta.dir, "..");
const SKIP = new Set(["node_modules", ".git", ".eve", ".output", ".cell"]);
// The catalogue test asserts every mutant applies to the tree, so in a mutated
// copy it fails for every mutant. The runner checks applicability itself and
// runs only the named tests, so that test never runs here.
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

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// End-anchored: bun matches -t against the full name ("describe test"), so a
// longer title that merely contains this one ("…, as reviewed") never runs.
const runTest = (file: string, name: string) =>
	Bun.spawnSync(["bun", "test", `./${file}`, "-t", `${escapeRe(name)}$`], {
		cwd: scratch,
		stdout: "pipe",
		stderr: "pipe",
	});
/** bun prints " N pass" / " N fail"; a baseline must run exactly one test. */
const counts = (out: string) => ({
	pass: Number(out.match(/^\s*(\d+) pass/m)?.[1] ?? -1),
	fail: Number(out.match(/^\s*(\d+) fail/m)?.[1] ?? -1),
});

let survived = 0;
try {
	// Each named test must pass unmutated, and must exist: `bun test -t` exits 1
	// when nothing matches, so a misnamed test would otherwise "kill" its mutant.
	const pairs = [...new Map(mutants.map((m) => [`${m.killedBy}\0${m.killedByTest}`, m])).values()];
	for (const m of pairs) {
		if (m.killedBy === CATALOGUE_TEST) throw new Error(`${CATALOGUE_TEST} cannot be a killedBy file`);
		const baseline = runTest(m.killedBy, m.killedByTest);
		const ran = counts(baseline.stdout.toString() + baseline.stderr.toString());
		if (baseline.exitCode !== 0 || ran.pass !== 1 || ran.fail !== 0) {
			console.log(`mutate: unmutated, "${m.killedByTest}" in ${m.killedBy} must run exactly one passing test:`);
			console.log(baseline.stderr.toString().slice(-1500));
			survived = -1;
		}
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
		const t = runTest(m.killedBy, m.killedByTest);
		writeFileSync(file, original);
		// A kill is a failed assertion. A crash (a ReferenceError from a stale
		// replacement, a TypeError the mutant provokes) proves nothing about the test.
		const out = t.stderr.toString();
		const asserted = /error: expect\(/.test(out) && counts(t.stdout.toString() + out).fail === 1;
		if (t.exitCode === 0) {
			console.log(`SURVIVED ${m.id.padEnd(28)} ${m.why} ("${m.killedByTest}" still passes)`);
			survived++;
		} else if (!asserted) {
			console.log(`CRASHED  ${m.id.padEnd(28)} the test failed without a failed assertion:`);
			console.log(
				t.stderr
					.toString()
					.split("\n")
					.filter((l) => /error/i.test(l))
					.slice(0, 3)
					.join("\n"),
			);
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
