# Historical reviewer acceptance reference

The simplified workflow uses direct Steps, Task finish rules, PR reviews, and opt-in human
checks. The commands below describe retained compatibility APIs and historical evidence.
They are not required for routine Step or Task completion.

Coding agents keep their coding credential and submit progress and completion reports.
They must never borrow a reviewer credential or a human session to approve their work.

Bitsy uses a separately provisioned reviewer credential. An all-Projects credential can read
current and future Projects, but Kevin must explicitly assign a Task or Subtask before a
review decision or screenshot upload. Task assignments cover children unless a child has
its own assignment. Reviewer credentials cannot edit planning, submit coding reports,
administer Factory, or change T3 associations. Hardware checks and judgment calls return
to Kevin. This initial workflow does not dispatch coding follow-up automatically.

## Review what was tested

Use Bitsy's remote endpoint and her own credential file. Never reuse Codex's token file.
Read the formal requirements in the linked Notion or Linear item and inspect Factory's
execution reports. Test the current work before saving its reviewed snapshot.

For a Subtask, retain its report ID and revision from the Task status. The report ID identifies
the Subtask. Accept only a current complete report; rejection and deferral may record findings
on a current unfinished report.

```sh
factory subtask review --report-id REPORT_ID --expected-revision REVISION \
  --decision accepted --report-text "Tested the delivered behavior in the preview." \
  --screenshot-ids SCREENSHOT_ID --json
```

For a whole Task, capture the status that was tested and submit that pinned snapshot:

```sh
factory task status --task-id T-123 --json > reviewed-task.json
factory task review --task-id T-123 --reviewed-snapshot reviewed-task.json \
  --decision accepted --report-text "Tested every active Subtask in the preview." --json
```

The snapshot must contain every current Subtask, including archived rows. A truncated status
is insufficient; assemble a complete normalized snapshot from the bounded pages before
submitting. A stale revision, report ID, or verification ID fails closed. Test the changed work
again rather than fetching a newer snapshot merely to bypass the conflict.

Every decision requires a report describing what was tested or what failed. Use `rejected`
for failures and `deferred` for unresolved checks, with the findings in `--report-text`.
Screenshot IDs are optional and must belong to the reviewed Task or Subtask. Use the screenshot
commands in [the CLI reference](cli-and-maintenance.md) to attach proof. A child review can
reference its own proof or its parent's proof; whole-Task reviews can reference child proof.

Acceptance is attributed to Bitsy or Kevin and cascades from a parent to its children.
A new coding report requires another review. Kevin still reviews every PR; Factory acceptance
does not authorize merging, releasing, or deploying.

## PR merge acceptance

Factory also records `accepted by PR Merge` from GitHub-confirmed merge evidence for an
explicitly linked PR. Kevin can request **Check merged PR** in the dashboard; the server checks
linked PRs every five minutes, at most eight distinct URLs per pass. Ordinary GitHub status
queries remain read-only. Reconciliation preserves prior decisions and archived work, never
accepts unfinished reports, and cannot use an older merge for a newer report or a parent's PR
for a child with a different PR. It records the PR URL, merge commit, and merge time without
writing to GitHub.
