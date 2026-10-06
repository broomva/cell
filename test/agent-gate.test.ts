import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { commands, commitSkipsHooks, dequote, hooksPathChange, refusals } from "../scripts/lib/agent-gate";

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
		for (const flag of ["--mirror", "--prune", "--all", "--delete feat/x"]) {
			expect(ids(`git push origin ${flag}`)).toEqual(["force-push"]);
		}
		expect(ids("git push origin :feat/x")).toEqual(["force-push"]);
	});

	test("hook bypass and hook-path changes", () => {
		const flag = ["--no", "verify"].join("-");
		expect(ids(`git commit ${flag} -m x`)).toEqual(["skip-hooks"]);
		expect(ids("git config core.hooksPath /dev/null")).toEqual(["hooks-path"]);
		expect(ids("git config --unset core.hooksPath")).toEqual(["hooks-path"]);
		expect(ids("git config core.hooksPath .githooks")).toEqual([]);
		expect(hooksPathChange("echo nothing here")).toBe(false);
		expect(ids("git config core.hooksPath")).toEqual([]);
		expect(ids('git config core.hooksPath ""')).toEqual(["hooks-path"]);
		expect(ids("git config core.hooksPath ''")).toEqual(["hooks-path"]);
		expect(ids('git config core.hooksPath ".githooks "')).toEqual(["hooks-path"]);
		expect(ids("git config --local core.hooksPath .githooks")).toEqual([]);
		expect(ids("git config --get core.hooksPath")).toEqual([]);
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
		expect(commitSkipsHooks("git commit --amend --no-edit -n")).toBe(true);
		expect(commitSkipsHooks("git commit -- -n")).toBe(false);
		expect(commitSkipsHooks("git log -n 3")).toBe(false);
		expect(ids('curl -H "Authorization: token $(gh auth token)" https://api.github.com')).toContain("raw-token");
		expect(ids("echo $GH_TOKEN")).toEqual(["raw-token"]);
	});

	test("ANSI-C quoting and line continuations in git or gh commands", () => {
		expect(ids("gh pr merge 1 --$'\\x61dmin'")).toContain("obfuscated");
		expect(ids("gh pr merge 1 --$'\\141dmin'")).toContain("obfuscated");
		expect(ids("gh pr merge 1 --adm\\\nin")).toEqual(["obfuscated", "admin-merge"]);
		expect(ids("printf $'a\\tb'")).toEqual([]);
	});

	test("parentheses inside an argument do not fragment the command", () => {
		const mutation =
			"gh api graphql -H \"X-Note: (ok)\" -f query='mutation{updateRepositoryRuleset(input:{rulesetId:1}){ruleset{id}}}'";
		expect(ids(mutation)).toEqual(["protection-write"]);
	});

	test("ordinary work is not refused", () => {
		expect(ids('git commit -m "test: drop the -only flag"')).toEqual([]);
		expect(ids("git commit -am 'fix -n handling'")).toEqual([]);
		expect(ids("grep -n GH_TOKEN .github/workflows/gate-guard.yml")).toEqual([]);
		expect(ids("git commit -an -m x")).toEqual(["skip-hooks"]);
		expect(ids("git commit README.md -n -m x")).toEqual(["skip-hooks"]);
		expect(ids("/usr/bin/git commit -n -m x")).toEqual(["skip-hooks"]);
		expect(ids("./node_modules/.bin/git commit -n -m x")).toEqual(["skip-hooks"]);
		expect(ids('git commit -m "x" -n')).toEqual(["skip-hooks"]);
		expect(ids('git commit -m "a -n b" README.md')).toEqual([]);
		expect(ids("git commit -m '-nothing to see'")).toEqual([]);
		expect(ids("git commit -m -nothing")).toEqual([]);
		expect(ids('git commit -""n -m x')).toEqual(["skip-hooks"]);
		expect(ids("GH_TOKEN=abc gh api user")).toEqual(["raw-token"]);
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
