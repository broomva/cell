import { describe, expect, test } from "bun:test";
import {
	dependencyRangeFindings,
	lineFindings,
	parseAddedLines,
	prBodyFindings,
	untestedChangeFindings,
} from "../scripts/lib/slop";

// Fixtures are assembled from fragments: this file is not exempt from the
// slop gate, so it must not spell out the patterns it tests.
const j = (...parts: string[]) => parts.join("");
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
			"diff --git a/old.ts b/old.ts",
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

	test("an added line that starts with ++ is content, not a file header", () => {
		const diff = ["--- a/agent/x.ts", "+++ b/agent/x.ts", "@@ -0,0 +1,2 @@", "+++ fake", "+second"].join("\n");
		expect(parseAddedLines(diff)).toEqual([
			{ path: "agent/x.ts", line: 1, text: "++ fake" },
			{ path: "agent/x.ts", line: 2, text: "second" },
		]);
	});

	test("context lines advance the line number", () => {
		const diff = ["+++ b/a.ts", "@@ -1,2 +1,3 @@", " keep", "+new", " keep"].join("\n");
		expect(parseAddedLines(diff)).toEqual([{ path: "a.ts", line: 2, text: "new" }]);
	});
});

describe("line rules", () => {
	test("tests that switch themselves off", () => {
		for (const m of ["todo", "skipIf", "if", "failing"]) {
			expect(rules("test/a.test.ts", j("test.", m, '("x")'))).toContain("conditional-test");
		}
		expect(rules("evals/a.eval.ts", j("test.", "todo", '("x")'))).toContain("conditional-test");
		expect(rules("agent/a.ts", j("list.", "if", "(")).length).toBe(0);
	});

	test("type-checker suppression Biome does not catch", () => {
		expect(rules("agent/a.ts", j("// @ts-", "nocheck"))).toContain("ts-nocheck");
		expect(rules("agent/a.ts", j("// @ts-", "expect-error"))).toContain("ts-expect-error-no-reason");
		expect(rules("agent/a.ts", j("// @ts-", "expect-error eve types lag the runtime"))).toEqual([]);
	});

	test("a to-do comment names its ticket; markdown is exempt", () => {
		expect(rules("agent/a.ts", j("// TO", "DO fix later"))).toContain("todo-without-ticket");
		expect(rules("agent/a.ts", j("// TO", "DO(BRO-2855) wire the spawn helper"))).toEqual([]);
		expect(rules("agent/a.ts", j("// FIX", "ME see #12"))).toEqual([]);
		expect(rules("README.md", j("TO", "DO list"))).toEqual([]);
	});

	test("hook bypass in code and workflows, not in prose", () => {
		const flag = j("--no-", "verify");
		expect(rules(".github/workflows/x.yml", `git commit ${flag}`)).toContain("skip-hooks");
		expect(rules(".githooks/pre-push", `git push ${flag}`)).toContain("skip-hooks");
		expect(rules("CONTRIBUTING.md", `never use \`${flag}\``)).toEqual([]);
	});

	test("only the rules file itself is exempt", () => {
		expect(rules("scripts/lib/slop.ts", j("// TO", "DO x"))).toEqual([]);
		expect(rules("test/slop.test.ts", j("// TO", "DO x"))).toContain("todo-without-ticket");
	});
});

describe("dependency pins", () => {
	test("exact versions pass", () => {
		const ok = JSON.stringify({
			dependencies: { a: "1.2.3", b: "1.0.0-rc.1" },
			overrides: { u: "8.11.2" },
			peerDependencies: { p: "2.0.0" },
		});
		expect(dependencyRangeFindings(ok)).toEqual([]);
	});

	test("anything else fails, in every section", () => {
		const bad = ["^1.2.3", "~1.2.3", "*", "latest", ">=1", "1 || 2", "x", "1", "1.2", "1.x", "1.2.*", ""];
		for (const v of [...bad, "npm:zod@^4", "github:a/b", "workspace:*"]) {
			for (const section of ["dependencies", "devDependencies", "peerDependencies", "overrides", "resolutions"]) {
				const pkg = JSON.stringify({ [section]: { a: v } });
				expect(dependencyRangeFindings(pkg).map((f) => f.rule)).toEqual(["dependency-range"]);
			}
		}
		expect(dependencyRangeFindings(JSON.stringify({ dependencies: { a: 1 } }))).toHaveLength(1);
		expect(dependencyRangeFindings(JSON.stringify({ dependencies: "nope" }))).toHaveLength(1);
	});
});

describe("source needs a test that names it", () => {
	const files: Record<string, string> = {
		"test/provider.test.ts": 'import { resolveMode } from "../agent/lib/provider";',
		"test/other.test.ts": "// unrelated whitespace",
	};
	const read = (p: string) => files[p] ?? "";

	test("a changed test that names the module", () => {
		expect(
			untestedChangeFindings(
				[
					{ status: "M", path: "agent/lib/provider.ts" },
					{ status: "M", path: "test/provider.test.ts" },
				],
				read,
			),
		).toEqual([]);
	});

	test("an unrelated test edit does not count", () => {
		const f = untestedChangeFindings(
			[
				{ status: "M", path: "agent/lib/provider.ts" },
				{ status: "M", path: "test/other.test.ts" },
			],
			read,
		);
		expect(f.map((x) => [x.rule, x.where])).toEqual([["source-without-test", "agent/lib/provider.ts"]]);
	});

	test("each source file is judged on its own", () => {
		const f = untestedChangeFindings(
			[
				{ status: "M", path: "agent/lib/provider.ts" },
				{ status: "A", path: "scripts/lib/guard.ts" },
				{ status: "M", path: "test/provider.test.ts" },
			],
			read,
		);
		expect(f.map((x) => x.where)).toEqual(["scripts/lib/guard.ts"]);
	});

	test("docs, deletions and top-level CLIs are out of scope", () => {
		const changes = [
			{ status: "M" as const, path: "README.md" },
			{ status: "D" as const, path: "agent/lib/x.ts" },
			{ status: "M" as const, path: "scripts/doctor.ts" },
		];
		expect(untestedChangeFindings(changes, read)).toEqual([]);
	});
});

describe("PR body evidence", () => {
	const verdict = "```\n$ bun run verify\nmutate: 22/22 killed\nslop: 0 finding(s)\n```";

	test("a visible Verification section quoting a full kill", () => {
		expect(prBodyFindings(`## Summary\nx\n\n## Verification\n${verdict}\n`)).toEqual([]);
		expect(prBodyFindings(`## Verification\n${verdict}\n\n## Notes\nx`)).toEqual([]);
	});

	test("missing, stub, partial or hidden evidence fails", () => {
		expect(prBodyFindings("## Summary\nx")).toHaveLength(1);
		expect(prBodyFindings("## Verification\nthis is fake evidence long enough to pass a length check")).toHaveLength(1);
		expect(prBodyFindings("## Verification\nmutate: 21/22 killed\n")).toHaveLength(1);
		expect(prBodyFindings(`## Verification\nok\n\n## Notes\n${verdict}`)).toHaveLength(1);
		expect(prBodyFindings(`<!--\n## Verification\n${verdict}\n-->`)).toHaveLength(1);
		expect(prBodyFindings(`## Verification\n<!-- ${verdict} -->\n`)).toHaveLength(1);
		expect(prBodyFindings(`## Verification\n<!-- unterminated ${verdict}`)).toHaveLength(1);
	});
});
