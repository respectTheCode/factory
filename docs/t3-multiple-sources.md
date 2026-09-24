# Multiple T3 sources

Factory reads T3 activity; T3 Connect provides the user's separate control connection.
Each T3 installation has a stable source ID, a Factory machine ID, and its own
read-only credential. Adding a source does not move the Factory database.

## Server configuration

Set `FACTORY_T3_SOURCES_FILE` to an absolute path containing a JSON array. Keep
this file and the referenced token files outside the repository. Token files
should be readable only by the service user (`0600`). For example:

```json
[
  {
    "sourceId": "legacy",
    "machineId": "mac-mini",
    "label": "Mac mini",
    "baseUrl": "http://127.0.0.1:3773",
    "accessTokenFile": "/absolute/path/to/mac-t3-read-token"
  },
  {
    "sourceId": "ubuntu",
    "machineId": "agent-ubuntu",
    "label": "Ubuntu agent",
    "baseUrl": "http://192.168.6.51:3773",
    "accessTokenFile": "/absolute/path/to/ubuntu-t3-read-token"
  }
]
```

Source IDs are durable namespaces. Keep the original Mac source named `legacy`:
existing sessions, associations, evidence and findings migrate into that namespace
without changing their record IDs. Do not rename a source to change its label.
Machine IDs must match Factory's credential-bound machine identity.

Each source requires a unique ID and backend URL. Cleartext HTTP is supported
only for literal loopback and RFC1918 addresses; other hosts require HTTPS.
Credentials, query strings and fragments are forbidden in source URLs. Restrict
network access to the trusted LAN and keep T3 authentication enabled.

Without a registry, the existing `T3_BASE_URL` and `T3_ACCESS_TOKEN_FILE`
configuration supplies the legacy source. `FACTORY_T3_MACHINE_ID` identifies its
machine (default `mac-mini`). The Mac service launcher also discovers an existing
`secrets/t3-sources.json` beneath its service root unless an explicit registry
path is supplied.

## Manage connections in Factory

Signed-in human operators can open **T3 connections** from the global navigation
or at `/connections`. The page lists each source and its latest tested state and
successful fetch time. Use **Refresh status** to check saved sources, or test an
edited draft before saving it. A new source needs a label, the Factory machine ID
assigned to that Mac, a reachable T3 endpoint, and a read-only token. In T3, enable
trusted-LAN access for the reader and provision a token with
`orchestration:read`; keep T3 Connect's account approval and Factory's reader token
separate. The Factory connection test checks reachability, authentication, and read
permission without displaying or returning the token.

Saved sources are adopted immediately, without a Factory restart. Editing a
source keeps its source ID, so its Factory history and associations remain in
place. When the endpoint, machine identity, or credential changes, Factory clears
the displayed last-success time for the prior connection until the replacement
is successfully fetched. A failed check reports the current state while retaining
the last successful fetch for that same connection; an untested connection has no
known success time.

The UI-managed overlay is stored as one atomically replaced document,
`managed-sources.json`, in a private directory adjacent to the configured Factory
database by default. Set `FACTORY_T3_CONNECTIONS_DIR` to use another absolute
directory. Factory creates the directory with mode `0700` and the document with
mode `0600`; it keeps tokens in this document and never includes them in list,
test, or refresh responses. Existing environment or mounted source files remain
read-only base configuration, and managed rows override them by source ID. Keep
the overlay directory backed up and protected separately: the existing
database-only backup does not include managed T3 credentials. For a repository-
local development database, the default `t3-connections/` directory is
git-ignored.

## Project and session identity

Normalized Git origin identifies a repository across machines even when checkout
paths differ. Repositories without a remote need explicit source mappings. Use
`project update --project-id PROJECT_ID --t3-mappings-json` with a JSON array such as:

```json
[{"sourceId":"ubuntu","workspaceRoot":"/home/agent/Projects/local-project"}]
```

Project configuration remains human administration. Use the CLI in explicit local
database mode with the service stopped, or the authenticated human API; a machine
reporting credential cannot edit Project identity. Never open the live database
through a second writing process.

The array replaces the project's source mappings. A mapping may also specify
`t3ProjectId`; duplicate source IDs, empty mappings and relative roots are invalid.
An explicit mapping constrains matching for that source.

Use `--source-id` when selecting a session for detail, linking or unlinking.
Automatic linking uses the authenticated machine's source; `--thread-id` can
identify the originating thread explicitly. A branch shared by multiple sources
is insufficient to choose one. Missing or ambiguous matches remain unlinked.
Reports can carry `--session-thread-id` and `--session-source-id`; reporting work
remains possible when T3 is unavailable.

A source failure must not invalidate another source's observations, sequences or
associations. Inspect per-source connection status and last successful observation
when diagnosing missing activity.

## Ubuntu setup evidence, September 18, 2026

Ubuntu runs standalone T3 Code 0.0.42 as `t3code.service` under user `agent`, with
user lingering enabled. The service drop-in
`~/.config/systemd/user/t3code.service.d/factory-lan.conf` sets
`T3CODE_HOST=0.0.0.0`. This preserves the loopback upstream used by T3 Connect and
allows the authenticated private LAN reader. Both observed network interfaces
were private; this is not authorization to expose port 3773 publicly.

The reader at `192.168.6.51:3773` was verified from the Mac with scope
`orchestration:read`. Its shell was reachable and empty at provisioning time.
The read token is separate from T3 Connect's account approval. It expires roughly
30 days after provisioning (around October 18, 2026) and needs renewal before then.
Never copy an administrative T3 session token into Factory's reader configuration.

## Hosting move

ST-160 proves source isolation on the existing Factory host. ST-164 proves the
isolated Dokploy pilot, including private access from Dokploy to both T3 sources.
The Mac's current loopback reader will need a privately reachable endpoint for
that pilot. ST-165 performs the authoritative data move after pilot acceptance:
stop old writers, take the final backup, copy and verify it on Dokploy, switch
clients, and verify reporting, human review and a scheduled off-host backup.
See [the deployment plan](plans/multi-machine-dokploy.md) and
[recovery runbook](factory-recovery.md).

## Migration rehearsal

On September 18, 2026, an isolated copy of the pre-ST-160 production backup was
opened and persisted with the source-aware application. Every record ID and array
order survived. Reports, verifications, associations and runs were unchanged apart
from additive source identity on report session references. The snapshot contained
6 Projects, 39 Tasks, 170 Subtasks, 411 reports, 41 verifications, 19 Code Sessions,
12 associations, 83 observations, 5 evidence records and 89 findings. This rehearsal
is migration evidence; it is not a production cutover or human acceptance.

The source-aware coordinator was also exercised against both real T3 endpoints
using that isolated database copy. Both sources reported `connected`; the Mac
returned 10 projects and 115 threads, and Ubuntu returned zero projects and
threads. Factory project activity returned 23 Mac threads. Ubuntu's project
match was `unmatched`, as expected until a corresponding repository is opened
there. No production observations were written by this check. The Mac source registry is
prepared at `~/Library/Application Support/Factory/secrets/t3-sources.json` with
mode `0600`; both configured readers passed a live connection check. The existing
service has not been restarted to adopt ST-160.
