# RaveLink Bridge v1.6.3

Polish release focused on reliability, recovery, and a cleaner public package.

## Highlights

- improves Philips Hue reliability by sticking with the connection path that works and falling back more cleanly when Hue Entertainment is unstable
- reduces repeated Hue handshake and fallback warning spam so startup and runtime logs are easier to read
- improves Twitch sign-in recovery so bridge-linked features reconnect more reliably after approval, restart, or credential refresh
- updates the bundled network client to address newly published Axios security advisories
- includes a public-safe `mods/` dock in the repo and packaged release so optional mods can be added or removed without manual folder setup

## Public Package Note

The public `v1.6.3` release should ship:

- the base bridge app
- the tracked `mods/README.md` dock guide
- a safe empty `mods/mods.config.json`

It should not ship:

- `mods/song-request-mod`
- `mods/mods.local.config.json`
- local runtime state, vaults, or other machine-specific files
