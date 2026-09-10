# Durable Simple IDs for Tasks and Subtasks

## Status

Accepted — 2026-09-10

## Decision

Factory keeps UUID `id` values as the internal primary and relationship keys, and adds a durable
human-readable `simpleId` to every Task and Subtask. Tasks use `T-<number>`; Subtasks use
`ST-<number>`. The counters are global to the Factory database, so a reference is unambiguous
when spoken or copied between agents and projects.

All public Task and Subtask operations accept either the UUID or the simple reference. New CLI
and session-brief commands prefer the simple reference, while JSON retains both fields so scripts
that depend on UUIDs continue to work. The dashboard shows the simple reference beside each
Task/Subtask title.

Legacy rows receive deterministic references during hydration. Allocation uses persisted next
values rather than the current row count, so deleting a record leaves a visible gap and never
causes a later record to inherit the deleted reference. Duplicate or malformed legacy values are
repaired in persisted order; the first valid occurrence wins.

## Consequences

- Agents can say “Task T-27” or “Subtask ST-143” without copying a UUID.
- UUID relationships, reports, verification history, and external observations do not change.
- Simple references are Factory-local and do not replace Linear, Notion, GitHub, T3, or other
  external identifiers.
- A simple reference is not editable or reused; renaming a Task does not change it.
