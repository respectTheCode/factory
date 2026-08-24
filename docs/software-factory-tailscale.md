# Software Factory over Tailscale

Factory listens on `127.0.0.1:3000` by default. Tailscale Serve is the intended mobile
entry point. If local agents need direct HTTP/WebSocket access, the operator can explicitly bind
the server to all local IPv4 interfaces; do not use Funnel or expose the port beyond a trusted
network.

## Start the local service

```bash
bun run start
```

Confirm the listener is loopback-only:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

The output should name `127.0.0.1:3000`, not `*:3000`.

## Optional local-agent access

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

Use this only on a trusted network and keep the macOS firewall/network boundary in place. The
server has no separate authentication layer; anyone who can reach the port can use its API.

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

- Local listener is loopback-only.
- Phone reaches the dashboard only while its Tailscale connection is active.
- Dashboard establishes the tRPC WebSocket and shows `Connected`.
- Dropping Tailscale changes the UI to `Disconnected` and disables mutations.
- Reconnecting refreshes authoritative data before edits are enabled.
- A fresh mutation succeeds after reconnect.
- The public internet cannot reach Factory.

As of 2026-08-23, this host's Tailscale client is running and has a MagicDNS
name, but no Serve configuration is installed. The Serve and real-phone checks
remain an operator step.
