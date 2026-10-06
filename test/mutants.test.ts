import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMutant, MUTANTS } from "../scripts/lib/mutants";

const ROOT = join(import.meta.dir, "..");

describe("mutant catalogue", () => {
	// scripts/mutate.ts never runs this file: in a mutated copy it would fail
	// for every mutant and fake the kill.
	test("every mutant applies exactly once to the current tree", () => {
		for (const m of MUTANTS) {
			const src = readFileSync(join(ROOT, m.file), "utf8");
			const out = applyMutant(src, m);
			expect(out).not.toBe(src);
		}
	});

	test("every killedBy file exists, and none is this catalogue test", () => {
		for (const m of MUTANTS) {
			expect(existsSync(join(ROOT, m.killedBy))).toBe(true);
			expect(m.killedBy).not.toBe("test/mutants.test.ts");
		}
	});

	test("ids are unique", () => {
		expect(new Set(MUTANTS.map((m) => m.id)).size).toBe(MUTANTS.length);
	});

	test("a missing or ambiguous find string is refused", () => {
		const m = { id: "x", file: "f", find: "needle", replace: "pin", killedBy: "t", why: "" };
		expect(() => applyMutant("hay", m)).toThrow(/not in/);
		expect(() => applyMutant("needle needle", m)).toThrow(/more than once/);
		expect(applyMutant("a needle b", m)).toBe("a pin b");
	});
});
