# Factory agent guidance

Factory's work records own execution scope, reports, and human verification. Linked Linear or Notion items remain the source for product requirements and decisions; reconcile conflicting scope rather than silently overriding it. Use `skills/software-factory/SKILL.md` for the reporting loop; read its CLI reference only for the operation needed. Preserve unrelated checkout changes and use the CLI for Factory metadata rather than direct database edits.

## Implementation model routing

For Claude and Codex, prefer a capable, low-cost model for implementation. When Astra, Sol, or Fable coordinates code or test work, default to Luna (`gpt-5.6-luna`) subagents at reasoning effort `xhigh`, including fixes, refactors, scripts, and existing tests. This is a cost-conscious default, not an exclusive model rule. All models supported by the active harness remain available for implementation, review, and other work. Choose another model when the user requests it or task fit, capability, availability, or efficiency warrants it; briefly explain meaningful departures without adding an approval checkpoint.

The coordinator owns scope, design, review, checks, integration, and delivery, and may edit documentation directly. Prefer bounded implementation assignments with explicit file ownership, constraints, and observable checks. Avoid recursive delegation of the same assignment. Use supported harness controls and verify the selected model/effort through resolved metadata or the authoritative selector contract. Honor explicit model requirements; never silently substitute for an exact user request. If the default is unavailable, choose another suitable supported model and disclose the choice.

Wait for the child result using the harness's supported lifecycle controls, then inspect its diff and check evidence. A dispatch handle proves neither completion nor success.

Delegation carries the user's existing scope and authorization; it does not grant extra authority to commit, publish, deploy, access data, or send messages. Continue through the requested implementation, relevant validation, and correction of failures without asking again for already-authorized steps. Stop when the agreed outcome is delivered or a concrete blocker requires user input.

## Validation and delivery

Use focused `bun test <path>` checks for changed behavior and the scripts in `package.json` for typecheck/build when their surfaces change. Instruction-only changes need reference/link checks, `git diff --check`, and the existing skill contract test (`bun test tests/cli/software-factory-skill.test.ts`). Do not run the entire application suite for prose changes alone.

Agent `complete` reports mean ready for human review, not human acceptance. Keep implementation, PR publication, deployment, and acceptance distinct. Do not deploy or change service configuration merely to install skill documentation.
