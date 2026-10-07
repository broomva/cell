import { defineEvalConfig } from "eve/evals";

// Deterministic only: no judge, so a substrate fault reads as a substrate fault
// and not as a gateway or judge fault. Every eval here is tagged `live` and runs
// through `holon sidecar` on the subscription; CI runs none of them.
export default defineEvalConfig({
	maxConcurrency: 1,
});
