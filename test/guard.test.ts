import { describe, expect, test } from "bun:test";
import { fileFindings, GUARDED, type PrFile, packageFindings } from "../scripts/lib/guard";

const f = (filename: string, status: PrFile["status"] = "modified", previous_filename?: string): PrFile => ({
	filename,
	status,
	...(previous_filename ? { previous_filename } : {}),
});

describe("guard: gate files", () => {
	test("every gate file is guarded", () => {
		for (const p of [
			".github/workflows/ci.yml",
			".github/workflows/gate-guard.yml",
			".githooks/pre-commit",
			".claude/settings.json",
			"scripts/lib/slop.ts",
			"scripts/lib/mutants.ts",
			"scripts/lib/guard.ts",
			"scripts/slop-gate.ts",
			"scripts/mutate.ts",
			"scripts/gate-guard.ts",
			"scripts/grep-gate.sh",
			"scripts/agent-stop-gate.sh",
			"bunfig.toml",
			"biome.json",
			"tsconfig.json",
		]) {
			expect(fileFindings([f(p)]).map((x) => x.reason)).toEqual(["changes a gate"]);
		}
	});

	test("ordinary source, tests and docs are not", () => {
		for (const p of ["agent/lib/provider.ts", "test/provider.test.ts", "README.md", "scripts/doctor.ts"]) {
			expect(fileFindings([f(p)])).toEqual([]);
		}
		expect(GUARDED.some((g) => g.test("scripts/lib/surfaces.ts"))).toBe(false);
	});

	test("renaming a gate file away still counts", () => {
		expect(fileFindings([f("scripts/lib/old.ts", "renamed", "scripts/lib/slop.ts")])).toHaveLength(1);
	});
});

describe("guard: tests", () => {
	test("deleting a test", () => {
		expect(fileFindings([f("test/grant.test.ts", "removed")]).map((x) => x.reason)).toEqual(["deletes a test"]);
		expect(fileFindings([f("evals/substrate.eval.ts", "removed")])).toHaveLength(1);
		expect(fileFindings([f("agent/lib/x.ts", "removed")])).toEqual([]);
	});

	test("moving a test out of the suite, but not within it", () => {
		expect(fileFindings([f("notes/grant.txt", "renamed", "test/grant.test.ts")]).map((x) => x.reason)).toEqual([
			"moves a test out of the suite",
		]);
		expect(fileFindings([f("test/grant-v2.test.ts", "renamed", "test/grant.test.ts")])).toEqual([]);
	});
});

describe("guard: package.json", () => {
	const pkg = (scripts: object, overrides: object = { undici: "8.11.2" }, deps: object = { eve: "0.67.2" }) =>
		JSON.stringify({ scripts, overrides, dependencies: deps });
	const base = pkg({ test: "bun test --coverage" });

	test("a dependency bump passes", () => {
		expect(packageFindings(base, pkg({ test: "bun test --coverage" }, undefined, { eve: "0.68.0" }))).toEqual([]);
	});

	test("changing scripts or overrides is guarded", () => {
		expect(packageFindings(base, pkg({ test: "true" })).map((x) => x.path)).toEqual(["package.json scripts"]);
		expect(packageFindings(base, pkg({ test: "bun test --coverage" }, {})).map((x) => x.path)).toEqual([
			"package.json overrides",
		]);
	});

	test("a missing package.json on either side is not a finding", () => {
		expect(packageFindings(null, base)).toEqual([]);
		expect(packageFindings(base, null)).toEqual([]);
	});
});
