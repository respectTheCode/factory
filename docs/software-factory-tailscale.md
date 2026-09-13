# Software Factory over Tailscale

Factory listens on `127.0.0.1:3000` by default. Tailscale Serve is the intended mobile
entry point. If local agents need direct HTTP/WebSocket access, the operator can explicitly bind
the server to all local IPv4 interfaces; do not use Funnel or expose the port beyond a trusted
network.

## Run the durable user service

Deploy the current checkout as a stable snapshot and load its macOS LaunchAgent:

```bash
bun run service:deploy
```

The LaunchAgent `com.app-press.factory` starts at login, restarts after an unexpected exit,
binds `0.0.0.0:3000` for the trusted LAN clients, and continues to use the checkout's existing
`factory.sqlite`. Its executable and web assets are copied to
`~/Library/Application Support/Factory/current`, so edits in the checkout cannot affect the
running service until the deploy command is run again. Logs are written under
`~/Library/Logs/Factory/`.

Inspect the service and its listener:

```bash
launchctl print gui/$(id -u)/com.app-press.factory
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Each deploy keeps its prior release under `~/Library/Application Support/Factory/releases/`.
To roll back, repoint the `current` symlink to the prior release and restart the LaunchAgent.

## Test checkout changes on port 3001

Keep the user service on port 3000 and start the mutable checkout separately:

```bash
bun run dev
```

This serves the checkout on `http://127.0.0.1:3001` and uses the same durable Factory database,
whose adapter refreshes before each read and write. For data-isolated testing, override the
database as well:

```bash
FACTORY_DB=factory-dev.sqlite bun run dev
```

Deploy again only after the checkout has passed its intended checks.

## Enable private GitHub PR and Actions reads

The GitHub integration is read-only. For an interactive development server, provide a
server-process token when starting Factory:

```bash
export GITHUB_TOKEN
FACTORY_PORT=3001 bun run start
```

For the stable LaunchAgent, provision the token into the macOS login Keychain under the service
name `com.app-press.factory.github-token` and reload the agent. The deployed service launcher
reads that item at process start and exports it only to the Factory server process; the plist
contains no credential and the token is not stored in the repository, Factory database, browser,
or agent output. Use a token with the minimum read access to the private repositories and Actions
needed by the dashboard. If the Keychain item is absent, the dashboard labels GitHub as not
configured and keeps Factory state usable.

To provision or rotate the item from an already authenticated GitHub CLI session without printing
the token:

```bash
github_token="$(gh auth token)"
security add-generic-password -U \
  -s "com.app-press.factory.github-token" \
  -a "$(id -un)" \
  -w "${github_token}"
unset github_token
bun run service:deploy
```

## Start an interactive port-3000 server

```bash
bun run start
```

Confirm the listener is loopback-only:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

The output should name `127.0.0.1:3000`, not `*:3000`.

## Optional interactive local-agent access

Start the server on the local network only when the agents need to call the HTTP or WebSocket
API directly:

```bash
FACTORY_HOST=0.0.0.0 bun run start
```

This keeps `127.0.0.1:3000` available for Tailscale Serve while also listening on the host's
IPv4 interfaces. Confirm the LAN address and listener before sharing it:

```bash
ipconfig getifaddr en8
lsof -nP -iTCP:3000 -sTCP:LISTEN
curl http://<lan-address>:3000/
```

Use this only on a trusted network and keep the macOS firewall/network boundary in place. Reads,
reports and planning edits are not yet authenticated; anyone who can reach the port can use
them until the T-37 remote API lands. Verification is the exception: it requires the human
session described next.

## Enable human verification

Verifying a status report requires a signed-in human session. The server reads
`FACTORY_OPERATOR_NAME` and `FACTORY_OPERATOR_SECRET_FILE` (an absolute path to a file holding
only the operator secret). Setting one without the other, or pointing at a missing or empty file,
stops the server at startup. With neither set, the server starts with verification disabled and
logs one warning; the dashboard then shows "Sign in to verify" and no sign-in succeeds.

The deployed LaunchAgent launcher exports the pair automatically when
`~/Library/Application Support/Factory/secrets/operator-secret` exists, using the operator name
`kevin` unless `FACTORY_OPERATOR_NAME` is set in the plist environment. Provision the secret
without echoing it:

```bash
install -d -m 0700 "$HOME/Library/Application Support/Factory/secrets"
umask 077
head -c 32 /dev/urandom | base64 > "$HOME/Library/Application Support/Factory/secrets/operator-secret"
bun run service:deploy
```

Sign in from the dashboard header with that secret. The browser receives an `HttpOnly`,
`SameSite=Strict` cookie (`Secure` behind HTTPS) that stays valid for thirty days and survives
service restarts; sign out from the header to revoke it. Five failed attempts from one address
within a minute pause sign-in for that address. The verifier recorded on each verification is the
configured operator name, never a value the browser supplies.

Browser requests to `/session/login`, `/session/logout` and the `/trpc` WebSocket must carry an
`Origin` that matches the server's own origin or one listed in `FACTORY_ALLOWED_ORIGINS`
(comma-separated). The server honors `X-Forwarded-Proto` and `X-Forwarded-Host` when deriving its
own origin, so place it only behind a proxy you control (Tailscale Serve here). Requests without
an `Origin`, such as the CLI, pass the check and are authenticated by cookie only.

## Configure private HTTPS access

Run this on the Factory host after confirming the local service is healthy:

```bash
tailscale serve --bg 3000
tailscale serve status
```

The private URL is the machine's MagicDNS name, for example:
`https://agents-mac-mini.<tailnet>.ts.net/`.

The reverse proxy must preserve WebSocket upgrades for `/trpc`. Open the URL
from a phone that is connected to the same tailnet and confirm the dashboard
shows `Connected`, then create a harmless test Project.

## Stop or inspect access

```bash
tailscale serve status --json
tailscale serve reset
```

`tailscale serve reset` is a deliberate access change: run it only when removing
Factory's private route. Never use `tailscale funnel` for Factory.

## Acceptance checks

- The durable user service listens on trusted LAN interfaces at port 3000; an interactive
  default server remains loopback-only.
- The checkout can listen on loopback port 3001 at the same time without displacing the
  durable service.
- Phone reaches the dashboard only while its Tailscale connection is active.
- Dashboard establishes the tRPC WebSocket and shows `Connected`.
- Dropping Tailscale changes the UI to `Disconnected` and disables mutations.
- Reconnecting refreshes authoritative data before edits are enabled.
- A fresh mutation succeeds after reconnect.
- The public internet cannot reach Factory.

As of 2026-08-23, this host's Tailscale client is running and has a MagicDNS
name, but no Serve configuration is installed. The Serve and real-phone checks
remain an operator step.
