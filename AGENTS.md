# Factory agent guidance

Factory is pivoting to a Factory-owned issue tracker. The authoritative behavior is in
[the issue tracker plan](docs/issue-tracker-pivot.md). New issues start empty; preserve legacy
Tasks, Steps, reports, and backups as historical data, without importing them into Issues.

Factory observes T3 and GitHub activity. Agents do not report progress to Factory, install
`software-factory` reporting skills, or install SessionStart project-brief hooks. The retired
skill and hook sources remain historical compatibility code only. Do not follow their old
reporting loop for new issue work. Keep existing connections, credentials, backups, and
unrelated checkout changes intact.

## Implementation model routing

For Claude and Codex, prefer a capable, low-cost model for implementation. When Astra, Sol, or Fable coordinates code or test work, default to Luna (`gpt-5.6-luna`) subagents at reasoning effort `xhigh`, including fixes, refactors, scripts, and existing tests. This is a cost-conscious default, not an exclusive model rule. All models supported by the active harness remain available for implementation, review, and other work. Choose another model when the user requests it or task fit, capability, availability, or efficiency warrants it; briefly explain meaningful departures without adding an approval checkpoint.

The coordinator owns scope, design, review, checks, integration, and delivery, and may edit documentation directly. Prefer bounded implementation assignments with explicit file ownership, constraints, and observable checks. Avoid recursive delegation of the same assignment. Use supported harness controls and verify the selected model/effort through resolved metadata or the authoritative selector contract. Honor explicit model requirements; never silently substitute for an exact user request. If the default is unavailable, choose another suitable supported model and disclose the choice.

Wait for the child result using the harness's supported lifecycle controls, then inspect its diff and check evidence. A dispatch handle proves neither completion nor success.

Delegation carries the user's existing scope and authorization; it does not grant extra authority to commit, publish, deploy, access data, or send messages. Continue through the requested implementation, relevant validation, and correction of failures without asking again for already-authorized steps. Stop when the agreed outcome is delivered or a concrete blocker requires user input.

## Validation and delivery

Use focused `bun test <path>` checks for changed behavior and the scripts in `package.json` for typecheck/build when their surfaces change. Instruction-only changes need reference/link checks, `git diff --check`, and the existing skill contract test (`bun test tests/cli/software-factory-skill.test.ts`). Do not run the entire application suite for prose changes alone.

Agent `complete` reports mean ready for human review, not human acceptance. Keep implementation, PR publication, deployment, and acceptance distinct. Do not deploy or change service configuration merely to install skill documentation.
