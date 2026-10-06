import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkLiveGrant } from "../agent/lib/grant";

// checkLiveGrant shells out to `holon auth status`; a fake holon on PATH pins
// both outcomes without touching the real credential.
const budget = { taskTimeout: 60, maxRequeues: 0, maxPause: 0 };
let dir = "";
const savedPath = process.env.PATH;

function fakeHolon(script: string) {
	const bin = join(dir, "holon");
	writeFileSync(bin, `#!/bin/sh\n${script}\n`);
	chmodSync(bin, 0o755);
}

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "cell-grant-"));
	process.env.PATH = `${dir}:${savedPath}`;
});
afterAll(() => {
	process.env.PATH = savedPath;
});

describe("checkLiveGrant", () => {
	test("reads the expiry holon prints", async () => {
		fakeHolon(`echo "  expires         2999-01-01T00:00Z  (lots left)"`);
		const v = await checkLiveGrant(budget);
		expect(v.ok).toBe(true);
	});

	test("fails closed when holon exits non-zero", async () => {
		fakeHolon("exit 3");
		const v = await checkLiveGrant(budget);
		expect(v.ok).toBe(false);
		if (!v.ok) expect(v.reason).toMatch(/holon auth status/);
	});
});
