# Dev Feature Probe Mod

Purpose: exercise new developer-facing surfaces from one place.

This mod is intentionally diagnostic/stress-oriented and includes:
- Runtime hooks + HTTP actions in `index.js`
- Packaged UI panel in `ui/index.html` (hosted under the `MODS` tab/workbench and its auto-generated top tab)

## What It Tests

- Standalone custom fixture APIs (`getStandaloneFixtures`, `applyStandaloneState`)
- Twitch color prefix APIs (`getColorCommandConfig`, `setColorCommandConfig`)
- Mod UI hosting (`/mods/ui/catalog`, `/mods-ui/:modId/*`)
- Overclock routes (safe tiers + manual unsafe tiers)

## Enable And Open

1. In `Mods -> Mod Center`, enable `dev-feature-probe-mod`.
2. Click `APPLY HOTSWAP`.
3. Open `MODS -> MOD UI WORKBENCH` and select `Dev Feature Probe`.
4. Or click the auto-generated top tab for this mod UI (no settings-cog toggle required).

## HTTP Actions

Route format:
- `GET|POST /mods/dev-feature-probe-mod/:action`

Actions:
- `status`
- `standalone_list`
- `standalone_flash`
- `standalone_static`
- `standalone_audio`
- `standalone_apply` (body: `{ "state": { ... }, "id": "fixture-id" }`)
- `standalone_batch` (body: `{ "state": { ... }, "ids": ["fixture-1","fixture-2"] }`)
- `prefix_get`
- `prefix_set` (body patch accepted by `setColorCommandConfig`)
- `prefix_sync`
- `prefix_reset`
- `selftest`

Fixture targeting:
- pass `id` or `fixtureId` in query/body for targeted standalone actions
- without an id, actions fall back to the first custom-enabled Hue/WiZ fixture
