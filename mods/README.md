# Mods Dock

This folder is intentionally kept in the public repo and packaged release so optional mods can be docked, hot-loaded, removed, or swapped without creating the directory structure by hand first.

## Public Boundary

This public repository does not bundle local-only mods.

That includes the current song-request mod, which lives as a separate local/private mod codebase and should not be published from this repo or shipped inside the public release archive.

## Files You Should Expect Here

```text
mods/
  README.md
  mods.config.json
  mods.local.config.json   <- optional local override, ignored from source control
  <mod-id>/
    mod.json
    index.js
    ...
```

## Config Files

- `mods.config.json` is the tracked public-safe baseline. It ships empty by default.
- `mods.local.config.json` is the optional local override for real installs with local-only mods. It is ignored from source control and takes precedence when present.

## Runtime Basics

1. Mods are discovered from `mods/*/mod.json`.
2. The loader reads `mods.local.config.json` first when it exists, otherwise it uses `mods.config.json`.
3. Enabled mods load in sandbox VM runtimes.
4. Hooks and actions are invoked through `/mods/*` routes.
5. Optional mod UIs are served from `/mods-ui/:modId/*`.

## Minimal Mod Example

`mod.json`

```json
{
  "id": "hello-mod",
  "name": "Hello Mod",
  "version": "0.1.0",
  "main": "index.js"
}
```

## Platform Endpoints

- `GET /mods`
- `POST /mods/config`
- `POST /mods/reload`
- `GET /mods/runtime`
- `GET /mods/:modId/:action`
- `POST /mods/:modId/:action`
- `GET /mods-ui/:modId/`
