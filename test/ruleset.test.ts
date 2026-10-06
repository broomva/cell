import { describe, expect, test } from "bun:test";
import { ACTIONS_APP_ID, rulesetGaps } from "../scripts/lib/ruleset";

const check = (context: string, integration_id: number = ACTIONS_APP_ID) => ({ context, integration_id });
const full = (checks = [check("gate"), check("gate-guard")]) => [
	{ type: "deletion" },
	{ type: "non_fast_forward" },
	{ type: "pull_request" },
	{ type: "required_status_checks", parameters: { required_status_checks: checks } },
];

describe("rulesetGaps", () => {
	test("the complete ruleset has no gaps", () => {
		expect(rulesetGaps(full())).toEqual([]);
	});

	test("a missing or unbound required check is a gap", () => {
		expect(rulesetGaps(full([check("gate")]))).toEqual(["gate-guard is not a required check"]);
		expect(rulesetGaps(full([check("gate"), check("gate-guard", 0)]))).toEqual([
			"gate-guard is not bound to the GitHub Actions app",
		]);
	});

	test("a missing rule is a gap", () => {
		expect(rulesetGaps(full().filter((r) => r.type !== "pull_request"))).toEqual(["no pull_request rule on main"]);
		expect(rulesetGaps([])).toHaveLength(6);
	});
});
