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
   The script removes its temporary container and retains the restored volume
   for inspection. Remove only that explicitly named drill volume after review.

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

Live backup, timer, retention and restore results are recorded here after the
rehearsal. Configuration alone does not complete ST-163.
