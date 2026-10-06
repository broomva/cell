import { describe, expect, test } from "bun:test";
import {
	applyWaivers,
	countMutants,
	coverageFindings,
	coverageFloor,
	deletedTestFindings,
	dependencyRangeFindings,
	lineFindings,
	mutantFindings,
	parseAddedLines,
	prBodyFindings,
	untestedChangeFindings,
	waivers,
} from "../scripts/lib/slop";

const rules = (path: string, text: string) => lineFindings([{ path, line: 1, text }]).map((f) => f.rule);

describe("parseAddedLines", () => {
	test("tracks file and new-side line numbers, ignores removals", () => {
		const diff = [
			"diff --git a/agent/x.ts b/agent/x.ts",
			"--- a/agent/x.ts",
			"+++ b/agent/x.ts",
			"@@ -3,0 +4,2 @@",
			"+one",
			"+two",
			"@@ -9 +11 @@",
			"-gone",
			"+three",
			"--- a/old.ts",
			"+++ /dev/null",
			"@@ -1 +0,0 @@",
			"-deleted",
		].join("\n");
		expect(parseAddedLines(diff)).toEqual([
			{ path: "agent/x.ts", line: 4, text: "one" },
			{ path: "agent/x.ts", line: 5, text: "two" },
			{ path: "agent/x.ts", line: 11, text: "three" },
		]);
	});
});

describe("line rules", () => {
	test("focused and skipped tests, only in test files", () => {
		expect(rules("test/a.test.ts", 'test.only("x", () => {})')).toContain("focused-or-skipped-test");
		expect(rules("test/a.test.ts", 'describe.skip("x", () => {})')).toContain("focused-or-skipped-test");
		expect(rules("evals/a.eval.ts", 'test.todo("x")')).toContain("focused-or-skipped-test");
		expect(rules("agent/a.ts", "list.only(")).not.toContain("focused-or-skipped-test");
	});

	test("type-checker suppression", () => {
		expect(rules("agent/a.ts", "// @ts-ignore")).toContain("ts-suppression");
		expect(rules("agent/a.ts", "// @ts-nocheck")).toContain("ts-suppression");
		expect(rules("agent/a.ts", "// @ts-expect-error")).toContain("ts-expect-error-no-reason");
		expect(rules("agent/a.ts", "// @ts-expect-error eve types lag the runtime")).toEqual([]);
	});

	test("explicit any", () => {
		expect(rules("agent/a.ts", "const x: any = 1;")).toContain("explicit-any");
		expect(rules("agent/a.ts", "foo as any;")).toContain("explicit-any");
		expect(rules("agent/a.ts", "new Map<any>();")).toContain("explicit-any");
		expect(rules("agent/a.ts", "const company = anything;")).toEqual([]);
	});

	test("console.log only in agent code", () => {
		expect(rules("agent/a.ts", 'console.log("x")')).toContain("console-log-in-agent");
		expect(rules("scripts/a.ts", 'console.log("x")')).toEqual([]);
	});

	test("TODO needs a ticket; markdown is exempt", () => {
		expect(rules("agent/a.ts", "// TODO fix later")).toContain("todo-without-ticket");
		expect(rules("agent/a.ts", "// TODO(BRO-2855) wire the spawn helper")).toEqual([]);
		expect(rules("agent/a.ts", "// FIXME see #12")).toEqual([]);
		expect(rules("README.md", "TODO list")).toEqual([]);
	});

	test("wrong linter and hook bypass", () => {
		expect(rules("agent/a.ts", "// eslint-disable-next-line")).toContain("wrong-linter");
		expect(rules(".github/workflows/x.yml", "git commit --no-verify")).toContain("skip-hooks");
		expect(rules(".githooks/pre-push", "git push --no-verify")).toContain("skip-hooks");
		expect(rules("CONTRIBUTING.md", "never use `--no-verify`")).toEqual([]);
	});

	test("the rules file and its fixtures are exempt", () => {
		expect(rules("scripts/lib/slop.ts", "bad: /<any>/")).toEqual([]);
		expect(rules("test/slop.test.ts", 'test.only("x")')).toEqual([]);
	});
});

describe("dependency ranges", () => {
	test("exact pins pass, ranges fail", () => {
		const ok = JSON.stringify({ dependencies: { a: "1.2.3" }, overrides: { u: "8.11.2" } });
		expect(dependencyRangeFindings(ok)).toEqual([]);
		for (const v of ["^1.2.3", "~1.2.3", "*", "latest", ">=1", "1 || 2", "x"]) {
			const bad = JSON.stringify({ devDependencies: { a: v } });
			expect(dependencyRangeFindings(bad).map((f) => f.rule)).toEqual(["dependency-range"]);
		}
	});
});

describe("file rules", () => {
	test("source without a test", () => {
		expect(untestedChangeFindings([{ status: "M", path: "agent/lib/x.ts" }]).map((f) => f.rule)).toEqual([
			"source-without-test",
		]);
		expect(
			untestedChangeFindings([
				{ status: "M", path: "agent/lib/x.ts" },
				{ status: "A", path: "test/x.test.ts" },
			]),
		).toEqual([]);
		expect(untestedChangeFindings([{ status: "M", path: "README.md" }])).toEqual([]);
		expect(untestedChangeFindings([{ status: "D", path: "agent/lib/x.ts" }])).toEqual([]);
	});

	test("deleted tests", () => {
		expect(deletedTestFindings([{ status: "D", path: "test/x.test.ts" }]).map((f) => f.rule)).toEqual(["test-deleted"]);
		expect(deletedTestFindings([{ status: "M", path: "test/x.test.ts" }])).toEqual([]);
	});
});

describe("coverage floor", () => {
	const at = (l: number, f: number) => `[test]\ncoverageThreshold = { lines = ${l}, functions = ${f} }\n`;
	test("reads the threshold", () => {
		expect(coverageFloor(at(0.95, 0.9))).toEqual([0.95, 0.9]);
		expect(coverageFloor("coverageThreshold = 0.8")).toEqual([0.8]);
		expect(coverageFloor("[test]\n")).toEqual([]);
	});
	test("may rise, may not fall or vanish", () => {
		expect(coverageFindings(at(0.9, 0.9), at(0.95, 0.9))).toEqual([]);
		expect(coverageFindings(null, at(0.9, 0.9))).toEqual([]);
		expect(coverageFindings(at(0.95, 0.95), at(0.9, 0.95)).map((f) => f.rule)).toEqual(["coverage-floor"]);
		expect(coverageFindings(at(0.95, 0.95), "[test]\n").map((f) => f.rule)).toEqual(["coverage-floor"]);
	});
});

describe("mutant catalogue size", () => {
	const cat = (n: number) => Array.from({ length: n }, (_, i) => `\t{\n\t\tid: "m${i}",\n\t},`).join("\n");
	test("may grow, may not shrink", () => {
		expect(countMutants(cat(3))).toBe(3);
		expect(mutantFindings(cat(3), cat(4))).toEqual([]);
		expect(mutantFindings(null, cat(1))).toEqual([]);
		expect(mutantFindings(cat(3), cat(2)).map((f) => f.rule)).toEqual(["mutant-removed"]);
	});
});

describe("PR body", () => {
	const evidence = "```\n$ bun run verify\nmutate: 14/14 killed\nslop: 0 finding(s)\n```";
	test("needs a Verification section with content", () => {
		expect(prBodyFindings(`## Summary\nx\n\n## Verification\n${evidence}\n`)).toEqual([]);
		expect(prBodyFindings(`## Verification\n${evidence}\n\n## Notes\nx`)).toEqual([]);
		expect(prBodyFindings("## Summary\nx").map((f) => f.rule)).toEqual(["pr-verification"]);
		expect(prBodyFindings("## Verification\n<!-- paste the output of bun run verify -->\n\n## Notes\nx")).toHaveLength(
			1,
		);
		expect(prBodyFindings("## Verification\nok\n")).toHaveLength(1);
	});

	test("waivers need a rule and a reason, and never waive the evidence", () => {
		const body = [
			"Slop-waiver: test-deleted — the suite moved into surface.test.ts wholesale",
			"Slop-waiver: explicit-any — no",
			"Slop-waiver: pr-verification — trust me on this one please",
		].join("\n");
		const w = waivers(body);
		expect([...w].sort()).toEqual(["pr-verification", "test-deleted"]);
		const { kept, waived } = applyWaivers(
			[
				{ rule: "test-deleted", where: "a", detail: "" },
				{ rule: "explicit-any", where: "b", detail: "" },
				{ rule: "pr-verification", where: "c", detail: "" },
			],
			w,
		);
		expect(kept.map((f) => f.rule)).toEqual(["explicit-any", "pr-verification"]);
		expect(waived.map((f) => f.rule)).toEqual(["test-deleted"]);
	});
});
