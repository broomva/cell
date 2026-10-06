import { defineAgent } from "eve";
import { cellModel } from "./lib/provider";

// The root agent orchestrates; it never touches a repository. Every code change
// is a holon unit (S3), so the root has no shell, no files and no egress: see
// the disableTool() files under agent/tools/ and test/surface.test.ts.
export default defineAgent({
	model: cellModel("claude-opus-5"),
});
