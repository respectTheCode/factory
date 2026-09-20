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

## Cutover evidence — September 20, 2026 UTC

Production became ready at 01:34 UTC on revision
`cd024086307cd676d2a0127e40f91e14d850e83e`, deployed from
`deploy/factory-production`. Dokploy deployment ID:
`oANQz6l67Vj5WInUY3mX8`. Configuration and handoff are tracked in PR #7.

The Mac LaunchAgent `com.app-press.factory` was disabled and stopped before the
final snapshot. No process held its database open. Its original database is now
read-only (`0444`), and its service remains disabled. T3 remains running.
The private recovery directory is
`~/Library/Application Support/Factory/cutover-st165-20260920/`; it contains
`factory-final.sqlite`, its manifest, and the prior client/service configuration.
The Ubuntu prior client configuration and binary are preserved under
`~/.config/factory/cutover-st165-20260920/`.

The transferred snapshot passed integrity, content and protected-table manifest
verification in the new local volume `factory-production-data-20260920` before
server startup. Its SHA-256 is
`d2812bd7ff567baf081e0432a8057bff564569a7575d7876c92532f309b76178`.
It preserved 6 Projects, 39 Tasks, 171 Subtasks, 422 Status Reports and 42
Verifications, plus the other collections, credentials, sessions and idempotency
receipts. Pilot-only changes were not imported.

Both clients and their installed Codex/Claude skill directories were switched and
checked. Mac uses the private HTTPS endpoint; Ubuntu uses
`http://192.168.5.50:3101`. Each loads `~/.config/factory/env` and its own preserved
machine credential. Actual production reports were submitted from each machine:

- Mac: `12a50346-1bfa-4edb-8bfa-1570c34186cf`.
- Ubuntu: `46df1949-5f5f-47e8-a321-16898f21de4c`.

Both reports were read back from both clients after container restart. Existing
production credentials remained valid, and the copied-pilot credential was
rejected. Authenticated WSS project snapshots passed before and after restart.
Human-authenticated T3 status reported both `legacy` and `ubuntu` connected.
Ubuntu currently has no T3 projects or sessions, so its Project matching remains
`unmatched`. This cutover branch also had no matching current session; no
association was invented. The third agent machine remains deferred.
Ubuntu's installer could not find a standalone Codex CLI to establish hook trust;
its remote Factory CLI and skill installation passed, but fresh-session hook
execution there has not been verified.

The first automatic scheduled production NAS backup is
`b-20260920T013405.602Z-2db1bda5`. The production pre-deployment gate created
`b-20260920T013525.193Z-c3456b1e`. Both were verified; backup status remained
configured, non-stale and error-free after restart. Scheduling is every 30 minutes,
retaining the union of 336 recent scheduled copies and 30 daily copies.
Pre-deployment/manual safety copies follow the documented separate retention
policy. The earlier ST-164 isolated restore rehearsal remains the restore proof;
no restore over the authoritative production database was performed.

The production poller returned a no-op for the deployed SHA in Dokploy's runtime.
Its enabled five-minute schedule now explicitly selects the production profile.
Only promotions to `deploy/factory-production` trigger deployment; pushes to
`main` do not. The backup gate must pass before changed-release requests.
The image build passed 78 release tests; the production Compose/poller checks
passed 12 tests and typecheck. The skill contract passed 4 tests.

Phone/PWA sign-in, UI review and human acceptance remain outstanding. The login
uses the existing Mac production operator secret, stored at
`~/Library/Application Support/Factory/secrets/operator-secret`, rather than the
former pilot secret. The historical `factory-pilot` hostname remains intentional.
