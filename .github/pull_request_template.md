## Summary

<!-- What changed and why, in two or three sentences. Name the slice (S1–S6) and the ticket. -->

## Verification

<!--
Required: CI's slop gate fails a PR whose Verification section does not quote
`mutate: N/N killed`. Paste the tail of `bun run verify` (check · audit · build · mutate · slop),
plus, if agent/, evals/ or package.json changed, `bun run eval`'s `Results: N passed (N total)`
line, or a line `Live eval not run: <reason>`. Say what you did NOT run.
-->

## Risk

<!-- Which boundary does this touch: provider, tool surface, grant check, a gate? What would break? -->
