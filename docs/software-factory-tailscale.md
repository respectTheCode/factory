# Software Factory over Tailscale

Factory listens on `127.0.0.1:3000`. Tailscale Serve is the only intended mobile
entry point; do not use Funnel or expose port 3000 directly.

## Start the local service

```bash
bun run start
```

Confirm the listener is loopback-only:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

The output should name `127.0.0.1:3000`, not `*:3000`.

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
