# 10. Data Models and State Files

This chapter documents the main persisted files and runtime-shaped data models in the repository. The goal is not just to list files. The goal is to explain which file is authoritative for which kind of truth, which files are safe to edit manually, and which services normalize each shape.

The key maintenance question is:

> when I see JSON on disk, is it a source of truth, a compatibility cache, an operator preference store, or a volatile runtime artifact?

That distinction matters a lot in this repo.

## 1) Runtime Directory Overview

Common persisted files include:

- `runtime/system/config.json`
- `runtime/system/oauth.vault.json`
- `runtime/audio/audio.config.json`
- `runtime/audio/audio.profiles.json`
- `runtime/audio/audio.reactivity-map.json`
- `runtime/audio/app-isolation-locks.json`
- `runtime/live/profiles.json`
- `runtime/live/compat.state.json`
- `runtime/fixtures/fixtures.json`
- `runtime/logs/*`

There are also mod-local files under `mods/<mod>/` and `.runtime/` folders under mods.

## 2) The Most Important Distinction: Config vs State vs Vault vs Logs

### Config files

Store operator-chosen settings that define behavior.

Examples:

- `runtime/system/config.json`
- `runtime/audio/audio.config.json`
- `mods/<mod>/config.json`

### State files

Store ongoing or historical working state that should survive restart.

Examples:

- `runtime/live/compat.state.json`
- `runtime/live/profiles.json`
- `mods/<mod>/state.json`

### Vault or secret-bearing files

Store tokens or sensitive runtime artifacts that should not be treated like casual config.

Examples:

- `runtime/system/oauth.vault.json`
- `mods/song-request-mod/.runtime/twitch-oauth.vault.json`
- runtime-generated overlay access token storage

### Logs

Store operational evidence, not source-of-truth behavior configuration.

Examples:

- `runtime/logs/startup-latest.log`
- launcher/browser logs

If you keep these categories separate in your head, it becomes much easier to know which code should own each file.

## 3) Audio Runtime Shapes

### Audio config

`runtime/audio/audio.config.json` is the main persisted operator surface for audio behavior.

Representative fields include:

```json
{
  "inputBackend": "auto",
  "ffmpegAppIsolationEnabled": true,
  "ffmpegAppIsolationPrimaryApp": "spotify.exe",
  "ffmpegAppIsolationFallbackApp": "chrome.exe",
  "desktopOutputDeviceName": "Speakers (Realtek Audio)",
  "ffmpegInputDevice": "virtual-audio-capturer"
}
```

What this file is for:

- capture backend choice
- device naming
- app-isolation target preferences
- operator runtime options that should survive restart

What this file is *not* for:

- one-shot request metadata such as “restart now”
- volatile runtime status
- raw telemetry

Those transient command values should stay in request payloads or runtime memory.

### Audio profiles

`runtime/audio/audio.profiles.json` stores named operator presets. The point of profiles is to preserve reusable setups, not just current config.

### App-isolation locks

`runtime/audio/app-isolation-locks.json` stores manual source-to-capture-token overrides.

Representative shape:

```json
{
  "locks": {
    "spotify": "spotify"
  },
  "updatedAt": 1770000000000
}
```

This file matters when app isolation appears to pick the wrong process. It is one of the first files or APIs to inspect.

## 4) LIVE Compatibility Shapes

### `runtime/live/compat.state.json`

This is one of the most important persisted files in the repo.

It stores the compatibility-facing operator intent that backs routes like:

- `/rave/live/compatibility`
- `/rave/live/trigger-matrix`
- `/rave/live/sync-groups`

Typical branches include:

- scene intent or lock
- scene filter state
- runtime tuning
- sync groups
- overclock compatibility state
- palette or fixture override payloads

The key conceptual rule is:

> this file stores operator intent and compatibility state, not the engine's live tick-by-tick internal state

### `runtime/live/profiles.json`

Stores named LIVE profiles used by save, load, and delete profile endpoints.

The practical meaning of this file is:

- reusable show-ready snapshots
- operator-selected stored layouts
- profile-based reapplication of compatibility state

## 5) System Config and OAuth Shapes

### `runtime/system/config.json`

Stores system-level settings such as:

- browser auto-launch
- update behavior
- gateway or safe-internet related preferences
- system UI/operator-level options

### `runtime/system/oauth.vault.json`

Stores the server-side OAuth vault model used by the System OAuth service stack.

Important principle:

- this file is not casual config
- it belongs to the system OAuth service and its submodules
- UI code should treat it through routes and service contracts, not as an editable document

## 6) Fixtures and Hardware State

### `runtime/fixtures/fixtures.json`

Stores configured fixture data and routing-related hardware metadata.

Because fixtures touch real external devices, this file is especially important to normalize carefully. A malformed fixture record can have visible runtime effects immediately.

## 7) Mods Platform Data

### `mods/mods.config.json`

Platform-level mod enablement and ordering:

```json
{
  "enabled": ["song-request-mod"],
  "order": ["song-request-mod"],
  "disabled": []
}
```

This file answers:

- which mods should load
- in which order hook fan-out should occur

### Mod-local config and state

For each mod folder, typical patterns include:

- `config.json`: operator policy and integration settings
- `state.json`: working persistent state
- `.runtime/*`: volatile or sensitive artifacts

This split is especially visible in the song-request mod.

## 8) Song Request Mod State Highlights

The song-request mod's `state.json` and `.runtime` data are worth understanding because they show how a complex mod uses persistence correctly.

Key concepts:

- queue rows are persistent working state
- history is append-oriented and can be paginated in the UI
- player actions are coordination state between server and browser bridge
- overlay tokens and OAuth artifacts belong in runtime or vault-like storage, not plain config

This is a good model for other sophisticated mods.

## 9) Logs and Diagnostic Files

`runtime/logs/` stores:

- startup diagnostics
- launcher/browser open diagnostics
- other operational traces

These files are not configuration and should not be treated as if editing them changes runtime behavior. Their job is to explain what happened, not define what should happen.

## 10) Safe Editing Rules for Persisted Files

Use these rules strictly:

1. prefer route APIs over manual file edits
2. avoid editing active runtime files while the process is running unless the owning service explicitly supports hot reload
3. when adding fields, add normalization defaults in the owning service
4. keep secrets and tokens out of plaintext config whenever possible
5. do not persist transient command metadata into long-term config files

These rules exist because this repo normalizes many files on load. Manual edits that bypass that normalization are easy ways to create confusing bugs.

## 11) Where Normalization Happens in Code

- audio config and profiles: `src/domains/audio/audio-runtime.service.js`
- live compatibility state: `src/domains/live/live-compat.service.js`
- system config: `src/domains/system/system-config.service.js`
- system OAuth vault and reconciliation: `src/domains/system/system-oauth.*.js`
- mod platform config: `src/domains/mods/mod-loader.port.js`
- song-request mod config and state: `mods/song-request-mod/index.js`

When you add a field to a persisted shape, this is the list to consult first.

## 12) The Source-of-Truth Rule

The final rule for this chapter is:

> every persisted file should have one clearly understood owner service

If you find yourself thinking “multiple files probably all kind of control this,” stop and trace which service actually normalizes and writes the state. That is how you avoid accidental persistence bugs in this repo.
