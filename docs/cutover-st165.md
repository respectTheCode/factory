# ST-165 authoritative Dokploy cutover

Kevin authorized the production cutover after merging PR #6 on September 19, 2026. The target is the existing private HTTPS endpoint
`https://factory-pilot.tailb6a4be.ts.net`; its historical hostname does not imply
pilot mode after cutover. `/version` must report `production` and the PILOT
banner must be absent.

Production uses `compose.production.yaml`, an explicitly provisioned external
local Docker data volume, `/backups/production` on the separate NAS, and the
Mac production operator secret. The earlier synthetic and copied-data pilot
volumes and backup directories remain recovery artifacts and are not merged.
Production machine credentials, IDs, reports, verifications and idempotency
receipts are preserved by the final snapshot.

The final transfer occurs only after the Mac LaunchAgent is disabled and stopped.
The frozen source and manifest remain under the private Factory cutover directory
on the Mac. The transferred database must pass manifest verification before the
production server starts. Client URL changes occur after readiness succeeds.
Both onboarded machines use remote mode; the third machine remains deferred.

A dedicated `deploy/factory-production` release branch controls future production
promotions. The fixed production poller profile checks the production identity
and takes an authenticated NAS backup before requesting a changed release.
Development and main-branch pushes do not directly deploy. The pilot poller is
disabled during cutover and must not target the authoritative database.

After any new production reports arrive, do not restart the stale Mac writer or
restore its frozen snapshot as an automatic rollback. Preserve the new Dokploy
state and reconcile newer work before a deliberate recovery. The Mac Factory
service stays disabled; T3 on the Mac continues running independently.

Human acceptance requires phone access, the compact T3/WS indicators, a report
review/verification, and inspection of production backups. Agent evidence does
not record human acceptance.
