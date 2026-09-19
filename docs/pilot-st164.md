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
