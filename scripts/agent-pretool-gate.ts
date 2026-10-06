#!/usr/bin/env bun
// Claude Code PreToolUse hook for Bash. Exit 2 blocks the call and returns
// stderr to the agent; anything unparseable is blocked too (fail closed).
import { refusals } from "./lib/agent-gate";

let command = "";
try {
	const input = JSON.parse(await new Response(Bun.stdin.stream()).text()) as {
		tool_name?: string;
		tool_input?: { command?: unknown };
	};
	if (input.tool_name !== "Bash") process.exit(0);
	if (typeof input.tool_input?.command !== "string") throw new Error("no command");
	command = input.tool_input.command;
} catch (e) {
	console.error(`cell agent gate: could not read the tool call (${(e as Error).message}); refusing`);
	process.exit(2);
}

const found = refusals(command);
if (found.length > 0) {
	for (const r of found) console.error(`cell agent gate [${r.rule}]: ${r.why}`);
	console.error("If a human needs this done, say so in your handback; do not work around the gate.");
	process.exit(2);
}
