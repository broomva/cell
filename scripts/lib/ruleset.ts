// What `main`'s ruleset must hold for the gates to mean anything. The doctor
// reads the live ruleset through the API and fails while any of it is missing.

export const ACTIONS_APP_ID = 15368;
export const REQUIRED_CHECKS = ["gate", "gate-guard"];

interface Rule {
	type: string;
	parameters?: { required_status_checks?: { context: string; integration_id?: number }[] };
}

export function rulesetGaps(rules: Rule[]): string[] {
	const gaps: string[] = [];
	const types = new Set(rules.map((r) => r.type));
	for (const t of ["pull_request", "non_fast_forward", "deletion", "required_status_checks"]) {
		if (!types.has(t)) gaps.push(`no ${t} rule on main`);
	}
	const checks = rules.flatMap((r) => r.parameters?.required_status_checks ?? []);
	for (const name of REQUIRED_CHECKS) {
		const c = checks.find((x) => x.context === name);
		if (!c) gaps.push(`${name} is not a required check`);
		else if (c.integration_id !== ACTIONS_APP_ID) gaps.push(`${name} is not bound to the GitHub Actions app`);
	}
	return gaps;
}
