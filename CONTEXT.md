# Software Factory Context

Software Factory is a standalone project-operations tool. Its v1 coordinates Projects, Tasks,
Subtasks, Tracker Links, and human verification without becoming a life OS or replacing the
systems that own their own data. Herdr-managed coding sessions are a later integration.

## Planning and tracking

**Project**:
A Factory coordination scope containing related tasks, repositories, tracker links, and
operational status. It may store a Git origin URL for associating coding checkouts with the
Project. It may represent work whose product roadmap remains owned elsewhere.
_Avoid_: workspace, account

**Task**:
A planned, independently trackable outcome within a Project. A Task can carry Factory-native
planning data, Subtasks, and Tracker Links. A Task may have an Archive State of `released` or
`wont_do`; archived Tasks remain addressable and historical but are omitted from Attention. A
Task may store a branch name for associating coding work with it; a branch name may contain an
external tracker identifier without changing that tracker.
_Avoid_: ticket, issue, work item

**Subtask**:
A small, independently reportable part of a Task. A Subtask has an agent-reported status and a
separate human verification state. A Subtask may have an Archive State of `released` or
`wont_do`; this changes only the Subtask's disposition and does not archive its parent Task.
_Avoid_: checklist item, to-do

**Work State**:
A Task or Subtask's explicit workflow placement: `backlog`, `planned`, `active`,
`awaiting_verification`, `blocked`, or `completed`. A Task's Work State remains directly
editable even when Subtask transitions can advance it; completion follows its own all-active-
Subtasks rule.
_Avoid_: derived status, progress percentage

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
An agent's claim about a Subtask's current state, with its reporter, time, and optional
evidence. It is not human verification and cannot itself complete a Task.
_Avoid_: completion, verification

**Verification**:
A human's acceptance, rejection, or deferral of a reported Subtask state.
_Avoid_: agent approval

## Execution and evidence

**Run**:
A durable Factory record of one attempt to advance a Task. It outlives its worker processes
and owns execution state, evidence, and attention requests.
_Avoid_: chat, session

**Code Session**:
A T3-observed or Herdr-managed Claude, Codex, or OpenCode session attached to a Run. It is
execution detail, not the Run's identity or completion evidence. Observing a running or completed
session never changes Work State or creates a Status Report.
_Avoid_: run, task

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
