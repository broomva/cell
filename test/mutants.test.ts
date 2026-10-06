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

	test("every killedBy file exists, names its test, and is not this catalogue test", () => {
		for (const m of MUTANTS) {
			expect(existsSync(join(ROOT, m.killedBy))).toBe(true);
			expect(m.killedBy).not.toBe("test/mutants.test.ts");
			// Exactly one test is titled exactly this; no other title in the file ends with it.
			const src = readFileSync(join(ROOT, m.killedBy), "utf8");
			const titles = [...src.matchAll(/\btest\(\s*"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1] ?? "");
			expect({ id: m.id, exact: titles.filter((x) => x === m.killedByTest).length }).toEqual({ id: m.id, exact: 1 });
			expect({ id: m.id, suffix: titles.filter((x) => x.endsWith(m.killedByTest)).length }).toEqual({
				id: m.id,
				suffix: 1,
			});
		}
	});

	// A test that pins a module's source text fails for every mutant of that
	// module without checking any behaviour. Tests that kill mutants assert
	// what the code does, never what it says: no file reads, no function
	// source (toString, String()), no snapshots.
	test("no killedBy file reads source text", () => {
		const reads =
			/readFileSync|readFile\(|Bun\.file\(|with\s*\{\s*type:\s*["']text["']|node:fs\/promises|\.toString\(\s*\)|\bString\(|Function\.prototype|toMatch(Inline)?Snapshot/;
		for (const file of new Set(MUTANTS.map((m) => m.killedBy))) {
			expect({ file, reads: reads.test(readFileSync(join(ROOT, file), "utf8")) }).toEqual({ file, reads: false });
		}
	});

	test("ids are unique", () => {
		expect(new Set(MUTANTS.map((m) => m.id)).size).toBe(MUTANTS.length);
	});

	test("a missing or ambiguous find string is refused", () => {
		const m = { id: "x", file: "f", find: "needle", replace: "pin", killedBy: "t", killedByTest: "n", why: "" };
		expect(() => applyMutant("hay", m)).toThrow(/not in/);
		expect(() => applyMutant("needle needle", m)).toThrow(/more than once/);
		expect(applyMutant("a needle b", m)).toBe("a pin b");
	});
});
