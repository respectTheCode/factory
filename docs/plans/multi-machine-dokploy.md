# Multiple agent machines and Dokploy deployment

Date: 2026-09-13 (revised 2026-09-13 after review)
Status: approved execution plan; implementation authorized, deployment and acceptance remain gated
Factory: T-37 (`d5ef62f2-e65f-4adc-8d5c-489f80463bc5`)
Owner: Kevin

## Outcome and scope

The existing agent machine and two additional machines use one authoritative Factory service on `dokploy_home`. Every machine reads the same work records and submits attributed reports through an authenticated API. Kevin reviews and verifies reports from the private mobile dashboard. Factory continues to observe coding sessions without dispatching or controlling them.

Kevin authorized implementation on 2026-09-13. Work is delivered as two releases (see below). Production cutover requires the pilot proof, and human acceptance remains separate from every agent report. Existing product requirements in linked Linear and Notion records remain authoritative.

## Two releases

The 2026-09-13 review found that the original single cutover changed the client protocol and the host at the same time. The plan now proves the protocol before moving the host.

- **Release A: remote protocol on the existing Mac.** Server-enforced human session, authenticated remote CLI, attribution, and idempotent writes ship to the current LaunchAgent service. All three machines point at the Mac by local network IP. No hosting change.
- **Release B: hosting move to Dokploy.** Linux packaging, backups, isolated pilot, and cutover against a client contract that Release A already proved. Multi-source T3 support lands in whichever release the ST-157 topology decision allows.

## Verified starting point

The September 13 review found a working macOS LaunchAgent serving port 3000 from release `20260910T095500-05f1f6d-dirty-1367`. SQLite integrity passed with 6 Projects, 36 Tasks, 156 Subtasks, 362 Status Reports and 31 Verifications before this plan was registered. These are a dated baseline, not migration target counts.

Persistence is one SQLite row holding the whole JSON state (`factory_state`, id 1). Every mutation rewrites the full snapshot, and the adapter refreshes before each read and write. That protects sequential processes, not simultaneous ones: the CLI opens SQLite directly while browser mutations execute in the server, and existing persistence tests exercise sequential application instances only. Once only the server writes, atomicity is a serialized in-process mutation plus one upsert; the remaining concerns are idempotency, revisions, and the whole-snapshot rewrite cost growing with history.

The server has no authenticated caller context. The WebSocket context is empty, the adapter drops request headers before tRPC sees them, and the `verify` route accepts a client-supplied `verifier` string. The LaunchAgent binds all interfaces for the trusted LAN. This exposure exists today, independent of multi-machine work, and is fixed first.

Status Reports carry only a free-text `reporter`. Projects have one workspace root, one Git origin and one T3 Project ID. T3 has one configured endpoint and session identity is provider plus external thread ID. The project brief embeds the local database path and the SessionStart hook resolves a Factory checkout to find `src/cli.ts`, so every agent machine currently needs a full checkout and Bun just to report.

The T-30/T-32 work was committed as the baseline on 2026-09-13 and pushed with the T-37 branch to the canonical remote `git@github.com:respectTheCode/factory.git` (`origin`). T-30 and T-32 await human verification. T-37 depends on T-30; the current CLI cannot record Task dependencies after creation, so the dependency is recorded here and in the objective. The home-lab Dokploy inventory dates from June 22; live server identity, routing, capacity and backups must be verified during ST-157.

Source references: [CLI](../../src/cli.ts), [persistence and domain](../../src/application.ts), [server](../../src/server.ts), [T3 coordinator](../../src/t3-coordinator.ts), [brief](../../src/brief.ts), [hooks](../session-start-hooks.md), [private access](../software-factory-tailscale.md), [requirements](../software-factory-requirements.md).

## Proposed architecture

- One Bun server owns production writes and publishes authoritative changes to web subscribers. All agent machines, including the current Mac, use the remote CLI. The documented "port 3001 development server shares the durable database" workflow is retired in Release A because a second server process is the same two-writer hazard; development uses a separate database.
- Keep SQLite on local persistent storage for the first release. No NFS database, client replicas, or multiple server replicas. Deployment must stop the old writer before starting the new writer. PostgreSQL remains a later option if availability or load requires multiple writers. Measure mutation latency once three machines report through the single writer.
- Add a typed remote client behind the CLI command interface. Reuse application validation across remote CLI and web. Keep `schemaVersion: 1` output compatibility and introduce explicit transport/API compatibility negotiation. Local database mode remains explicit for isolated development and offline administration with the service stopped.
- Client configuration: `FACTORY_URL`, `FACTORY_ACCESS_TOKEN_FILE`, and a stable machine identity. Credentials bind authenticated machine identity on the server; a caller-supplied hostname is not authentication. In remote mode the brief emits `FACTORY_URL` and never a database path.
- The remote client must fail clearly on unavailable, incompatible, unauthorized or ambiguous context. It must never silently create a local database or claim an unacknowledged write succeeded. Startup context may fail without blocking coding, but explicit reporting must expose failures.
- Make each command atomic, including report, parent rollup, ID allocation and idempotency receipt. Persist request keys with a payload digest and result: retrying an identical request returns the original result; reusing a key with a different payload is rejected. Use server timestamps and expected revisions for conflicting edits. Do not automatically replay arbitrary mutations on reconnect.

### Attribution contract

Decided in the ST-158 API contract, not later: `reporter` stays as the provider name (`claude`, `codex`), the server adds `machineId` bound from the presenting credential, and an optional session reference (provider plus external thread ID) may accompany a report. These fields must remain compatible with T-21's future run attempt lineage. Human verifications record the authenticated human identity from the browser session, never a submitted string.

### Authorization contract

Define and test this action matrix before implementation:

| Caller | Read context/history | Submit reports and permitted planning edits | Verify reports | Credentials, deletion and recovery |
| --- | --- | --- | --- | --- |
| Machine credential | Within assigned Project scope | Within assigned Project scope | Denied | Denied |
| Authenticated Kevin dashboard | Allowed | Allowed | Allowed | Explicit administrative workflow |
| Missing or revoked credential | Denied | Denied | Denied | Denied |

Enforce roles in every API route, including the existing WebSocket verification route. Establish a human browser session separately from machine credentials; never identify a human merely by a supplied verifier string. Validate browser origin during authentication and WebSocket upgrade, which requires the WebSocket adapter to pass request headers through to the tRPC context. Keep secrets outside the repository, database snapshots and logs; persist only appropriate credential verification material. Use revocable credentials per machine and minimum Project scope. GitHub and T3 read credentials remain server-side.

### Project and T3 identity

Use normalized Git origin as the portable repository identity. Register explicit machine-scoped workspace mappings for repositories without a remote, and select Factory's canonical Git remote during inventory rather than inventing one. Paths on separate machines must not contradict an otherwise valid repository match.

Decision (Kevin, 2026-09-13): all agent machines share one local network with the Factory host, and they address each other by local IP. Inventory so far: the Factory host is the Mac mini (`mac-mini`) at `192.168.6.100`, serving `http://192.168.6.100:3000`; its own machine credential `mac-mini` is scoped to all six Projects. ST-166 was deployed to the Mac LaunchAgent and verified by Kevin on 2026-09-13. The two additional machines are not yet recorded. T3 Code is a per-machine desktop application on loopback; each machine binds its T3 endpoint to its LAN address so the Factory server polls it centrally over plain HTTP on the private network. The T3 reader currently rejects plain HTTP for any non-loopback host; ST-160 relaxes that for private (RFC 1918) addresses only, never for public hosts. The push relay alternative is not pursued.

Either way, record `sourceId`, machine, endpoint configuration and secret reference. Namespace thread IDs, Project IDs, evidence deduplication, source sequences, refresh boundaries and reconciliation by source. Migrate existing records to one legacy source without losing associations. A refresh or outage on one source must not age out another source's sessions. If the new machines share a T3 backend, register that backend once while retaining machine attribution.

Automatic association uses the originating machine/source and an explicit session identity when available. Branch alone must not select between two running sessions on different machines. Missing or ambiguous matches remain unlinked. Source failures preserve core reporting and display the last successful observation time.

### Network model

Agent machines use `FACTORY_URL=http://<factory-lan-ip>:3000` with a bearer machine credential over the trusted local network. Bearer tokens travel in the clear on that LAN, so the LAN boundary is the security boundary; a public or hostile network must not be given a machine credential. The session cookie is `Secure` only behind HTTPS, so LAN HTTP sign-in works and the phone keeps using the private HTTPS route. The remote client accepts plain HTTP only for loopback and private addresses and refuses it for public hosts.

### Client distribution

ST-161 ships the CLI as a compiled single binary (`bun build --compile`) per operating system and architecture, versioned with the server's compatibility contract, plus the skill and hook files. A checkout is not required on agent machines. The hook installer and Codex trust script currently assume macOS paths; ST-157 records each machine's operating system and ST-161 makes the installer portable to whatever that inventory shows.

### Deployment and recovery

The server currently has no Dockerfile, no health, readiness or version endpoints, defaults to loopback with no host override, and resolves static files relative to the working directory. ST-162 adds all of these.

Build a Linux image with pinned Bun and immutable revision metadata, prebuilt web assets and a non-root runtime. Include health/readiness and version endpoints, graceful shutdown, a configurable bind host, and a persistent data directory with validated permissions. Readiness requires a compatible usable database; missing optional T3 or GitHub connectivity is degraded integration status, not core downtime. Production startup must reject an unexpectedly missing database instead of silently initializing an empty service.

Dokploy uses a single replica and stop-first updates on verified local storage. Bind the private proxy path deliberately and verify rendered runtime ports. Agent machines reach the service by LAN IP over HTTP; the phone reaches it through a private HTTPS route (Tailscale) with WebSocket upgrades at `/trpc`; do not inherit a public Cloudflare route. Keep pilot and development databases, credentials and URLs distinct from production, and label the pilot visibly.

Proposed recovery targets: at most one hour of lost data (RPO), restoration within one hour (RTO); hourly consistent backups, seven days of hourly retention, thirty daily backups, and a pre-deployment backup. Confirm storage capacity and destination in ST-157. Backups must leave the Dokploy host and failures must be visible through an explicitly configured operational mechanism. Test restore into an isolated service and compare durable IDs, report and verification histories and integrity. Credentials need a separate recovery procedure.

Rollback after new production writes must preserve those writes. Prefer a compatible prior image against current data or a forward fix. Restoring the pre-cutover database after new reports arrive requires a deliberate reconciliation and data-loss decision; it is not an automatic rollback.

## Delivery sequence and evidence

| Subtask | Release | Outcome | Prerequisites | Required proof |
| --- | --- | --- | --- | --- |
| ST-157 | A | Baseline, architecture and live inventory | None | Committed and pushed baseline including T-30/T-32 work (done); machine/OS list and LAN IPs, host identity, private route, role matrix, recovery targets. Git destination and T3 topology (LAN central pull) decided |
| ST-166 | A | Server-enforced human session | ST-157 baseline | Authenticated browser session, origin check on upgrade, verify route rejects unauthenticated and machine callers; deployed to the current Mac service |
| ST-158 | A | Authenticated remote API and CLI | ST-166 | Equivalent core behavior through CLI/web; attribution fields; denial, revocation, scope and compatibility tests |
| ST-159 | A | Serialized writes and safe retries | ST-158 contract | Idempotency receipts across restart, stale revision rejection, lost-response retry; no duplicate reports or lost records; mutation latency measured |
| ST-161 | A | Compiled client on three machines | ST-158 | Versioned binary, skill and hooks; remote-mode brief; configuration doctor; fresh Codex/Claude session proof on each machine against the Mac service |
| ST-160 | A or B | Multiple T3 sources and workspace mappings | ST-157 decision, ST-159 | Duplicate thread IDs, same branch, independent sequences, unavailable source and migration preservation tests |
| ST-162 | B | Private Dokploy packaging | ST-157 | Reproducible image, health/readiness/version, persistent restart, secret loading, private HTTPS/WebSocket checks |
| ST-163 | B | Backups and recovery | ST-162 | Scheduled off-host backup and timed isolated restore with record comparison |
| ST-164 | B | Isolated pilot | Release A complete, ST-162, ST-163 | Three-machine reporting, denied verification, restart/reconnect, outage, revocation and restore demonstrations |
| ST-165 | B | Authoritative cutover and human review | ST-164 | Final migration comparison, all clients switched, old writers disabled, mobile verification and successful scheduled backup |

Dependencies are documented here and in Subtask descriptions because the current model does not enforce Subtask dependencies. Packaging can proceed alongside Release A after inventory. No implementation report is created merely by planning these stages.

Existing work: T-30's canonical mutation/subscription behavior and T-32's instruction changes are part of the ST-157 baseline. Coordinate bounded CLI output with T-23 without requiring all of that Task to ship first. T-20's richer Attention Requests and T-21's run attempt lineage are useful follow-ups, not prerequisites; the attribution contract above must remain compatible with their future fields. No scheduler, worker dispatch, automatic verification, tracker synchronization, or PostgreSQL migration is included.

## Cutover checklist (Release B)

1. Complete pilot proof using isolated data and record the approved image, schema and private endpoint.
2. Pause reporting and stop every old production writer, including the Mac server. Take the final consistent backup and record current IDs, counts and history checksums.
3. Transfer and migrate the database on Dokploy; validate it before admitting writes. Preserve the old data as a recovery artifact.
4. Point all three clients and the mobile dashboard at the new endpoint. Verify machine credentials, repository context, reports and source-specific associations.
5. Verify authoritative updates and reconnection on mobile, then have Kevin accept a test report through the human session. Confirm agent credentials cannot perform that action.
6. Observe through a scheduled off-host backup and restart/health check. Keep old services disabled; document the recovery location and procedure.

## Acceptance and handoff

T-37's acceptance criteria are the release gates: shared records and attributed reporting on all machines; server-enforced role separation; safe concurrency and retries; independent T3 sources; a private persistent Dokploy service; proven recovery; and a cutover preserving IDs/history with mobile human verification. Release A satisfies the first three against the Mac service; Release B satisfies the rest. Each Subtask report records the tested revision, actual checks, limitations and concrete human check. Agent complete reports request review; Kevin's acceptance remains separate.

Planning validation consists of link/ID checks, `git diff --check`, and the existing skill contract test. Implementation will use behavior-focused tests through the public API, then container and live pilot checks. Host capacity, new-machine configuration, private routing, Linux packaging, backup scheduling and real-phone behavior have not been verified by this planning task.
