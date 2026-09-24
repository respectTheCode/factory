# T3 connection diagnosis — September 24, 2026

Resolved later that day: Kevin enabled network access and restarted T3. A fresh
production read at `2026-09-24T13:03:33.416Z` reported `connected`, with that same
last-successful-fetch timestamp. The earlier observations below describe the
failure before the restart.

Factory work: T-46 / ST-192. Observations below were collected around 12:12–12:16 UTC.

The production Factory service answered its authenticated doctor check, reporting
revision `65fdd82e08684a0f26a2dec1953a8e7b8e0258cd`. Its `legacy` source
(`mac-mini`, label `Mac mini`) reported `unreachable`, with the last successful
fetch at `2026-09-23T20:21:13.714Z`.

The production registry at `/run/factory-t3/sources.json` points this source to
`http://192.168.6.100:3773`. On that Mac, `lsof` showed the T3 backend listening
only on `127.0.0.1:3773`. An HTTP request to the LAN address was refused; the
loopback address returned HTTP 200. Factory's read-only reader, using its existing
local token file, successfully read 15 projects and 627 threads over loopback.
No credential values were printed or copied into this report.

This proves the observed LAN listener mismatch. The saved T3 desktop setting in
`~/.t3/userdata/desktop-settings.json` was already
`"serverExposureMode": "network-accessible"`, despite the running listener being
local-only. The reason the running backend diverged from that saved setting has
not been established. The installed desktop code supports a local-only fallback
when no advertised network host is available and relaunches for some exposure
changes; neither is proof of what happened in this instance.

Kevin chose to keep active coding sessions running and restart T3 later. No T3
restart, listener change, Factory production configuration change, or deployment
was performed during this diagnosis.

At a safe restart window:

1. Restart T3 and confirm its network-access setting is enabled.
2. Check that port 3773 accepts traffic on the Mac's LAN address.
3. Run `factory project t3-status --project-id
   edf8735c-d17f-4708-addd-1e80f718086b --json` using the configured remote client.
4. Require a fresh `connected` result and successful-fetch timestamp before
   considering connectivity restored. A saved setting or loopback success alone
   is insufficient.

The new Mac mini is `192.168.6.50`, available through SSH alias `m5-agent-mini`
as user `agent`. Port 3773 initially refused connections. After Kevin supplied
the configured SSH alias, a fresh inspection found T3 Code (Alpha) listening on
`*:3773`, and the LAN endpoint returned HTTP 200. No existing Factory credential
directory or installed Factory command was found in that noninteractive SSH
check. A dedicated T3 read-only credential is still required for onboarding.
It must receive a separate stable source identity; do not repoint `legacy` to
the new machine. HTTP 200 is reachability evidence, not authenticated reader
verification.
