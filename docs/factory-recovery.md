# Factory pilot backups and recovery

ST-163 protects the isolated Dokploy pilot. The Mac remains authoritative;
production migration and client switching belong to ST-165.

## Backup path

The `backup-snapshots` container reads the pilot SQLite volume read-only and
creates a consistent snapshot every five minutes. It publishes a database and
manifest together in `factory-pilot-st163-snapshots`. The manifest records
integrity, checksums, durable record IDs and history digests without printing
credentials. The snapshot includes SQLite credential verification material,
human sessions and idempotency receipts; treat the archive as sensitive.
Raw machine tokens, the operator secret and Tailscale state are not copied.

Dokploy's native volume backups stop only `backup-snapshots` while archiving
that volume, then restart it. Factory itself continues serving requests.
This avoids archiving a live SQLite file or a changing database/manifest pair.
See [Dokploy volume backup behavior](https://docs.dokploy.com/docs/core/volume-backups)
and the [v0.30.2 implementation](https://github.com/Dokploy/dokploy/blob/v0.30.2/packages/server/src/utils/volume-backups/backup.ts).

The existing MinIO destination is `dN6AZG95rsHYn5BNMeg0d`, endpoint
`http://192.168.5.16:9000`, bucket `dokploy`. Credentials stay in Dokploy.
Kevin confirmed on 2026-09-17 that this is a physically separate NAS.
The object prefix is `factory-pilot-st162-ewgahg_backup-snapshots/st163/`.

| Backup | Cron (Dokploy server UTC) | Retention | Dokploy ID |
| --- | --- | --- | --- |
| Half-hourly | `12,42 * * * *` | 336 successful copies, about seven days | `ZsJVrP3JY19lMvKAG7eyD` |
| Daily | `22 5 * * *` | 30 successful copies | `DBLk--LZBCKMugziiyAUP` |

The normal recovery point is at most about 35 minutes old plus upload time,
providing margin within the one-hour RPO. An outage lasting over an hour can
violate that target; a configured schedule is not proof of a recent backup.
Manual backup runs count toward count-based retention. Daily and half-hourly
prefixes are separate, so pruning one cannot prune the other.

## Operational checks

Kevin selected Dokploy status and logs as the failure-reporting mechanism on
2026-09-17. No email, chat or other active notification destination is enabled.

In Dokploy, open **Factory → pilot → factory-pilot → Volume Backups** and check
the most recent run and its logs. Upload failures must appear as failed runs.
Also check `backup-snapshots` health: an old snapshot must not be mistaken for
a current successful recovery point, even if its archive uploaded successfully.
The snapshot container logs creation failures and becomes unhealthy when its
last good snapshot is stale. A tar failure can leave that container stopped in
Dokploy v0.30.2; restart only that container after resolving the error.

Never interpret an empty backup listing, failed upload, unhealthy snapshot
container or unavailable destination as success. Retention errors in this
Dokploy release are logged separately; periodically inspect the object listing
as well as backup run status.

## Pre-deployment copy

The private release poller takes and verifies a fresh consistent local copy
before requesting a changed release. A failed copy blocks the deployment.
Copies are under `/data/predeploy/`; only the last ten copies created by this
script are retained. They complement the scheduled off-host archive and do
not protect against loss of the Dokploy disk. Before a production migration
or risky schema change, also take and confirm an off-host backup manually.
Manual deployments bypass the poller and require the same explicit backup
check. Do not roll back the database merely because an image deployment fails.

## Isolated restore rehearsal

1. Record the chosen archive path, backup run, source snapshot manifest and
   start time. Start timing before downloading, not after extraction.
2. In the pilot's **Volume Backups → Restore Volume**, select MinIO and the
   archive. Use a new volume name such as
   `factory-pilot-st163-restore-YYYYMMDDTHHMMSSZ`. Never select the live data or
   snapshot volume. The native restore downloads the archive from MinIO.
3. Run `scripts/check-pilot-restore.sh RESTORED_VOLUME` on the Dokploy host
   environment with Docker access. It checks integrity, snapshot checksums,
   IDs and history against the manifest, then starts a separate temporary
   Factory container against restored data with no published ports or external
   network. It uses a separate operator secret and checks readiness/version.
4. Record download-through-readiness elapsed time against the one-hour RTO.
   The script removes its temporary container and operator secret. It retains
   both the untouched restored archive volume and a separate `factory-pilot-st163-drill-*`
   working volume with `st163-restore-report.json` for inspection. Remove these
   explicitly named rehearsal volumes only after review.

A manifest detects an incomplete or changed archive; it is not an independent
signature against an attacker who can replace both files. Recovery comparisons
are against the snapshot's point in time, not the newer live database.

## Credentials and real recovery

Keep operator secrets and machine token files in the separately managed secret
store or owner-only client files. Do not put them in the backup manifest,
repository or reports. A database backup preserves token hashes but cannot
recover a lost plaintext token. Reissue lost machine credentials locally on
the recovered service and update the affected client securely. Revoke missing
or compromised credentials. Provision a new operator secret when needed.
Re-enroll Tailscale if its separately stored node state is unavailable.

For a real recovery, stop every old writer before attaching a recovered
database to the authoritative service. Restore into a new volume, verify it,
then deliberately switch the service. Preserve the old volume and all newer
reports for reconciliation. Prefer a compatible prior image against current
data, or a forward fix, for rollback after new writes. Replacing current data
with an older backup requires a human decision about reconciliation and loss;
it is never automatic rollback.

## Evidence

Rehearsed on 2026-09-18 UTC (2026-09-17 in Indianapolis), using pilot revision
`9871bc2ffd2d93a8611946ab97b5295860c64d70` on Dokploy v0.30.2.

| Check | Observed result |
| --- | --- |
| Scheduled upload | Timer run `qNSfIaBxXpdVwBrdQAls0` succeeded at 01:25 UTC; its 102,400-byte archive was listed on MinIO. The cron was temporarily every minute for this check, then restored and read back as `12,42 * * * *`. |
| Retention | Three successful runs of disabled validation config `J_SvYaM33_GY4J2oA6VzQ` with keep=2 left exactly the two newest archives in `st163/retention-check/`; the first was pruned. |
| Failure visibility | Run `NEviHHWRWTphIn8Fx9YV1` deliberately used a fake destination at local port 9. Dokploy recorded `error` and connection-refused logs. Factory remained healthy. The validation config remains disabled. |
| Restore | Daily archive `factory-pilot-st163-snapshots-2026-09-18T01-24-25-590Z.tar` downloaded from MinIO into a new volume. Native UI reported successful extraction. |
| Recovery time | Started timing at 01:28:42 UTC before Restore; successful readiness and evidence were observed by 01:29:10 UTC: **28 seconds**, below the one-hour target. Verification/startup inside the script took two seconds. This measures the small pilot dataset on the existing host with the image already present. |
| Integrity and history | Restore run `gopR-dkK9QA51VdmHMheG` verified checksum, SQLite integrity, schema, content, durable IDs, report/verification history and protected-table digests, then passed isolated `/readyz` and `/version`. |
| Pre-deploy copy | Run `Hi2EnAmUWG8VZpgeJl6Di` created and verified `/data/predeploy/20260918T012936Z-1789694976-545988/factory.sqlite`; its content and ID digests matched the restored snapshot. |

The restored snapshot was created at 01:24:05.529 UTC. It contains one project,
one task, two subtasks, one status report and one human verification. The report
ID is `65122d24-6d58-44d3-9a3e-9da30ed6bc8a`; the preserved human verification is
`47864aea-2ea2-42c5-91a1-502f75d008c1`. SQLite SHA-256 is
`2a46561d660ce5def1614b4f711e100d83ddd8dcf99405b0138f665bc9bc6689`.
The archive is under the daily prefix shown above. Retained inspection volumes:
`factory-pilot-st163-restore-20260918T0130Z` and
`factory-pilot-st163-drill-20260918T0130Z`.

Validation passed: 19 focused tests (snapshot, loop, poller and skill contract),
typecheck, shell/Node syntax checks, and 50 tests in the Linux amd64 Docker build.
A separate non-root container check verified read-only source access, exported
database/manifest ownership and freshness health. Poller tests prove backup
failure prevents the deployment request. These checks establish pilot recovery;
they do not constitute a production cutover or human acceptance of ST-163.
