# Factory context

Factory owns a simple issue tracker, with issue lists grouped by status, labels, GitHub PRs,
and T3 threads. See [the current plan](docs/issue-tracker-pivot.md).

New issues use a separate, initially empty store in the existing database. Existing Projects,
connections, and backups remain available. The former Task/Step/reporting model is historical;
it does not define the issue workflow and agents no longer report progress through a skill or
SessionStart hook.

The previous context is preserved in Git tag
`archive/factory-before-issue-tracker-pivot-2026-10-16`.
