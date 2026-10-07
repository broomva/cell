import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
	description: "One exact-string turn reaches Opus through holon sidecar.",
	tags: ["live"],
	timeoutMs: 120_000,
	async test(t) {
		const turn = await t.send("Reply with exactly this token and nothing else: CELL-SUBSTRATE-OK");
		t.succeeded();
		t.usedNoTools();
		t.check(turn.message, includes("CELL-SUBSTRATE-OK"));
	},
});
