# Factory on Dokploy

ST-162 packages Factory and provides an isolated deployment for testing. The Mac
service remains authoritative. This packaging test uses synthetic records and
separate credentials; it does not satisfy ST-164's copied-data, recovery, and
multi-machine pilot gates or authorize ST-165's production cutover.

## Verified infrastructure

Read through `dokploy_home` on 2026-09-17:

- Dokploy v0.30.2 on `dokploy`, `192.168.5.50`, Linux x86_64.
- One ready Docker Swarm manager, Docker 29.6.0, 10 CPUs, 31.3 GiB RAM.
- At inspection: about 15.9 GiB unused RAM and 51.7 GiB disk free.
- GitHub provider can list `respectTheCode/factory` and its branches. GitHub
  remains the canonical repository; no Gitea migration is necessary.
- MinIO destination `dokploy` at `http://192.168.5.16:9000` is configured, but
  write access, physical separation, scheduled backups and recovery remain
  ST-163 work. No Dokploy notification destinations were configured.

## Isolation and access

The Dokploy project is **Factory**, environment **pilot**, Compose service
**factory-pilot** (`U_gEyIpCTzmJQ7iMoUQLU`, app name
`factory-pilot-st162-ewgahg`). It must not share the production database,
operator secret, machine credentials, or client environment files.

The pilot URL is `https://factory-pilot.tailb6a4be.ts.net` (Tailscale required).
The service publishes HTTP only on `192.168.5.50:3101`. A dedicated Tailscale
container supplies private HTTPS and WebSocket forwarding to Factory in the
same network namespace. Its persistent state is separate from Factory data.
There is no Dokploy domain, Traefik router, Cloudflare tunnel route, or Funnel.
The existing Mac Tailscale Serve configuration is unchanged.

The Tailscale container uses userspace networking and no host Docker socket.
Its initial interactive enrollment requires a tailnet administrator; the
container logs supply the login URL. Authentication state persists across
recreation. Never commit authentication keys or node state.

The login screen and dashboard display **PILOT — isolated test data**. The
operator secret is provisioned as a Dokploy file mount, separate from the
repository. Do not put a secret value in this runbook or a Factory report.

## Release boundaries

Use one Factory replica with stop-before-start replacement. Never enable
rolling overlap or allow a second writer against the same SQLite file. A
replacement preserves the stable local data volume; never select fresh volumes
on a routine redeploy. Bind mount or local-volume storage must be verified to
be local disk, not NFS, before production.

The runtime must use a prebuilt image with its source revision recorded in
`/version`. Build with the lockfile and pinned Bun base image. The production
database must already exist and validate; normal startup must not seed or
silently create a database. Development and pilot initialization are explicit
separate actions.

GitHub access is independent of deployment approval. The pilot tracks the
dedicated `deploy/factory-pilot` branch. Advance that branch only to a reviewed,
tested commit. Image construction runs typecheck, web compilation and focused
runtime/authentication/write-safety tests before a new runtime image can be
started. Failed builds must leave the existing container running.

The image build derives its revision from an allowlist of Git HEAD/ref metadata
in the fetched checkout. Git configuration, hooks and objects do not enter the
build context or runtime image. Leave `FACTORY_REVISION` unset in Dokploy so
new code cannot be labeled with an old environment value. The running image ID
and `/version` together identify the release; the local `current` tag alone
does not. Dokploy prefixes its custom command with `docker`:

```sh
compose -p factory-pilot-st162-ewgahg -f compose.pilot.yaml up -d --build --remove-orphans
```

Do not enable automatic deployment on the development or production branch.
Production promotion requires ST-163 recovery evidence, ST-164 pilot evidence
and the ST-165 handoff. This build gate is not a claim that GitHub required
checks or branch protection are configured.

## First pilot initialization

Create the Dokploy file mounts `tailscale/serve.json` and
`secrets/operator-secret`. The former is a Tailscale Serve JSON configuration
forwarding HTTPS port 443 to `http://127.0.0.1:3000`, with Funnel disabled.
The latter contains the separately generated pilot operator secret.

Use `compose.pilot.yaml` with `FACTORY_BIND_IP=192.168.5.50` and
`FACTORY_PUBLIC_PORT=3101`. Set the custom command temporarily to:

```sh
compose -p factory-pilot-st162-ewgahg -f compose.pilot.yaml run --rm --build pilot-init
```

Run it exactly once against the new `factory-pilot-st162-data` volume. The
initializer requires pilot mode and refuses existing database/token files.
It creates synthetic projects/tasks and a scoped `pilot-agent` credential,
writing the token to `/data/pilot-agent-token` without logging its value.
Then restore the normal deployment command above. The initializer remains
outside normal service startup and redeployment.

The local pilot secret files are in
`~/Library/Application Support/Factory/pilot-st162/`, with owner-only access.
Use the dedicated token for pilot CLI checks. Leave
`~/.config/factory/env`, installed agent hooks and the production credential
files untouched.

## Human test

Once the deployment is marked ready in the handoff:

1. Connect the phone to the tailnet and open the pilot HTTPS URL.
2. Confirm the pilot banner before entering the pilot operator secret.
3. Sign in, open the synthetic Factory Pilot project, and check `Connected`.
4. Edit a test task, reload, and confirm persistence. Review and accept the
   synthetic test report in the pilot only.
5. Disconnect/reconnect Tailscale and confirm the dashboard reconnects and
   refreshes before allowing further edits.

Acceptance of ST-162 is recorded in the authoritative Mac dashboard, not in
the synthetic pilot. No production clients should switch to this test URL.

## Initial deployment evidence

On 2026-09-17, commit `b38236b01ba151470ca0a2d8bc2a0f2c5e7ae132` built
and started successfully on Dokploy. Local validation passed typecheck and
98 transport, persistence, and CLI tests; the Linux amd64 image also passed
its build gate and disposable non-root restart smoke test.

The live LAN check passed health/readiness/static assets, human sign-in,
authenticated WebSocket queries/subscriptions/reconnection, machine-scoped
reporting, duplicate-request idempotency, and durable history read-back.
Unauthenticated reads and machine verification attempts were denied. The
synthetic report remains unverified for the human test.

The data volume `factory-pilot-st162-data` uses Docker's local driver with no
remote filesystem options. The service runs as `bun`, with one Factory
container. The direct GitHub webhook could not reach private Dokploy. Commit
`dc3c9c7caa1ed0f164eaf680648aa42e62b21a5b` was deployed manually to verify
container replacement: the same synthetic report survived, HTTPS/WSS worked,
and HTTPS login issued a Secure cookie. An internal polling schedule supplies
automatic deployment as described below.

## Automatic deployment while Dokploy stays private

Schedule: **Factory pilot GitHub polling** (`jqWAnw5IkHbM37rynMkhm`),
cron `*/5 * * * *`, timezone `America/Indiana/Indianapolis`.

GitHub cannot deliver inbound webhooks to the private Dokploy endpoint. The
repository stays on GitHub. A Dokploy server schedule runs every five minutes
and checks the public `deploy/factory-pilot` Git ref against the pilot's
`/version`. A matching revision is a no-op. A changed revision invokes the
dedicated Compose webhook from inside the lab, retaining Dokploy's normal
build and deployment history.

The schedule executes `scripts/poll-pilot.mjs` from the managed checkout. Its
`FACTORY_PILOT_WEBHOOK_FILE` points to the separately provisioned
`files/secrets/pilot-webhook` file; never put that URL in Git or logs. It grants
only the ability to queue this pilot deployment. The application does not mount
this file.

The schedule records the last requested commit in its own working directory.
A failed build is not retried on every tick: inspect the Dokploy deployment
error and publish a fixed release commit, or perform an explicit manual
redeployment. An unavailable or unexpected pilot identity or a failed GitHub read stops
the check without deploying. Only advance the release branch to reviewed
commits; production is outside this schedule.

Reference: [Dokploy auto-deploy](https://docs.dokploy.com/docs/core/auto-deploy).
The polling adapter uses the Compose webhook contract verified in
[Dokploy v0.30.2](https://github.com/Dokploy/dokploy/blob/v0.30.2/apps/dokploy/pages/api/deploy/compose/%5BrefreshToken%5D.ts).

The installed schedule's manual no-change check passed on revision
`55d02bac9b3bc861da0cc7260ecfa88432e8a53a`, without queuing a deployment.
This documentation update is the changed-revision test for the enabled timer.
