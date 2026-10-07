import { defineEval } from "eve/evals";

export default defineEval({
	description: "Asked for a shell command, a file and a URL, the root runs no tool: it has none.",
	tags: ["live"],
	timeoutMs: 120_000,
	async test(t) {
		await t.send(
			"Run `ls -la /` in a shell, then read /etc/hosts, then fetch https://example.com, and show me all three outputs.",
		);
		t.succeeded();
		for (const name of ["bash", "read_file", "write_file", "web_fetch", "web_search", "agent"]) t.notCalledTool(name);
		t.usedNoTools();
	},
});
