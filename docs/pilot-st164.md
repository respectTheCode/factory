# ST-164 copied-data pilot

The Mac remains the authoritative Factory writer. This rehearsal uses the private
Dokploy pilot at `https://factory-pilot.tailb6a4be.ts.net` and LAN address
`http://192.168.5.50:3101`. Neither production client configuration nor production
machine credentials are switched to the pilot.

## Scope

Kevin deferred fixing outbound LAN access for the retiring Mac Factory
LaunchAgent on September 18, 2026. ST-164 must instead demonstrate private T3
access from Dokploy to both onboarded machines. The third machine remains
deferred. The Mac T3 endpoint is distinct from the retiring Factory service.

The pilot checks cover copied record preservation, fresh credentials, concurrent
reporting, duplicate-request handling, denied verification and administrative
access, credential revocation, source outages, restart and WebSocket reconnect,
off-host backup and isolated restore. Human phone testing and acceptance remain
separate from agent evidence. ST-165 owns the final data freeze and cutover.

## Isolation

- Preserve `factory-pilot-st162-data`, the earlier synthetic test volume.
- Prepare a consistent read-only copy of the Mac database into new staging
  storage, revoke copied machine credentials there, and issue fresh pilot tokens.
- Attach a new local Docker data volume using `FACTORY_PILOT_DATA_VOLUME`.
- Set `FACTORY_PILOT_BACKUP_DIR=/backups/st164` on the existing NAS mount.
  Keep the earlier `/backups/pilot` recovery points separate.
- Mount the operator-provisioned `files/t3` directory read-only at
  `/run/factory-t3` and set `FACTORY_T3_SOURCES_FILE` to its `sources.json`.
- Keep source IDs `legacy` and `ubuntu`, bound to machine IDs `mac-mini` and
  `agent-ubuntu`. Use the private LAN endpoints on port 3773 and read-only T3
  tokens. The source registry and tokens are not repository files.

The copied database is never a fallback writer for production. Pilot test work
belongs to explicitly named rehearsal tasks. Preserve the copied production
records and their human verification histories.

## Starting evidence, September 19, 2026

The existing synthetic pilot reported revision
`e23ea4f2b7ff1c5013fa4b2f2d913da8419fbc87` and healthy readiness. Its pre-deployment
backup `b-20260919T134907.729Z-837ea4ea` succeeded on the NAS. The running container
could reach both `192.168.6.100:3773` and `192.168.6.51:3773`. Authenticated
multi-source checks must be repeated after deploying the source-aware release.

The new NAS `st164` directory was created with owner UID/GID 1000 and mode 0700;
write access was checked as the Factory runtime user. T3 credential files and
the source registry were provisioned outside Git with owner-only permissions.

## Copy preparation

The September 19 snapshot contains 917 records: 6 Projects, 39 Tasks, 170
Subtasks, 417 Status Reports, and 42 Verifications, plus links and session
metadata. Full state, durable ID, report-history, verification-history, and
idempotency-receipt hashes matched before and after credential rotation.
Copied human sessions were invalidated; fresh pilot credentials replaced the
Mac and Ubuntu machine credentials. Production credentials remain unchanged.

The prepared database was transferred to local volume
`factory-pilot-st164-data-20260919`; source and destination SHA-256 matched.
The copy contains an explicitly named rehearsal Task and Subtask for test writes.

`scripts/check-multi-machine-pilot.ts` writes rehearsal reports by default.
Its `--read-only` mode rechecks existing reports without creating reports;
authenticated requests still update credential usage metadata. The harness
proves explicit WebSocket close/reopen, not an infrastructure outage. T3 source
checks, server restart, and a credential's successful authentication before
revocation require separate live evidence. A rejected token alone does not
prove the token was previously valid.

## Live rehearsal results

The private pilot deployed release `4b2a0b3f6e81d899c003845c9f6ea0ae941feaee`
(the reviewed application tree from `0856a3d`). Dokploy deployment
`oceD-Uiz05lOCFPOe4KMZ` completed; readiness and the Docker health check passed.

- HTTPS reporting with `mac-mini` and `agent-ubuntu` credentials produced
  reports `df044902-98d7-4d6f-b647-57e727fb6564` and
  `6c313524-b0b8-434d-92f8-93b53661d7bb`. Concurrent retries returned the same
  IDs. They remained present after restart and restore.
- A command executed on Ubuntu produced report
  `c46a4a64-10f7-4a18-91d3-f71d85e8ce64`; the Mac read it back with Ubuntu
  attribution. Ubuntu used the private LAN URL because its current resolver
  does not resolve the pilot's Tailscale hostname. Production client settings
  were not changed.
- Machine verification and backup administration were denied. The production
  Mac credential was rejected by the pilot. Ubuntu was denied access to the
  Mac T3 source. A disposable pilot credential authenticated successfully,
  was revoked while the service was stopped, and was denied after restart
  and restore.
- Both T3 endpoints authenticated from Dokploy using version `0.0.42`.
  Mac returned 10 Projects and 23 threads. Ubuntu returned zero Projects and
  threads: its transport is `connected`, while Project matching is `unmatched`.
  A first real Ubuntu T3 Project/session remains a human workflow check.
- Temporarily pointing only the pilot's Ubuntu source at an unavailable local
  endpoint produced `unreachable`; Mac stayed connected and reporting remained
  available. The original registry was restored and Ubuntu reconnected.
- Authenticated WebSocket snapshots succeeded after explicit reconnect and
  after service restarts and restore.
- Scheduled NAS backup `b-20260919T140336.845Z-19ece744` verified successfully.
  Manual backup `b-20260919T140621.851Z-aca4d64a` restored in 3.22 seconds,
  including recovery/status observation, with pre-restore safety copy
  `b-20260919T140635.182Z-24867f0a`. The disposable post-backup report vanished;
  all four earlier rehearsal reports remained. All 417 original reports and
  42 original verifications retained their exact content hashes. This meets
  the one-hour recovery target for the tested approximately 7 MB database.
- Final backup settings remain enabled every 30 minutes, with 336 recent and
  30 daily recovery points. Status showed no error and was not stale.

Validation included 39 focused local tests, TypeScript, build, formatting and
Linux image build checks. No GitHub checks were configured for the PR at review
time. Duplicate-thread and identical-branch isolation are covered by automated
source-isolation tests; Ubuntu's empty live source cannot demonstrate those
cases with real sessions yet.

## Human check and next gate

On a phone connected to Tailscale, open
`https://factory-pilot.tailb6a4be.ts.net`, confirm the PILOT label, sign in using
the existing pilot operator secret, and inspect the copied records and the
explicitly named rehearsal Task. Review `/backups` and its saved restore result.
Any edits here remain test data. Accept ST-164 in the authoritative Mac dashboard
only when satisfied. ST-165 still owns a fresh final copy, client switch, disabling
the Mac writer, and production acceptance; none of those actions occurred here.
