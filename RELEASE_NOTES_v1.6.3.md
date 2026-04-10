# RaveLink Bridge v1.6.3

Short bug-fix release focused on bridge reliability and packaging polish.

## Highlights

- fixes System-first Twitch OAuth behavior so compatible docked mods can prefer the bridge-owned OAuth lane instead of trying to own credentials locally
- improves bridge-side Helix readiness recovery when OAuth approval completes or credentials need to be re-hydrated
- restores a public-safe `mods/` dock in the source tree and packaged release so optional mods can be hot-loaded or swapped without manual folder setup
- keeps the song-request mod excluded from the public repo and packaged public release

## Public Package Note

The public `v1.6.3` release should ship:

- the base bridge app
- the tracked `mods/README.md` dock guide
- a safe empty `mods/mods.config.json`

It should not ship:

- `mods/song-request-mod`
- `mods/mods.local.config.json`
- local runtime state, vaults, or other machine-specific files
