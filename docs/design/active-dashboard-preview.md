# Active dashboard sample preview

Run the actual Factory app with a fresh disposable SQLite database and local fake T3/GitHub readers:

```sh
bun run scripts/preview-active-dashboard.ts
```

To review stale or unavailable linked-session states, start a separate run with:

```sh
PREVIEW_STALE_T3=true bun run scripts/preview-active-dashboard.ts
```

Open `http://127.0.0.1:3016` and sign in with `sample-preview` / `factory-preview-only`. Both values are disposable local test credentials. The project and task names begin with `SAMPLE PREVIEW` so they are easy to identify in the UI. The second project provides a project-filter example.

The fixture includes a long-title card, active work with two linked contributors and three Steps (one complete, one active, one marked won't do, so the card shows 1/2), a shared session associated with two tasks, active work without a session, an explicit manual hold, human and agent handoffs, an in-review task with an open PR, a draft PR, a ready human check, six planned tasks (one with an approval session and five ordinary tasks with no Steps), a recently completed archived task, and an unmatched observed T3 session. The six planned tasks provide rows for reviewing the dashboard's Show more/fewer behavior. The second sample project has a healthy fake T3 observation with no threads. By default fake T3 observations refresh on every read. `PREVIEW_STALE_T3=true` makes both project reads unavailable and marks the linked observations stale. All database files live in a new `/tmp/factory-active-dashboard-preview-*` directory. T3 and GitHub data come from in-process fakes; no live integrations or existing Factory database are read. Press Ctrl-C to stop the server and remove the fixture directory.
