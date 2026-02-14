# HTTP RGB Brand Mod

Reference adapter mod for adding a non-native fixture brand without changing core transport code.

Optional support: https://ko-fi.com/namesroby

## What This Mod Demonstrates

- custom fixture brand id: `http-rgb`
- fixture discovery via `api.getFixturesBy(...)`
- intent zone resolution via `api.getIntentZones(...)`
- intent-to-RGB mapping from Hue/WiZ/Twitch intents
- threshold gating via `api.createStateGate(...)`
- HTTP adapter send path with optional auth header/token

## Files

- `mod.json`: manifest
- `config.json`: mod defaults and optional static targets
- `index.js`: runtime implementation

## Fixture Contract

Add fixtures in `core/fixtures.config.json` with:

Required:
- `id`
- `brand`: `http-rgb`
- `zone`
- `endpoint`

Optional:
- `enabled`
- `engineEnabled`
- `twitchEnabled`
- `customEnabled`
- `token`
- `method`
- `headers` (object)
- `minIntervalMs`
- `minColorDelta`
- `minDimmingDelta`

Example:

```json
{
  "id": "desk-strip-1",
  "brand": "http-rgb",
  "zone": "desk",
  "enabled": true,
  "engineEnabled": true,
  "twitchEnabled": true,
  "customEnabled": false,
  "endpoint": "http://192.168.x.x:8080/color",
  "token": "replace-with-device-token",
  "minIntervalMs": 120,
  "minColorDelta": 10,
  "minDimmingDelta": 4
}
```

## Threshold Behavior

The state gate avoids over-sending updates by enforcing:
- minimum interval between sends
- minimum RGB channel delta
- minimum dimming delta

Per-target values can override global defaults from `config.json`.

## HTTP Payload Shape

Sends JSON similar to:

```json
{
  "on": true,
  "rgb": { "r": 255, "g": 120, "b": 20 },
  "dimming": 45,
  "source": "ravelink-bridge",
  "fixtureBrand": "http-rgb",
  "fixtureId": "desk-strip-1",
  "zone": "desk",
  "intentType": "WIZ_PULSE"
}
```

Adjust your target device firmware/service to accept this payload, or modify mapping in `index.js`.

## API Endpoints

- `GET /mods/http-rgb-brand-mod/status`
- `POST /mods/http-rgb-brand-mod/reload`
- `POST /mods/http-rgb-brand-mod/test`

Example:

```powershell
Invoke-RestMethod http://127.0.0.1:5050/mods/http-rgb-brand-mod/status
Invoke-RestMethod -Method Post http://127.0.0.1:5050/mods/http-rgb-brand-mod/reload
Invoke-RestMethod -Method Post http://127.0.0.1:5050/mods/http-rgb-brand-mod/test -Body '{"id":"desk-strip-1","r":255,"g":120,"b":20,"dimming":45}' -ContentType "application/json"
```

## Using This As A Template

For another brand, clone this folder and update:
- manifest id/name/version
- brand id
- adapter send method (HTTP/UDP/serial/etc.)
- intent mapping and thresholds
- per-target schema/validation

Keep the same pattern: fixture lookup -> zone filter -> map -> gate -> send.
