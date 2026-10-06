// The mutation gate's catalogue. Each mutant is one deliberate bug in a line
// that carries a boundary of the design; `bun run mutate` applies each in a
// scratch copy and fails unless the test suite catches every one. A mutant
// whose `find` no longer matches exactly once fails the gate too, so a refactor
// cannot silently retire a mutant: it must be rewritten or removed in the
// same PR (and the slop gate flags a shrinking catalogue).

export interface Mutant {
	id: string;
	file: string;
	find: string;
	replace: string;
	/** What would break, in one line. */
	why: string;
}

export const MUTANTS: Mutant[] = [
	{
		id: "provider-any-host",
		file: "agent/lib/provider.ts",
		find: "!LOOPBACK_HOSTS.has(url.hostname)",
		replace: "false",
		why: "the sidecar base URL could point off this machine",
	},
	{
		id: "provider-mixed-modes",
		file: "agent/lib/provider.ts",
		find: 'if (apiKey.startsWith("sk-ant-")) {',
		replace: "if (false) {",
		why: "a real credential could ride alongside the sidecar",
	},
	{
		id: "provider-api-any-key",
		file: "agent/lib/provider.ts",
		find: 'if (!apiKey.startsWith("sk-ant-api")) {',
		replace: "if (false) {",
		why: "api mode would accept a sidecar key and call out",
	},
	{
		id: "grant-ceiling-pause",
		file: "agent/lib/grant.ts",
		find: "b.maxPause * b.maxRequeues",
		replace: "b.maxPause",
		why: "the run ceiling would undercount pauses",
	},
	{
		id: "grant-no-margin",
		file: "agent/lib/grant.ts",
		find: "const needed = ceilingSeconds + MARGIN_SECONDS;",
		replace: "const needed = ceilingSeconds;",
		why: "holon could refresh the grant inside its own five-minute window",
	},
	{
		id: "grant-boundary",
		file: "agent/lib/grant.ts",
		find: "if (remainingSeconds < needed) {",
		replace: "if (remainingSeconds <= needed) {",
		why: "the boundary of the refusal moves",
	},
	{
		id: "grant-fail-open",
		file: "agent/lib/grant.ts",
		find: "if (!expiry) {",
		replace: "if (false) {",
		why: "an unreadable status would start a run",
	},
	{
		id: "grant-negative-budget",
		file: "agent/lib/grant.ts",
		find: "v < 0)",
		replace: "v < -1)",
		why: "a negative budget flag would reach holon",
	},
	{
		id: "surface-web-fetch-enabled",
		file: "agent/tools/web_fetch.ts",
		find: "export default disableTool();",
		replace: 'export { default } from "eve/tools/web_fetch";',
		why: "the root would get egress",
	},
	{
		id: "surface-bash-enabled",
		file: "agent/tools/bash.ts",
		find: "export default disableTool();",
		replace: 'export { default } from "eve/tools/bash";',
		why: "the root would get a shell",
	},
	{
		id: "surfaces-empty-matcher",
		file: "scripts/lib/surfaces.ts",
		find: "m.hooks.length > 0",
		replace: "m.hooks.length >= 0",
		why: "an empty hook list would count as a gate",
	},
	{
		id: "slop-focused-test",
		file: "scripts/lib/slop.ts",
		find: "/\\.(only|skip|todo)\\(/",
		replace: "/\\.(never)\\(/",
		why: "a focused or skipped test would pass review",
	},
	{
		id: "slop-dependency-range",
		file: "scripts/lib/slop.ts",
		find: "/^[\\^~*]|^latest$|^x$/",
		replace: "/^never$/",
		why: "a floating dependency range would land",
	},
	{
		id: "slop-verification-section",
		file: "scripts/lib/slop.ts",
		find: "if (!verification) {",
		replace: "if (false) {",
		why: "a PR could land with no evidence",
	},
];

/** Apply a mutant to source text; throws unless `find` matches exactly once. */
export function applyMutant(source: string, m: Mutant): string {
	const first = source.indexOf(m.find);
	if (first === -1) throw new Error(`mutant ${m.id}: find string not in ${m.file}`);
	if (source.indexOf(m.find, first + 1) !== -1) throw new Error(`mutant ${m.id}: find string matches more than once`);
	return source.slice(0, first) + m.replace + source.slice(first + m.find.length);
}
