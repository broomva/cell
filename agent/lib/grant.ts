// D13: Claude Code is the one owner of credential refresh. holon refreshes a
// grant it resolves with under five minutes left and has no flag to stop, so
// the cell refuses to start any holon work whose worst-case duration would
// outlive the grant. The ceiling is computed from the three budget flags the
// cell passes explicitly on every factory start.

export interface Budget {
	/** --task-timeout, seconds per attempt */
	taskTimeout: number;
	/** --max-requeues */
	maxRequeues: number;
	/** --max-pause, seconds per pause */
	maxPause: number;
}

/** Margin on top of the ceiling: holon's own refresh window is 5 minutes. */
export const MARGIN_SECONDS = 10 * 60;

/** Worst case: every attempt runs to its timeout and every re-queue pauses the maximum. */
export function runCeilingSeconds(b: Budget): number {
	for (const [k, v] of Object.entries(b)) {
		if (!Number.isInteger(v) || v < 0) throw new Error(`cell: budget ${k} must be a non-negative integer, got ${v}`);
	}
	return b.taskTimeout * (b.maxRequeues + 1) + b.maxPause * b.maxRequeues;
}

/** The three flags, in the fixed order every spawn passes them. */
export function budgetArgv(b: Budget): string[] {
	runCeilingSeconds(b);
	return [
		"--task-timeout",
		String(b.taskTimeout),
		"--max-requeues",
		String(b.maxRequeues),
		"--max-pause",
		String(b.maxPause),
	];
}

/** Parse the `expires` line of `holon auth status`. Returns null when absent or unparseable. */
export function parseGrantExpiry(statusText: string): Date | null {
	const m = statusText.match(/^\s*expires\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z)/m);
	if (!m?.[1]) return null;
	const d = new Date(m[1]);
	return Number.isNaN(d.getTime()) ? null : d;
}

export type GrantVerdict =
	| { ok: true; remainingSeconds: number; ceilingSeconds: number }
	| { ok: false; reason: string };

export function checkGrant(statusText: string, budget: Budget, now: Date = new Date()): GrantVerdict {
	const ceilingSeconds = runCeilingSeconds(budget);
	const expiry = parseGrantExpiry(statusText);
	if (!expiry) {
		return {
			ok: false,
			reason: "cell: could not read the grant's expiry from `holon auth status`; refusing to start (fail closed).",
		};
	}
	const remainingSeconds = Math.floor((expiry.getTime() - now.getTime()) / 1000);
	const needed = ceilingSeconds + MARGIN_SECONDS;
	if (remainingSeconds < needed) {
		return {
			ok: false,
			reason: `cell: the grant has ${remainingSeconds}s left but this run may take ${ceilingSeconds}s (+${MARGIN_SECONDS}s margin); run any \`claude\` command so Claude Code refreshes it, then retry.`,
		};
	}
	return { ok: true, remainingSeconds, ceilingSeconds };
}

/** Reads the live status. The one place the check touches the machine; node APIs, since eve runs on Node 24. */
export async function checkLiveGrant(budget: Budget): Promise<GrantVerdict> {
	const { execFile } = await import("node:child_process");
	return new Promise((resolve) => {
		execFile("holon", ["auth", "status"], { timeout: 15_000 }, (err, stdout) => {
			if (err) resolve({ ok: false, reason: `cell: \`holon auth status\` failed: ${err.message}` });
			else resolve(checkGrant(stdout, budget));
		});
	});
}
