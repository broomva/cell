#!/usr/bin/env bun
export {};

// Claude Code PreToolUse hook for Bash. Exit 2 blocks the call and returns
// stderr to the agent. Only exit 2 blocks, so every failure path here exits
// 2: unreadable input, a module that fails to load, any exception. The
// settings entry adds `|| exit 2` for a missing bun. A speed bump, not a
// boundary: see scripts/lib/agent-gate.ts.
try {
	const { refusals } = await import("./lib/agent-gate");
	const input = JSON.parse(await new Response(Bun.stdin.stream()).text()) as {
		tool_name?: string;
		tool_input?: { command?: unknown };
	};
	if (input.tool_name !== "Bash") process.exit(0);
	if (typeof input.tool_input?.command !== "string") throw new Error("no command");
	const found = refusals(input.tool_input.command);
	if (found.length > 0) {
		for (const r of found) console.error(`cell agent gate [${r.rule}]: ${r.why}`);
		console.error("If a human needs this done, say so in your handback; do not work around the gate.");
		process.exit(2);
	}
} catch (e) {
	console.error(`cell agent gate: ${(e as Error).message}; refusing`);
	process.exit(2);
}
