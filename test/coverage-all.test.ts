import { expect, test } from "bun:test";
import { join } from "node:path";
import { Glob } from "bun";

// Bun measures coverage only for files a test loads, so a new module that no
// test imports would be invisible to the floor in bunfig.toml. Loading every
// module under agent/ and scripts/lib/ here puts each one in the coverage
// table, where an untested file shows its real (low) numbers. Two exclusions:
// agent/agent.ts builds its model from the real environment at import (the
// surface test compiles it through eve instead), and top-level scripts/*.ts
// are CLIs with side effects whose logic lives in scripts/lib.
const ROOT = join(import.meta.dir, "..");
const EXCLUDED = new Set(["agent/agent.ts"]);

test("every module loads", async () => {
	const modules = ["agent", "scripts/lib"]
		.flatMap((d) => [...new Glob(`${d}/**/*.ts`).scanSync(ROOT)])
		.filter((m) => !EXCLUDED.has(m));
	expect(modules.length).toBeGreaterThan(0);
	for (const m of modules) await import(join(ROOT, m));
});
