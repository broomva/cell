## Summary

<!-- What changed and why, in two or three sentences. Name the slice (S1–S6) and the ticket. -->

## Verification

<!--
Required: CI's slop gate fails a PR whose Verification section is empty.
Paste the tail of `bun run verify` (check · audit · build · mutate · slop),
plus the live evidence for anything that touches the model path:
`bun run doctor` and `bun run eval` output. Say what you did NOT run.
-->

## Risk

<!-- Which boundary does this touch: provider, tool surface, grant check, a gate? What would break? -->

<!--
A slop rule can be waived only here, one line each, with a reason a reviewer can judge:
Slop-waiver: <rule-id> — <reason>
The Verification section cannot be waived.
-->
