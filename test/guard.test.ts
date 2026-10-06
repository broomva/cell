import { describe, expect, test } from "bun:test";
import { completeness, fileFindings, GUARDED, type PrFile, packageFindings } from "../scripts/lib/guard";

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
			"scripts/lib/agent-gate.ts",
			"scripts/agent-pretool-gate.ts",
			"scripts/ruleset-check.ts",
			"scripts/lib/ruleset.ts",
			"scripts/grep-gate.sh",
			"scripts/agent-stop-gate.sh",
			"bunfig.toml",
			"biome.json",
			"tsconfig.json",
			".npmrc",
			"patches/eve@0.67.2.patch",
			"scripts/anything-new.sh",
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
	test("deleting a test or an eval", () => {
		expect(fileFindings([f("test/grant.test.ts", "removed")]).map((x) => x.reason)).toEqual(["deletes a test"]);
		expect(fileFindings([f("evals/substrate.eval.ts", "removed")])).toHaveLength(1);
		expect(fileFindings([f("agent/lib/x.ts", "removed")])).toEqual([]);
	});

	test("moving a test out of its suite, by any path", () => {
		for (const to of ["notes/grant.txt", "test/grant.ts", "evals/grant.eval.ts", "test/grant.test.tsx"]) {
			expect(fileFindings([f(to, "renamed", "test/grant.test.ts")]).map((x) => x.reason)).toEqual([
				"moves a test out of its suite",
			]);
		}
		expect(fileFindings([f("test/substrate.test.ts", "renamed", "evals/substrate.eval.ts")])).toHaveLength(1);
	});

	test("a rename within its suite is fine", () => {
		expect(fileFindings([f("test/grant-v2.test.ts", "renamed", "test/grant.test.ts")])).toEqual([]);
		expect(fileFindings([f("evals/live/substrate.eval.ts", "renamed", "evals/substrate.eval.ts")])).toEqual([]);
	});
});

describe("guard: completeness", () => {
	test("a truncated file list fails closed", () => {
		expect(completeness(56, 56)).toEqual([]);
		expect(completeness(3000, 3001)).toHaveLength(1);
	});
});

describe("guard: package.json", () => {
	const pkg = (extra: object = {}, deps: object = { eve: "0.67.2" }) =>
		JSON.stringify({ name: "cell", scripts: { test: "bun test --coverage" }, dependencies: deps, ...extra });
	const base = pkg();

	test("adding, removing or bumping a dependency passes", () => {
		expect(packageFindings(base, pkg({}, { eve: "0.68.0" }))).toEqual([]);
		expect(packageFindings(base, pkg({}, { eve: "0.67.2", zod: "4.5.4" }))).toEqual([]);
		expect(packageFindings(base, pkg({}, {}))).toEqual([]);
	});

	test("reordering keys is not a change", () => {
		const a = JSON.stringify({ scripts: { a: "1", b: "2" }, overrides: { u: "1.0.0" } });
		const b = JSON.stringify({ overrides: { u: "1.0.0" }, scripts: { b: "2", a: "1" } });
		expect(packageFindings(a, b)).toEqual([]);
	});

	test("every other key is guarded", () => {
		const cases: [object, string][] = [
			[{ scripts: { test: "true" } }, "scripts"],
			[{ overrides: { undici: "8.11.2" } }, "overrides"],
			[{ trustedDependencies: ["x"] }, "trustedDependencies"],
			[{ patchedDependencies: { "eve@0.67.2": "patches/eve.patch" } }, "patchedDependencies"],
			[{ imports: { "#*": "./elsewhere/*" } }, "imports"],
			[{ workspaces: ["x"] }, "workspaces"],
		];
		for (const [extra, key] of cases) {
			expect(packageFindings(base, pkg(extra)).map((x) => x.path)).toContain(`package.json ${key}`);
		}
	});

	test("a missing side reads as empty, never as no change", () => {
		expect(packageFindings(null, base).map((x) => x.path)).toEqual(["package.json name", "package.json scripts"]);
		expect(packageFindings(base, null)).toHaveLength(2);
		expect(packageFindings(null, null)).toEqual([]);
	});
});
