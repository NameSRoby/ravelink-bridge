# 05. Mod Platform

This chapter explains how the RaveLink mod platform works as a runtime system: discovery, sandbox loading, hooks/actions contracts, HTTP dispatch, UI asset hosting, persistence patterns, docking, and security boundaries.

If you are working on the song-request mod specifically, read this chapter together with `16-song-request-player-widget-and-queue-deep-dive.md`. This chapter explains the platform. Chapter 16 explains what a large real mod looks like when it starts using a lot of the platform's power.

## Learning Outcomes

By the end of this chapter, you should be able to:

1. build a mod that loads predictably through the sandbox loader
2. implement hook and action handlers using the current envelope contract
3. expose HTTP actions and UI assets safely
4. choose config/state persistence patterns that survive restarts
5. understand how docking works without making the server depend on the mod

## 1. Platform Map

Core files:

- `src/domains/mods/mod-loader.port.js`
- `src/domains/mods/mod-sandbox.runtime.js`
- `src/domains/mods/hook-contract.js`
- `src/app/register-compat-routes.js` and `src/app/routes/compat/mods.compat.routes.js`
- `mods/mods.config.json`

Runtime flow:

1. loader scans `mods/*/mod.json`
2. loader merges discovery with `mods.config.json`
3. enabled mods are started in isolated VM sandboxes
4. hooks are fan-out invoked across loaded mods
5. HTTP actions route to mod action handlers
6. `/mods-ui/:modId/*` serves files from each mod UI mount directory

## 2. Mod Folder Contract

Minimum mod folder:

```text
mods/
  my-mod/
    mod.json
    index.js
```

Typical full mod:

```text
mods/
  my-mod/
    mod.json
    index.js
    config.json
    state.json
    ui/
      index.html
      app.js
      styles.css
```

`mod.json` example:

```json
{
  "id": "my-mod",
  "name": "My Mod",
  "version": "0.1.0",
  "description": "Example mod",
  "main": "index.js",
  "ui": {
    "entry": "ui/index.html",
    "title": "My Mod Control"
  }
}
```

The `ui` section is optional. A mod can be action-only, hook-only, or UI-backed.

## 3. Loader Lifecycle

The loader lifecycle is deterministic:

1. discover mod folders with valid `mod.json`
2. normalize IDs and paths
3. apply config (`enabled`, `order`, `disabled`)
4. stop old sandboxes on reload
5. start enabled sandboxes
6. invoke `onLoad`, then `onBoot`

Operational endpoints:

- `GET /mods`
- `GET /mods/config`
- `POST /mods/config`
- `POST /mods/reload`
- `GET /mods/runtime`
- `GET /mods/hooks`
- `POST /mods/hooks/:hook`
- `GET /mods/ui/catalog`

Representative config patch:

```json
{
  "enabled": ["music-request-engine"],
  "order": ["music-request-engine"],
  "disabled": [],
  "reload": true
}
```

### What reload actually means

`mod-loader.port.js` stops existing sandboxes, clears runtime state, re-discovers descriptors, reapplies config, then starts enabled sandboxes again. That means reload is a real runtime transition, not just a cache flush.

## 4. Sandbox Model

Mods execute in a Node VM with a restricted `require`.

Key properties:

- VM context with no unrestricted host access
- relative `require("./...")` limited to files inside the mod root
- built-ins and packages are allowlisted
- hook timeout: 1200ms
- action timeout: 15000ms

Default allowlists:

- built-ins: `path`, `url`, `util`, `fs`, `crypto`, `child_process`, `os`
- packages: `axios`, `playwright`

Representative restricted require logic from `mod-sandbox.runtime.js`:

```js
function restrictedRequire(request) {
  const token = String(request || "").trim();
  if (token.startsWith("./") || token.startsWith("../")) {
    const resolved = resolveScriptFile(path.dirname(normalizedPath), token);
    const safe = sanitizeScriptPath(modRoot, path.relative(modRoot, resolved));
    return evaluateModule(safe);
  }
  const packageToken = normalizePackageToken(token);
  if (packageToken && allowedPackages.has(packageToken)) {
    return require(token);
  }
  throw new Error(`require("${token}") is not allowed in sandbox`);
}
```

The important part is not just that it throws. The important part is that file containment is enforced before module evaluation.

## 5. Hooks Contract

Supported hooks (`src/domains/mods/hook-contract.js`):

- `onLoad`
- `onBoot`
- `onRaveStart`
- `onRaveStop`
- `onIntent`
- `onTelemetry`
- `onShutdown`
- `onUnload`
- `onHttp`

Modern envelope:

```js
async function onBoot({ payload, api }) {
  api.log("boot", payload);
  return { ok: true };
}
```

Legacy compatibility is still supported:

```js
async function onBoot(payload, api) {
  api.log("boot", payload);
}
```

The platform is deliberately tolerant here because older mods may still use the older calling style.

## 6. Actions Contract

Actions are looked up by normalized action token and called with the same envelope style:

```js
module.exports = {
  actions: {
    status: ({ payload, api }) => ({
      status: 200,
      body: { ok: true, mod: api.id, payloadEcho: payload }
    })
  }
};
```

Return shapes:

1. HTTP envelope passthrough:

```json
{
  "status": 200,
  "body": { "ok": true, "value": 123 }
}
```

2. Plain value, which the loader wraps into `{ ok: true, result: ... }`

The platform keeps this flexible so mods can choose between route-like explicit envelopes and simple value returns.

## 7. HTTP Action Flow

Path flow:

1. Express route receives request (`/mods/:modId/:action` or nested path)
2. route builds a payload map from params/query/body/headers/request metadata
3. loader checks mod existence and load state
4. sandbox invokes action handler
5. result is normalized back into HTTP

Base action routes:

- `GET /mods/:modId/:action`
- `POST /mods/:modId/:action`
- `ALL /mods/:modId/:action` legacy parity

Nested path example:

```http
POST /mods/my-mod/admin/policy/set
Content-Type: application/json

{"patch":{"enabled":true}}
```

This routing model lets a mod behave like a small application without making the core server aware of every action name.

## 8. UI Asset Serving

UI assets are served under `/mods-ui/:modId`.

Resolved route patterns:

- `/mods-ui/:modId`
- `/mods-ui/:modId/`
- `/mods-ui/:modId/*assetPath`

Loader protections:

- sanitized relative paths only
- resolution against the mod UI root only
- path traversal rejection
- `404` for missing assets

This matters because the mod UI host is effectively a mini static file server, and path containment bugs there would be serious.

## 9. Docking and Host Integration

The modern mod platform supports optional docking into host UI systems:

- onboarding step contribution
- theme synchronization
- widget bundling compatibility
- optional OAuth docking

The key architectural rule is:

the server must remain coherent if the mod is unloaded

That means a docked mod can contribute to host UX, but the host cannot require the mod to exist in order to remain functional.

This is why docking uses:

- explicit registries or `postMessage`
- best-effort feature detection
- graceful fallback when the mod is missing

instead of hardcoded assumptions.

## 10. Config and State Patterns

Use two persistence layers:

1. platform config: `mods/mods.config.json`
2. per-mod files: `config.json`, `state.json`, and optional `.runtime/*`

Recommended pattern:

1. define immutable `DEFAULT_CONFIG` and `DEFAULT_STATE`
2. normalize reads at startup
3. persist frequently changed working state into `state.json`
4. keep secrets or rotating tokens in `.runtime/*` when appropriate

## 11. Security Model

Security is layered:

1. request security middleware
2. route-level write gates
3. sandbox restrictions
4. mod-level auth on public/admin actions

Use mod-level keys for:

- public widgets
- overlay access
- viewer/admin command APIs

Do not expose unrestricted admin actions just because the mod runs locally. The mod HTTP surface is still an HTTP surface.

## 12. Build Checklist

Before shipping a mod:

1. `mod.json` validates and resolves entry paths
2. hooks/actions return deterministic payloads
3. UI assets are rooted under `ui/` and tested via `/mods-ui/<id>/`
4. mutating/admin actions have explicit auth policy
5. config/state writes are normalized and restart-safe
6. the mod can be unloaded without breaking the host server

That final rule is one of the most important ones in the platform. A mod can integrate deeply, but it must still remain optional.
