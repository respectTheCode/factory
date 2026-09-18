# Factory backups and recovery

ST-163 protects the isolated Dokploy pilot. The Mac remains authoritative;
production migration and client switching belong to ST-165.

## Storage and ownership

Factory owns backup scheduling, creation, retention and restore. The signed-in
human dashboard has a **Backups** page, following Mission Control's workflow.
Machine credentials cannot list, create, delete, configure or restore backups.

The live SQLite database stays on local Docker storage at `/data/factory.sqlite`.
Docker mounts `192.168.5.16:/volume1/docker/factory-backups` at `/backups`, using
`addr=192.168.5.16,rw,nfsvers=4`. The pilot uses the `pilot/` subdirectory to keep
its recovery points separate from any future production backups. The NAS is
physically separate from Dokploy, as Kevin confirmed on 2026-09-17.
See [Docker's NFS volume configuration](https://docs.docker.com/engine/storage/volumes/#create-a-service-which-creates-an-nfs-volume).

The export must exist and allow Dokploy (`192.168.5.50`) to mount it. Factory
runs as UID/GID 1000 and needs write access to its backup directory. The deployed
app requires an actual NFS mount; it must never report a local fallback folder
as an off-host backup. NFS outages appear in Backups status and service logs.
The backup worker isolates filesystem operations from the HTTP event loop.

Configure `FACTORY_BACKUP_DIR` to enable the feature on a server, and
`FACTORY_BACKUP_REQUIRE_NFS=true` to enforce mounted NFS storage. The pilot uses
`FACTORY_BACKUP_DIR=/backups/pilot`. An unconfigured server exposes a clear
unconfigured state and does not invent a backup destination.

## Schedule and retention

The defaults are a backup every 30 minutes, the newest 336 scheduled recovery
points (about seven days), and one recovery point per UTC day for 30 days.
Retention keeps the union of these sets, rather than duplicating the same copy.
Manual and pre-restore safety backups remain until a human explicitly deletes
them; the newest ten pre-deployment copies are retained. The Backups page lets
the operator change the schedule and retention settings.

A backup is first made consistently on local storage using SQLite `VACUUM INTO`.
It includes a manifest containing integrity, checksum, durable IDs and history
digests. Factory copies the snapshot and manifest to a temporary directory on
NFS, verifies that copy, then publishes it atomically. Retention follows a
successful backup and only removes Factory-owned backup directories. Unrelated
files are preserved. Partial work is never offered as a successful restore point.
Listings use creation-verified metadata to avoid repeatedly scanning every SQLite
file on NAS. Restore always rechecks the full snapshot and manifest before use.

The normal recovery point is at most about 30 minutes old plus backup duration,
within the one-hour RPO. An outage lasting over an hour can violate that target.
Check the last successful backup and errors; enabled scheduling alone is not
proof of a recent copy. Keep sufficient free space on both local storage and NAS.
No email or chat notification destination is configured.

## Manual backups and deployment

Open **Backups → Create backup** while signed in. Wait for the new recovery
point to appear and the operation to finish. A failed operation must remain
visible as an error, not an empty successful listing.

The private release poller calls the app's authenticated backup operation before
requesting a changed release. This publishes a verified pre-deployment copy to
the same share; failure blocks the deployment request. The operator secret is
read inside the container and never printed. Manual Dokploy deployments bypass
the poller, so create and confirm an app backup first.

## Restoring from the app

1. Choose a backup on the **Backups** page and review its timestamp. Restoring
   replaces current Factory data with that recovery point; newer work will need
   reconciliation. Confirm the selected backup only when that is intended.
2. Factory verifies the chosen snapshot and takes a mandatory pre-restore safety
   backup. A failed verification or safety backup aborts the restore.
3. The app enters maintenance, stages the verified database on local storage,
   and performs a controlled restart. It applies the staged database before
   opening database connections, preserving single-writer operation. NFS is
   never used as the live database.
4. Reconnect and sign in again. Check readiness, projects, durable IDs, reports
   and human-verification history. The safety backup is available if the chosen
   recovery point was wrong. Do not immediately delete it.

Restore requires the configured single Factory writer and stop-before-start
container replacement. Do not run a second server or local CLI against the same
live volume: the maintenance gate covers this server, not unrelated processes.

For a real recovery, stop every old writer before attaching a recovered database
to the authoritative service. Preserve the old volume and any newer reports for
reconciliation. Prefer a compatible image against current data or a forward fix
when recovering from a bad release. A rollback to older data is never automatic.

If the application cannot start, restore using an isolated local volume and the
same snapshot verification helper before deliberately switching the service.
Do not overwrite a database while any Factory process still has it open.

## Credentials

Snapshots contain SQLite credential verification material, sessions and
idempotency receipts; protect access to the NAS. They do not contain raw machine
tokens, the external operator secret or Tailscale node state. Keep those in the
separate secret store or owner-only client files. A database backup cannot recover
a lost plaintext token. Reissue lost credentials securely and revoke missing or
compromised credentials. Restoring an older database may roll back machine-token
revocations; review credentials before reopening a recovered production service.
Re-enroll Tailscale if its separately stored node state is unavailable.

A manifest detects corruption or mismatch; it is not an independent signature
against an attacker able to replace both database and manifest.

## Migration and evidence

On 2026-09-18 Kevin requested this app-managed NFS design instead of native
Dokploy volume backups. Keep the existing MinIO archives during the transition.
Disable the old half-hourly and daily Dokploy jobs only after an app-managed NAS
backup and restore have passed. Their IDs are `ZsJVrP3JY19lMvKAG7eyD` and
`DBLk--LZBCKMugziiyAUP`; the old archive prefix is
`factory-pilot-st162-ewgahg_backup-snapshots/st163/` in MinIO bucket `dokploy`.

The previous native-backup rehearsal at revision `9871bc2` passed integrity,
retention and failure checks and restored the small pilot dataset in 28 seconds.
That historical result does not prove the new app-managed restore path.

The new implementation passed the Linux/amd64 image build with 74 focused tests
on 2026-09-18, including backup retention, authentication, write serialization,
and ten restore recovery cases with process-exit fault injection. Sixteen local
API, release-poller and web tests also passed. A disposable local service
rehearsal created a pre-deployment backup through HTTP, acknowledged restore,
exited normally, restarted ready, and reported a durable `restored` result.
The image also rejected a local filesystem when NFS enforcement was enabled.
These checks used local fixture storage, not the NAS. Browser preview was
blocked by the connected browser (`ERR_BLOCKED_BY_CLIENT`), so visual review
remains pending.

The mounting blocker was traced through SSH to existing Paperless NFS I/O:
Docker startup waited in NFS GETATTR on its data volume, blocking the package
upgrade. The NFS recovery process dated from September 9, before this work.
Kevin authorized a normal reboot. A changed boot ID and healthy containers
confirmed recovery; the NFS mount then succeeded (run `RLKZYuM27dmh21HTTeeF1`).

The NAS parent folder allowed UID 1000 only read access. A one-time setup created
only `/volume1/docker/factory-backups/pilot`, owned by UID/GID 1000 with mode
0700. A container running as 1000:1000 successfully created, read and deleted a
unique probe file there (run `vArGLKH-MHCbTvnqWwOn5`). No broader share ACL change
or NAS SSH was needed. Factory remains non-root.

Compose references the externally provisioned `factory-pilot-backups-nfs`
volume. Its driver is local, type nfs, device
`:/volume1/docker/factory-backups`, options `addr=192.168.5.16,rw,nfsvers=4`.
Preserve this volume and the pilot subfolder ownership on redeploy.

The new application deployment and live NAS restore rehearsal remain pending.
Existing native backup jobs and archives remain in place during validation.
