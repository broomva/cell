import { describe, expect, test } from "bun:test";
import { budgetArgv, checkGrant, MARGIN_SECONDS, parseGrantExpiry, runCeilingSeconds } from "../agent/lib/grant";

// Shape of `holon auth status` on holon 0.1.0 (token redacted).
const STATUS = `holon · auth status
==========================================================
  active source   Claude Code credentials (~/.claude/.credentials.json or Keychain)
  kind            OAuth
  subscription    max
  expires         2026-10-06T04:18Z  (198m left)
  refresh token   PRESENT (~28 days left)
`;
const EXPIRY = new Date("2026-10-06T04:18:00Z");
const budget = { taskTimeout: 600, maxRequeues: 2, maxPause: 60 };

describe("D13 grant validity", () => {
	test("ceiling = timeout × (requeues + 1) + pause × requeues", () => {
		expect(runCeilingSeconds(budget)).toBe(600 * 3 + 60 * 2);
		expect(runCeilingSeconds({ taskTimeout: 10, maxRequeues: 0, maxPause: 3600 })).toBe(10);
	});

	test("budget flags are explicit, in a fixed order, and validated", () => {
		expect(budgetArgv(budget)).toEqual(["--task-timeout", "600", "--max-requeues", "2", "--max-pause", "60"]);
		expect(() => budgetArgv({ ...budget, maxPause: -1 })).toThrow();
		expect(() => budgetArgv({ ...budget, taskTimeout: 1.5 })).toThrow();
	});

	test("parses the expires line", () => {
		expect(parseGrantExpiry(STATUS)?.toISOString()).toBe(EXPIRY.toISOString());
		expect(parseGrantExpiry("kind OAuth\n")).toBeNull();
	});

	test("refuses when the grant would expire inside the run", () => {
		const needed = runCeilingSeconds(budget) + MARGIN_SECONDS;
		const justEnough = new Date(EXPIRY.getTime() - needed * 1000);
		const oneShort = new Date(justEnough.getTime() + 1000);
		expect(checkGrant(STATUS, budget, justEnough).ok).toBe(true);
		const v = checkGrant(STATUS, budget, oneShort);
		expect(v.ok).toBe(false);
		if (!v.ok) expect(v.reason).toMatch(/run any `claude` command/);
	});

	test("fails closed on an unreadable status", () => {
		const v = checkGrant("garbage", budget, new Date(0));
		expect(v.ok).toBe(false);
	});
});
