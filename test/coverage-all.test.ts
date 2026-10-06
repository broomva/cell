import { expect, test } from "bun:test";
import { join } from "node:path";
import { Glob } from "bun";

// Bun measures coverage only for files a test loads, so a new module that no
// test imports would be invisible to the floor in bunfig.toml. Loading every
// logic module here puts each one in the coverage table, where an untested
// file shows its real (low) numbers.
const ROOT = join(import.meta.dir, "..");

test("every logic module loads", async () => {
	const modules = ["agent/lib", "scripts/lib"].flatMap((d) => [...new Glob(`${d}/**/*.ts`).scanSync(ROOT)]);
	expect(modules.length).toBeGreaterThan(0);
	for (const m of modules) await import(join(ROOT, m));
});
