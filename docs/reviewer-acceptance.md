# Reviewer acceptance

Factory tracks execution and review. Notion and Linear retain formal requirements and decisions;
T3 runs coding work. Kevin reviews every PR. Factory acceptance records that work was tested
and reviewed; it does not authorize a merge, release, or production deployment.

## Identities and authority

Coding credentials can report progress and completion but cannot accept work. Bitsy uses a
separate revocable reviewer credential. She can read all current and future Projects without
administrator permissions. Kevin explicitly assigns a Task or Subtask before she reviews it;
revoking the assignment removes her authority to submit another decision. Assigning a Task
allows review of its children. No review is assigned automatically.

Reviewer credentials cannot edit requirements, plan or implement work, submit coding progress
reports, manage credentials or service connections, or send T3 messages. Hardware checks and
judgment calls return to Kevin. Sending findings to coding threads and following fixes is a
future workflow; this implementation records the findings for handoff.

## Decisions and evidence

A reviewer submits a report describing what was tested, with an accepted, rejected, or deferred
decision and optional screenshot evidence. The server derives the reviewer name from the
authenticated identity. Caller-supplied names cannot impersonate Kevin, Bitsy, or PR Merge.
Review evidence remains attached to the report reviewed and survives subsequent reports.

Task acceptance uses the existing cascade to accept its children together. Current Task and
Subtask revisions, report IDs, and verification IDs guard against accepting work that changed
during review. A reviewer accepts existing completion reports; the coding agent remains
responsible for submitting them. A new completion report requires a new decision.

The history attribution is simply `accepted by Bitsy`, `accepted by Kevin`, or
`accepted by PR Merge`, followed by the review evidence. Screenshots are optional and must
belong to the reviewed work.

## PR merge acceptance

The server reads the GitHub PR explicitly linked to the Task or Subtask and uses confirmed
merge evidence, including the PR URL, merge time, and merge commit. A closed, unmerged PR,
missing token, access denial, or unavailable GitHub service never counts as acceptance.
Ordinary GitHub status queries remain read-only.

Reconciliation is idempotent and applies only to eligible current completion reports. It
preserves existing acceptance, rejection, and deferral decisions, does not restore archived
work, and does not use an earlier merge to approve later work. A child's different linked PR
is not covered by its parent's PR. Whole-Task reconciliation uses the parent cascade only
when its scope is eligible. Nothing in reconciliation writes to GitHub.

## Provisioning and assigning reviews

An operator provisions the credential on the Factory service host, using its database. The
command emits the token once; store it in Bitsy's own credential configuration rather than
in Codex's access-token file. No service deployment automatically provisions a reviewer.

```sh
factory credential create --machine-id bitsy-reviewer --role reviewer \
  --reviewer-name Bitsy --all-projects --database "$FACTORY_DB" --json
```

Existing credentials migrate to the coding role. Revoking and rotating Bitsy's credential
requires new assignments for the new credential identity. Revoking a Task assignment removes
inherited authority over its children; a separately assigned child keeps its own assignment.

The human dashboard uses these authenticated APIs:

| Operation                         | API                                                                       | Authority                                              |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| List configured reviewers         | `reviewers.list`                                                          | Kevin's human session                                  |
| Assign or revoke a Task review    | `tasks.assignReviewer`                                                    | Kevin's human session                                  |
| Assign or revoke a Subtask review | `subtasks.assignReviewer`                                                 | Kevin's human session                                  |
| Read a target's assignment        | `tasks.reviewerAssignment`, `subtasks.reviewerAssignment`                 | Authorized readers                                     |
| Record a Task review              | `tasks.review`                                                            | Assigned reviewer credential                           |
| Record a Subtask review           | `subtasks.review`                                                         | Assigned reviewer credential                           |
| Check a linked PR merge           | `tasks.reconcileMergedPullRequest`, `subtasks.reconcileMergedPullRequest` | Kevin's human session; server verifies GitHub evidence |

Assignment inputs include the target ID and `reviewerCredentialId`; a null credential ID
revokes the direct assignment. Reviewer names and credential IDs are exposed to the human
session without exposing tokens. Reviewer credentials cannot assign themselves.

For a Subtask decision, Bitsy retains the report ID and revision that she tested and submits
those values with her review. For example, using her separate remote credential:

```sh
factory subtask review --report-id REPORT_ID \
  --expected-revision REVISION --decision accepted \
  --report-text "Tested assignment, acceptance, and history in the preview." \
  --screenshot-ids SCREENSHOT_ID --json
```

The report ID identifies the Subtask being reviewed. Omit `--screenshot-ids` when no screenshot is needed. A rejected or deferred decision includes
its findings or blocker. The server rejects stale report IDs and revisions; testing an older
report cannot approve a newer completion claim.

For a whole-Task review, save the current Task status after testing and submit that pinned
snapshot. Do not fetch a newer snapshot merely to bypass a stale-review error.

```sh
factory task status --task-id T-123 --json > reviewed-task.json
factory task review --task-id T-123 --reviewed-snapshot reviewed-task.json \
  --decision accepted --report-text "Tested all active subtasks in the preview." --json
```

Kevin can use **Check merged PR** in the dashboard to request an explicit server check.
The server also checks eligible linked PRs every five minutes, reading at most eight distinct
PR URLs per pass. Both paths obtain merge evidence from GitHub; they never merge a PR.
