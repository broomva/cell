import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { commands, dequote, refusals } from "../scripts/lib/agent-gate";

const ids = (line: string) => refusals(line).map((r) => r.rule);

describe("agent gate refuses", () => {
	test("the admin bypass", () => {
		expect(ids("gh pr merge 3 --squash --admin")).toEqual(["admin-merge"]);
		expect(ids("gh pr merge 3 --squash --auto")).toEqual([]);
	});

	test("writes to rulesets, protection, collaborators, Actions permissions", () => {
		expect(ids("gh api -X PUT repos/broomva/cell/rulesets/1 --input r.json")).toEqual(["protection-write"]);
		expect(ids("gh api --method DELETE repos/o/r/branches/main/protection")).toEqual(["protection-write"]);
		expect(ids("gh api -X PUT repos/o/r/collaborators/bot")).toEqual(["protection-write"]);
		expect(ids("gh api -XPATCH repos/o/r/actions/permissions")).toEqual(["protection-write"]);
		expect(ids("gh api repos/broomva/cell/rulesets/1")).toEqual([]);
		expect(ids("gh api -X POST repos/o/r/issues")).toEqual([]);
	});

	test("force pushes and pushes to main", () => {
		expect(ids("git push --force origin feat/x")).toEqual(["force-push"]);
		expect(ids("git push -f origin feat/x")).toEqual(["force-push"]);
		expect(ids("git push origin +feat/x")).toEqual(["force-push"]);
		expect(ids("git push --force-with-lease origin feat/x")).toEqual(["force-push"]);
		expect(ids("git push origin main")).toEqual(["push-main"]);
		expect(ids("git push origin HEAD:main")).toEqual(["push-main"]);
		expect(ids("git push -u origin feat/main-menu")).toEqual([]);
	});

	test("hook bypass and hook-path changes", () => {
		const flag = ["--no", "verify"].join("-");
		expect(ids(`git commit ${flag} -m x`)).toEqual(["skip-hooks"]);
		expect(ids("git config core.hooksPath /dev/null")).toEqual(["hooks-path"]);
		expect(ids("git config --unset core.hooksPath")).toEqual(["hooks-path"]);
		expect(ids("git config core.hooksPath .githooks")).toEqual([]);
		expect(ids("git config core.hooksPath")).toEqual([]);
	});

	test("visibility and deletion", () => {
		expect(ids("gh repo edit broomva/cell --visibility public")).toEqual(["visibility"]);
		expect(ids("gh repo delete broomva/cell --yes")).toEqual(["visibility"]);
		expect(ids("gh repo view broomva/cell")).toEqual([]);
	});

	test("quote-split and escaped spellings", () => {
		expect(ids('gh pr merge 1 --adm""in')).toEqual(["admin-merge"]);
		expect(ids("git push origin m'a'in")).toEqual(["push-main"]);
		expect(ids('git push --forc""e origin feat/x')).toEqual(["force-push"]);
		expect(ids('git push origin "main"')).toEqual(["push-main"]);
		expect(ids("git push origin \\main")).toEqual(["push-main"]);
		expect(dequote(`a"b"'c'\\d$'e'`)).toBe("abcde");
	});

	test("other write spellings: --method=, fields, graphql mutations, the merge and refs endpoints", () => {
		expect(ids("gh api --method=PATCH repos/o/r/rulesets/1")).toEqual(["protection-write"]);
		expect(ids("gh api -XPUT repos/o/r/rulesets/1")).toEqual(["protection-write"]);
		expect(ids("gh api repos/o/r/rulesets -f name=x")).toEqual(["protection-write"]);
		expect(ids("gh api repos/o/r/rulesets --input r.json")).toEqual(["protection-write"]);
		expect(ids("gh api -X PUT repos/o/r/pulls/1/merge")).toEqual(["protection-write"]);
		expect(ids("gh api repos/o/r/git/refs/heads/main -X PATCH -F force=true")).toEqual(["protection-write"]);
		expect(ids("gh api repos/o/r/contents/.github/workflows/ci.yml -X PUT -f branch=main")).toEqual([
			"protection-write",
		]);
		expect(ids("gh api graphql -f query='mutation{updateRepositoryRuleset(input:{}){x}}'")).toEqual([
			"protection-write",
		]);
		expect(ids("gh api graphql -f query='query{viewer{login}}'")).toEqual([]);
		expect(ids("gh api repos/o/r/pulls/1/files --paginate")).toEqual([]);
	});

	test("one-shot hook bypasses and the raw token", () => {
		expect(ids("git -c core.hooksPath=/dev/null commit -m x")).toEqual(["hooks-path"]);
		expect(ids("git commit -n -m x")).toEqual(["skip-hooks"]);
		expect(ids("git commit -am x")).toEqual([]);
		expect(ids('curl -H "Authorization: token $(gh auth token)" https://api.github.com')).toContain("raw-token");
		expect(ids("echo $GH_TOKEN")).toEqual(["raw-token"]);
	});

	test("a refused command hidden behind a separator", () => {
		expect(ids("echo hi && gh pr merge 3 --admin")).toEqual(["admin-merge"]);
		expect(ids("echo $(gh pr merge 3 --admin)")).toEqual(["admin-merge"]);
		expect(commands("a; b | c && d\ne")).toEqual(["a", "b", "c", "d", "e"]);
	});
});

describe("agent gate hook", () => {
	const hook = join(import.meta.dir, "../scripts/agent-pretool-gate.ts");
	const run = (stdin: string) => {
		const p = Bun.spawnSync(["bun", hook], { stdin: new TextEncoder().encode(stdin), stderr: "pipe" });
		return { code: p.exitCode, err: new TextDecoder().decode(p.stderr) };
	};

	test("blocks with exit 2 and says why", () => {
		const r = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "gh pr merge 1 --admin" } }));
		expect(r.code).toBe(2);
		expect(r.err).toContain("admin-merge");
	});

	test("allows an ordinary command and other tools", () => {
		expect(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "bun run verify" } })).code).toBe(0);
		expect(run(JSON.stringify({ tool_name: "Edit", tool_input: {} })).code).toBe(0);
	});

	test("fails closed on input it cannot read", () => {
		expect(run("not json").code).toBe(2);
		expect(run(JSON.stringify({ tool_name: "Bash", tool_input: {} })).code).toBe(2);
	});
});
