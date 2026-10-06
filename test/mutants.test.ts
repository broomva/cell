import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMutant, MUTANTS } from "../scripts/lib/mutants";

const ROOT = join(import.meta.dir, "..");

describe("mutant catalogue", () => {
	// Inside a mutation run the tree is mutated on purpose, so this check would
	// fail for every mutant and count it as killed; the runner sets CELL_MUTANT.
	test.if(!process.env.CELL_MUTANT)("every mutant applies exactly once to the current tree", () => {
		for (const m of MUTANTS) {
			const src = readFileSync(join(ROOT, m.file), "utf8");
			const out = applyMutant(src, m);
			expect(out).not.toBe(src);
		}
	});

	test("ids are unique", () => {
		expect(new Set(MUTANTS.map((m) => m.id)).size).toBe(MUTANTS.length);
	});

	test("a missing or ambiguous find string is refused", () => {
		const m = { id: "x", file: "f", find: "needle", replace: "pin", why: "" };
		expect(() => applyMutant("hay", m)).toThrow(/not in/);
		expect(() => applyMutant("needle needle", m)).toThrow(/more than once/);
		expect(applyMutant("a needle b", m)).toBe("a pin b");
	});
});
