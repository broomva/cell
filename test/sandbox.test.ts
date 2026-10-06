import { expect, test } from "bun:test";
import sandbox, { environment } from "../agent/sandbox/sandbox";

// The root never drives a sandbox, so it is pinned to the pure-JS one: no
// container, no VM, no native process. DefaultSandbox would pick Docker or
// microsandbox on whatever host this runs.
test("the sandbox is just-bash", () => {
	expect(environment.provider).toBe("just-bash");
});

test("the selector opens that environment (eve refuses outside its runtime)", async () => {
	const select = sandbox as unknown as (ctx: unknown) => Promise<unknown>;
	await expect(select({ session: { id: "t" } })).rejects.toThrow(/only open sandboxes inside defineSandbox/);
});
