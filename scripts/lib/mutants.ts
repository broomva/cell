// The mutation gate's catalogue. Each mutant is one deliberate bug in a line
// that carries a boundary of the design. `bun run mutate` applies each in a
// scratch copy and runs only its `killedBy` test file, so a kill is
// attributable: that file, and nothing else, must fail. A mutant whose `find`
// no longer matches exactly once fails the gate too, so a refactor cannot
// silently retire a mutant. This file is held by the gate guard: shrinking
// the catalogue needs a human.

export interface Mutant {
	id: string;
	file: string;
	find: string;
	replace: string;
	/** The test file that must fail with this mutant applied. */
	killedBy: string;
	/** What would break, in one line. */
	why: string;
}

export const MUTANTS: Mutant[] = [
	{
		id: "provider-any-host",
		file: "agent/lib/provider.ts",
		find: "!LOOPBACK_HOSTS.has(url.hostname)",
		replace: "false",
		killedBy: "test/provider.test.ts",
		why: "the sidecar base URL could point off this machine",
	},
	{
		id: "provider-mixed-modes",
		file: "agent/lib/provider.ts",
		find: 'if (apiKey.startsWith("sk-ant-")) {',
		replace: "if (false) {",
		killedBy: "test/provider.test.ts",
		why: "a real credential could ride alongside the sidecar",
	},
	{
		id: "provider-api-any-key",
		file: "agent/lib/provider.ts",
		find: 'if (!apiKey.startsWith("sk-ant-api")) {',
		replace: "if (false) {",
		killedBy: "test/provider.test.ts",
		why: "api mode would accept a sidecar key and call out",
	},
	{
		id: "provider-api-base-from-env",
		file: "agent/lib/provider.ts",
		find: "createAnthropic({ apiKey: mode.apiKey, baseURL: ANTHROPIC_API_BASE })",
		replace: "createAnthropic({ apiKey: mode.apiKey })",
		killedBy: "test/provider.test.ts",
		why: "a stray ANTHROPIC_BASE_URL would receive the real API key",
	},
	{
		id: "grant-ceiling-pause",
		file: "agent/lib/grant.ts",
		find: "b.maxPause * b.maxRequeues",
		replace: "b.maxPause",
		killedBy: "test/grant.test.ts",
		why: "the run ceiling would undercount pauses",
	},
	{
		id: "grant-no-margin",
		file: "agent/lib/grant.ts",
		find: "const needed = ceilingSeconds + MARGIN_SECONDS;",
		replace: "const needed = ceilingSeconds;",
		killedBy: "test/grant.test.ts",
		why: "holon could refresh the grant inside its own five-minute window",
	},
	{
		id: "grant-boundary",
		file: "agent/lib/grant.ts",
		find: "if (remainingSeconds < needed) {",
		replace: "if (remainingSeconds <= needed) {",
		killedBy: "test/grant.test.ts",
		why: "the boundary of the refusal moves",
	},
	{
		id: "grant-fail-open",
		file: "agent/lib/grant.ts",
		find: "if (!expiry) {\n\t\treturn {\n\t\t\tok: false,",
		replace:
			"if (!expiry) {\n\t\treturn { ok: true, remainingSeconds: 1e9, ceilingSeconds };\n\t\treturn {\n\t\t\tok: false,",
		killedBy: "test/grant.test.ts",
		why: "an unreadable status would start a run",
	},
	{
		id: "grant-negative-budget",
		file: "agent/lib/grant.ts",
		find: "v < 0)",
		replace: "v < -1)",
		killedBy: "test/grant.test.ts",
		why: "a negative budget flag would reach holon",
	},
	{
		id: "surface-web-fetch-enabled",
		file: "agent/tools/web_fetch.ts",
		find: "export default disableTool();",
		replace: 'export { default } from "eve/tools/web_fetch";',
		killedBy: "test/surface.test.ts",
		why: "the root would get egress",
	},
	{
		id: "surface-bash-enabled",
		file: "agent/tools/bash.ts",
		find: "export default disableTool();",
		replace: 'export { default } from "eve/tools/bash";',
		killedBy: "test/surface.test.ts",
		why: "the root would get a shell",
	},
	{
		id: "sandbox-default",
		file: "agent/sandbox/sandbox.ts",
		find: 'import { JustBashSandbox } from "eve/sandbox/just-bash";',
		replace: 'import { DefaultSandbox as JustBashSandbox } from "eve/sandbox";',
		killedBy: "test/sandbox.test.ts",
		why: "the root would get whichever sandbox the host offers",
	},
	{
		id: "surfaces-trivial-hook",
		file: "scripts/lib/surfaces.ts",
		find: "!TRIVIAL.test(h.command)",
		replace: "true",
		killedBy: "test/surfaces.test.ts",
		why: "a hook that does nothing would count as a gate",
	},
	{
		id: "surfaces-any-matcher",
		file: "scripts/lib/surfaces.ts",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the find string is source text, not a template
		find: 'matchesBash = new RegExp(`^(?:${m})$`).test("Bash");',
		replace: "matchesBash = true;",
		killedBy: "test/surfaces.test.ts",
		why: "a hook on Edit alone would count as a Bash gate",
	},
	{
		id: "slop-conditional-test",
		file: "scripts/lib/slop.ts",
		find: "bad: /\\.(todo|skipIf|if|failing)\\(/,",
		replace: "bad: /\\.(never)\\(/,",
		killedBy: "test/slop.test.ts",
		why: "a test that switches itself off would pass review",
	},
	{
		id: "slop-dependency-range",
		file: "scripts/lib/slop.ts",
		find: 'if (typeof version !== "string" || !EXACT.test(version)) {',
		replace: 'if (typeof version !== "string" || version.startsWith("^")) {',
		killedBy: "test/slop.test.ts",
		why: "a floating dependency version other than ^ would land",
	},
	{
		id: "slop-untested-any-test",
		file: "scripts/lib/slop.ts",
		find: "if (!tests.some((t) => named.test(t))) {",
		replace: "if (tests.length === 0) {",
		killedBy: "test/slop.test.ts",
		why: "an unrelated test edit would excuse untested source",
	},
	{
		id: "slop-hunk-header",
		file: "scripts/lib/slop.ts",
		find: "if (oldLeft > 0 || newLeft > 0) {",
		replace: "if (false) {",
		killedBy: "test/slop.test.ts",
		why: "an added line starting with ++ would hide the rest of the file",
	},
	{
		id: "slop-verification-verdict",
		file: "scripts/lib/slop.ts",
		find: "if (!verdict || verdict[1] !== verdict[2]) {",
		replace: "if (false) {",
		killedBy: "test/slop.test.ts",
		why: "a PR could land without the mutation verdict",
	},
	{
		id: "slop-hidden-verification",
		file: "scripts/lib/slop.ts",
		find: 'const visible = body.replace(/<!--[\\s\\S]*?(-->|$)/g, "");',
		replace: "const visible = body;",
		killedBy: "test/slop.test.ts",
		why: "evidence hidden in an HTML comment would count",
	},
	{
		id: "guard-gate-files",
		file: "scripts/lib/guard.ts",
		find: "if (guarded) out.push",
		replace: "if (false) out.push",
		killedBy: "test/guard.test.ts",
		why: "a PR could edit the gates that judge it",
	},
	{
		id: "guard-test-moved-out",
		file: "scripts/lib/guard.ts",
		find: "TEST.test(f.previous_filename) && !TEST.test(f.filename)",
		replace: "false",
		killedBy: "test/guard.test.ts",
		why: "a test renamed out of the suite would vanish unseen",
	},
	{
		id: "guard-package-scripts",
		file: "scripts/lib/guard.ts",
		find: 'for (const key of ["scripts", "overrides"]) {',
		replace: 'for (const key of ["overrides"]) {',
		killedBy: "test/guard.test.ts",
		why: "a PR could rewrite `bun run test` to `true`",
	},
];

/** Apply a mutant to source text; throws unless `find` matches exactly once. */
export function applyMutant(source: string, m: Mutant): string {
	const first = source.indexOf(m.find);
	if (first === -1) throw new Error(`mutant ${m.id}: find string not in ${m.file}`);
	if (source.indexOf(m.find, first + 1) !== -1) throw new Error(`mutant ${m.id}: find string matches more than once`);
	return source.slice(0, first) + m.replace + source.slice(first + m.find.length);
}
