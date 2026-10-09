# Software Factory Context

Software Factory is a standalone project-operations tool. It coordinates Projects, Tasks,
optional Steps, Tracker Links, reports, and explicit human checks without becoming a life OS or replacing the
systems that own their own data. Herdr-managed coding sessions are a later integration.

## Planning and tracking

**Project**:
A Factory coordination scope containing related tasks, repositories, tracker links, and
operational status. It may store a Git origin URL for associating coding checkouts with the
Project. It may represent work whose product roadmap remains owned elsewhere.
_Avoid_: workspace, account

**Task**:
A planned, independently trackable outcome within a Project. A Task can carry Factory-native
planning data, optional Steps, and Tracker Links. A Task may have an Archive State of `released` or
`wont_do`; archived Tasks remain addressable and historical but are omitted from Attention. A
Task may store a branch name for associating coding work with it; a branch name may contain an
external tracker identifier without changing that tracker.
_Avoid_: ticket, issue, work item

**Step** (stored as Subtask for compatibility):
An optional checklist item within a Task, with direct To do, Doing, Done, or Blocked status.
Steps retain their author order and report history. Finishing a Step needs no approval and
never completes or reopens its Task. Archive disposition applies only to that Step.

**Work State**:
A Task's workflow placement: `backlog`, `planned`, `active`, `awaiting_verification`
(displayed as In review), `blocked`, or `completed` (displayed as Done). Task completion
follows its finish rule, independently of Step counts.

**Finish Rule**:
Code Tasks finish when every required linked PR's merge commit reaches the repository's
default branch. Non-code Tasks can finish from an agent's Task-level finished report.
Either rule may explicitly require a human check. A human can mark a Task done with a
reason. Completion records its proof; deployment and release remain separate evidence.

**Archive State**:
A durable terminal disposition for a Task or Subtask: `released` means the work shipped, and
`wont_do` means the work was intentionally abandoned. Archived records remain visible in their
Project and history, but do not create Attention items.
_Avoid_: deletion, completed, hidden

**External Tracker**:
A system that remains authoritative for a linked product roadmap or development record, such
as Notion for Playlister or Linear for Grail.
_Avoid_: sync target, secondary database

**Tracker Link**:
A reference from a Factory Project or Task to an External Tracker record, retaining its system,
stable identifier, and canonical URL without copying or updating its record.
_Avoid_: mirror, replica

**Status Report**:
An append-only agent observation about a Task or Step, with attribution, time, and evidence.
Task reports work without Steps. A finished Task report satisfies an agent-report finish
rule, or leaves a code Task In review until its required merges and optional check occur.

**Human Check**:
An opt-in human confirmation after the Task's other finish conditions are met. An agent
or reviewer credential cannot perform it. Sending work back reopens the Task and invalidates
old completion evidence for the new work. Historical verifications retain their original
acceptance, rejection, deferral, and attribution; no new Step approvals are required.

## Execution and evidence

**Run**:
A durable Factory record of one execution attempt within a Project. It outlives its worker
processes and owns execution state, evidence, and attention requests; Work Associations identify
the Tasks or Subtasks the attempt contributes to.
_Avoid_: chat, session

**Code Session**:
A T3-observed or Herdr-managed Claude, Codex, or OpenCode session attached to a Run. It is
execution detail, not the Run's identity or completion evidence. Observing a running or completed
session never changes Work State or creates a Status Report. A Code Session may have zero, one,
or many Work Associations.
_Avoid_: run, task

**Work Association**:
A Factory-owned relationship between a Code Session and a Task or Subtask. Associations are
many-to-many metadata and do not imply progress, completion, or Verification.
_Avoid_: assignment, ownership, completion link

**External Observation**:
A bounded, freshness-stamped fact read from another system, such as T3 session state or GitHub
pull-request status. It may support Evidence or a reconciliation finding but is not Factory-owned
workflow state.
_Avoid_: sync, truth, completion

**Gate**:
A deterministic repository check whose observed command, revision, output, and exit result are
recorded by Factory.
_Avoid_: agent review, self-assessment

**Attention Request**:
A durable, actionable request for a human decision, credential, permission, review, or other
unblocker. It includes the reason and a resume path for its Run.
_Avoid_: blocked note, notification

**Evidence**:
An artifact or observed result supporting a Run's state, including a gate log, commit, pull
request, or worker transcript reference.
_Avoid_: summary
