import { describe, expect, test } from "bun:test";
import {
	dependencyRangeFindings,
	lineFindings,
	MODEL_PATH,
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
		expect(rules("test/a.test.ts", j("test.", "todoIf", '(true)("x")'))).toContain("conditional-test");
		expect(rules("test/a.test.ts", j("test.", "skip", '.each([1])("x")'))).toContain("conditional-test");
		expect(rules("test/a.test.ts", j("test.", "each", "([])", '("x")'))).toContain("conditional-test");
		expect(rules("test/a.test.ts", j("test.", "each", "([1, 2])", '("x")'))).toEqual([]);
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

describe("source needs a test that imports it and asserts", () => {
	const files: Record<string, string> = {
		"test/provider.test.ts": 'import { resolveMode } from "../agent/lib/provider";',
		"test/other.test.ts": "// mentions provider and grant, imports neither",
		"test/surface.test.ts": "// eve info",
	};
	const read = (p: string) => files[p] ?? "";
	const assertion = (path: string) => ({ path, line: 1, text: "\texpect(x).toBe(1);" });
	const whitespace = (path: string) => ({ path, line: 1, text: "" });

	test("a changed test that imports the module and adds an assertion", () => {
		expect(
			untestedChangeFindings(
				[
					{ status: "M", path: "agent/lib/provider.ts" },
					{ status: "M", path: "test/provider.test.ts" },
				],
				read,
				[assertion("test/provider.test.ts")],
			),
		).toEqual([]);
	});

	test("a name mention, or an importing test touched without an assertion, does not count", () => {
		const mention = untestedChangeFindings(
			[
				{ status: "M", path: "agent/lib/provider.ts" },
				{ status: "M", path: "test/other.test.ts" },
			],
			read,
			[assertion("test/other.test.ts")],
		);
		expect(mention.map((x) => [x.rule, x.where])).toEqual([["source-without-test", "agent/lib/provider.ts"]]);
		const touched = untestedChangeFindings(
			[
				{ status: "M", path: "agent/lib/provider.ts" },
				{ status: "M", path: "test/provider.test.ts" },
			],
			read,
			[whitespace("test/provider.test.ts")],
		);
		expect(touched).toHaveLength(1);
	});

	test("each source file is judged on its own", () => {
		const f = untestedChangeFindings(
			[
				{ status: "M", path: "agent/lib/provider.ts" },
				{ status: "A", path: "scripts/lib/guard.ts" },
				{ status: "M", path: "test/provider.test.ts" },
			],
			read,
			[assertion("test/provider.test.ts")],
		);
		expect(f.map((x) => x.where)).toEqual(["scripts/lib/guard.ts"]);
	});

	test("agent files no test imports are covered by the surface test or an eval", () => {
		const tool = { status: "M" as const, path: "agent/tools/bash.ts" };
		expect(
			untestedChangeFindings([tool, { status: "M", path: "test/surface.test.ts" }], read, [
				assertion("test/surface.test.ts"),
			]),
		).toEqual([]);
		expect(
			untestedChangeFindings([tool, { status: "A", path: "evals/x.eval.ts" }], read, [
				{ path: "evals/x.eval.ts", line: 1, text: "t.usedNoTools();" },
			]),
		).toEqual([]);
		expect(untestedChangeFindings([tool], read, [])).toHaveLength(1);
		// scripts/lib has no such fallback
		expect(
			untestedChangeFindings(
				[
					{ status: "M", path: "scripts/lib/guard.ts" },
					{ status: "M", path: "test/surface.test.ts" },
				],
				read,
				[assertion("test/surface.test.ts")],
			),
		).toHaveLength(1);
	});

	test("docs, deletions and top-level CLIs are out of scope", () => {
		const changes = [
			{ status: "M" as const, path: "README.md" },
			{ status: "D" as const, path: "agent/lib/x.ts" },
			{ status: "M" as const, path: "scripts/doctor.ts" },
		];
		expect(untestedChangeFindings(changes, read, [])).toEqual([]);
	});
});

describe("PR body evidence", () => {
	const verdict = (n: number, of = n) => `\`\`\`\n$ bun run verify\nmutate: ${n}/${of} killed\n\`\`\``;
	const needs = { mutants: 22, modelPath: false };
	const rulesOf = (body: string, n = needs) => prBodyFindings(body, n).map((f) => f.rule);

	test("a visible Verification section quoting every mutant killed", () => {
		expect(rulesOf(`## Summary\nx\n\n## Verification\n${verdict(22)}\n`)).toEqual([]);
		expect(rulesOf(`## Verification\n${verdict(22)}\n\n## Notes\nx`)).toEqual([]);
	});

	test("missing, stub, partial, wrong-size or hidden evidence fails", () => {
		expect(rulesOf("## Summary\nx")).toEqual(["pr-verification"]);
		expect(rulesOf("## Verification\nthis is fake evidence long enough to pass a length check")).toEqual([
			"pr-verification",
		]);
		expect(rulesOf(`## Verification\n${verdict(21, 22)}`)).toEqual(["pr-verification"]);
		expect(rulesOf(`## Verification\n${verdict(0)}`)).toEqual(["pr-verification"]);
		expect(rulesOf(`## Verification\n${verdict(14)}`)).toEqual(["pr-verification"]);
		expect(rulesOf(`## Verification\nok\n\n## Notes\n${verdict(22)}`)).toEqual(["pr-verification"]);
		expect(rulesOf(`<!--\n## Verification\n${verdict(22)}\n-->`)).toEqual(["pr-verification"]);
		expect(rulesOf(`## Verification\n<!-- ${verdict(22)} -->\n`)).toEqual(["pr-verification"]);
		expect(rulesOf(`## Verification\n<!-- unterminated ${verdict(22)}`)).toEqual(["pr-verification"]);
	});

	test("a model-path change needs a live eval result or a stated reason", () => {
		const model = { mutants: 22, modelPath: true };
		const base = `## Verification\n${verdict(22)}\n`;
		expect(rulesOf(base, model)).toEqual(["pr-live-evidence"]);
		expect(rulesOf(`${base}Results: 2 passed (2 total)\n`, model)).toEqual([]);
		expect(rulesOf(`${base}Results: 1 passed (2 total)\n`, model)).toEqual(["pr-live-evidence"]);
		expect(rulesOf(`${base}Live eval not run: the grant is expired and D13 forbids refreshing it\n`, model)).toEqual(
			[],
		);
		expect(rulesOf(`${base}Live eval not run: no\n`, model)).toEqual(["pr-live-evidence"]);
		expect(rulesOf(`${base}<!-- Results: 2 passed (2 total) -->\n`, model)).toEqual(["pr-live-evidence"]);
	});

	test("which files are on the model path", () => {
		for (const p of ["agent/lib/provider.ts", "agent/tools/bash.ts", "evals/x.eval.ts", "package.json"]) {
			expect(MODEL_PATH.test(p)).toBe(true);
		}
		for (const p of ["scripts/lib/slop.ts", "test/x.test.ts", "README.md"]) expect(MODEL_PATH.test(p)).toBe(false);
	});
});
