# 15. System OAuth, Twitch Helix, and Safe Internet Deep Dive

This chapter explains one of the most important safety boundaries in the repository: how the server is allowed to talk to the public internet, how Twitch OAuth credentials are persisted and interpreted, and how pending channel-point redemptions get fulfilled or refunded without giving arbitrary browser code uncontrolled outbound network access.

This area matters because it is doing several jobs at once:

1. it stores sensitive Twitch identity state
2. it provides a safe outbound network lane
3. it makes Twitch Helix requests
4. it lets the server and mods reconcile redemption state
5. it keeps widget/browser integrations from becoming the place where secrets and direct Helix writes live forever

The code is intentionally split so those concerns stay legible.

```text
browser UI / widget / mod
  -> compat route
  -> system OAuth service
  -> gateway-first transport helper
  -> internet gateway runtime
  -> internet gateway worker
  -> Twitch OAuth / Helix
```

If you remember only one idea from this chapter, remember this:

The safe-internet lane is not decorative. It exists so Twitch integration can stay usable without letting every client-side integration become its own direct network authority.

## 1. File Map

Read these files together:

```text
src/app/create-server.js
src/app/routes/compat/system.compat.routes.js
src/domains/internet-gateway/internet-gateway.runtime.js
src/domains/internet-gateway/internet-gateway.worker.js
src/domains/internet-gateway/gateway.contracts.js
src/domains/internet-gateway/gateway.policy.defaults.js
src/domains/internet-gateway/gateway.policy.schema.js
src/domains/system/system-oauth.service.js
src/domains/system/system-oauth.vault.js
src/domains/system/system-oauth.transport.js
src/domains/system/system-oauth.device-flow.js
src/domains/system/system-oauth.reconcile.js
public/assets/js/domains/system/system-ops-runtime-ui.js
public/assets/js/domains/system/system-widget-template-runtime-ui.js
mods/song-request-mod/index.js
mods/song-request-mod/templates/PASTE-INTO-STREAMELEMENTS-CUSTOM-WIDGET.js
```

There are really four sub-systems here:

1. the gateway runtime and worker
2. the OAuth vault + device flow service
3. the gateway-first Twitch transport helper
4. the reconcile engine that turns pending rewards into fulfilled/refunded outcomes

## 2. Why The Internet Gateway Exists

The repository could have chosen the easy path:

- let browser widgets call Twitch directly
- let mods talk straight to `https://api.twitch.tv`
- let every integration decide its own retry, timeout, and logging rules

That would have been fast at first and chaotic later.

Instead, the codebase has a host-owned outbound lane. The gateway is a separate runtime plus worker that:

- validates request envelopes
- enforces an allowlist policy
- limits outbound target shapes
- centralizes request accounting and errors
- lets higher-level services prefer the safer path first

The runtime is created during server boot from `src/app/create-server.js`. It owns worker lifecycle. The worker owns outbound request execution.

That division is deliberate:

- the runtime is a supervisor and IPC boundary
- the worker is the place where actual network egress happens

This means a domain service such as System OAuth does not need to know how worker spawn, policy load, timeout cleanup, or IPC dispatch works. It asks for a typed outbound request and gets a typed response.

## 3. Gateway Runtime vs Gateway Worker

The best mental model is:

```text
internet-gateway.runtime.js
  = parent process supervisor + request bookkeeper

internet-gateway.worker.js
  = isolated outbound executor + policy enforcer
```

The runtime keeps state such as:

- whether the worker is enabled
- whether the worker is running
- whether policy is loaded
- how many requests have been attempted
- how many request failures occurred
- what the last error was

The worker loads and validates policy, receives request envelopes, performs HTTP calls, and sends result envelopes back.

A useful way to read the runtime file is to ignore the spawn details first and focus on these questions:

1. When does the worker become "ready"?
2. What happens to pending requests when the worker exits?
3. What request shape is allowed through to the worker?
4. How are failures normalized?

That is the real ownership.

## 4. Gateway Policy Is A Contract, Not A Suggestion

The default policy lives in `src/domains/internet-gateway/gateway.policy.defaults.js`, and the schema in `src/domains/internet-gateway/gateway.policy.schema.js`.

This matters because the worker is not supposed to be "a generic proxy." It is supposed to be a constrained outbound lane.

The default Twitch-related allowlist includes paths such as:

```text
/oauth2/validate
/helix/channel_points/custom_rewards
/helix/users
```

That means the gateway understands where the app is expected to talk, and rejects shapes that do not fit policy.

This is one of the key security design choices in the repository:

The allowlist lives in code and runtime policy files so outbound capability is explicit and auditable.

## 5. System OAuth Service Is The Composition Root

`src/domains/system/system-oauth.service.js` is not "the file that does OAuth itself." It is the composition root for the System OAuth domain.

It composes:

- `system-oauth.vault.js`
- `system-oauth.device-flow.js`
- `system-oauth.transport.js`
- `system-oauth.reconcile.js`

That is why the service file is mostly about status shaping, helper wiring, and public API composition rather than raw HTTP code.

The service status output is intentionally rich. The browser UI needs to know:

- whether client id is present
- whether access token is present
- whether refresh token is present
- whether the token is expired
- whether the DPAPI vault loaded correctly
- whether Helix is actually ready
- which required scopes are expected
- whether the safe-internet lane is available

This is the core shape from `getStatus()`:

```js
function getStatus() {
  const snapshot = normalizeProfileShape(profile);
  const presence = buildProfilePresence(snapshot);
  const tokenExpiresAt = Math.max(0, Number(snapshot.tokenExpiresAt || 0));
  const helix = buildHelixReadiness(snapshot, Date.now());
  return {
    ok: true,
    oauthFlow: "public_device_code",
    mode: process.platform === "win32" ? "persistent_write_only_dpapi" : "volatile_write_only_non_windows",
    presence: {
      twitchClientId: presence.twitchClientId,
      twitchBroadcasterId: presence.twitchBroadcasterId,
      twitchUserAccessToken: presence.twitchUserAccessToken,
      twitchRefreshToken: presence.twitchRefreshToken
    },
    helix,
    tokenExpiresAt,
    tokenIsExpired: tokenExpiresAt > 0 ? tokenExpiresAt <= Date.now() : false,
    oauthVault: {
      enabled: process.platform === "win32",
      loaded: vaultRuntime.loaded === true
    },
    internetGateway: internetGatewayClient && typeof internetGatewayClient.getStatus === "function"
      ? cloneJson(internetGatewayClient.getStatus(), {})
      : { available: false },
    requiredScopes: cloneJson(OAUTH_SCOPES, [])
  };
}
```

The important design choice here is that the browser is not asked to infer readiness from a couple of booleans. The backend explains the real state directly.

## 6. Vault Model: Persistence Without Treating Tokens Like UI Settings

The vault lane exists because OAuth credentials are not ordinary config. They are sensitive runtime identity material.

On Windows, the service prefers persistent DPAPI-backed storage.
On non-Windows platforms, the service falls back to volatile/write-only behavior.

That is why the status includes:

```text
mode: persistent_write_only_dpapi
```

or

```text
mode: volatile_write_only_non_windows
```

This is a subtle but excellent example of the repository favoring truth over false comfort. Instead of pretending every environment has the same security posture, the service reports which storage model is actually active.

When you edit this area, keep the following principle:

Never make the UI guess whether secrets are safely persisted. Make the service say it explicitly.

## 7. Device Flow: Why The Repo Uses It

The user-facing OAuth lane is intentionally based on the public device-code flow. That is a good fit for local desktop/server setups because:

- it avoids needing a full redirect-heavy browser app architecture
- it works with a local operator driving the server
- it lets the browser UI show clear connect/poll/expired states

The device flow helper owns:

- starting a device-code session
- tracking poll interval
- tracking pending/expired/error state
- persisting the resulting token patch back into the profile

One important piece of logic is that slow-down and authorization-pending are not treated like fatal failures. They are state transitions.

From the mod-side implementation, which mirrors the same design idea:

```js
if (message === "authorization_pending" || message === "slow_down") {
  setTwitchDeviceFlowState({
    status: "pending",
    intervalSec: nextIntervalSec,
    nextPollAt: nowMs + (nextIntervalSec * 1000),
    lastPolledAt: nowMs,
    pollAttempts: Number(flow.pollAttempts || 0) + 1,
    lastError: ""
  });
  return {
    ok: true,
    pending: true,
    polled: true,
    connected: false
  };
}
```

This is worth calling out because it is the kind of code that often gets flattened incorrectly during refactors. `pending` is not an error. `slow_down` is not an error. The system is still working; the state simply moved.

## 8. Gateway-First Transport

`src/domains/system/system-oauth.transport.js` is the most important file to internalize if you want to understand how this repo talks to Twitch responsibly.

It implements a gateway-first transport policy:

1. try the safe outbound lane
2. if the gateway handled the request, use that response
3. otherwise fall back to direct HTTP

That pattern appears in several helpers:

- `requestOAuthValidate`
- `postOAuthForm`
- `getHelix`
- `patchRedemption`

Example: validate token through the gateway if possible.

```js
async function requestOAuthValidate(accessToken = "") {
  const gatewayAttempt = await executeGatewayHttpLikeRequest({
    integrationKey: "twitch",
    operation: "oauth2_validate",
    target: {
      serviceKey: GATEWAY_SERVICE_TWITCH_OAUTH,
      method: "GET",
      path: "/oauth2/validate"
    },
    headers: {
      authorization: `OAuth ${token}`
    },
    timeoutMs: 8_000,
    retryBudget: 1
  });
  if (gatewayAttempt.handled === true) {
    return gatewayAttempt.response;
  }
  return await httpClient.get("https://id.twitch.tv/oauth2/validate", {
    headers: {
      Authorization: `OAuth ${token}`
    },
    timeout: 8_000,
    validateStatus: () => true
  });
}
```

The deep point here is not the fallback itself. The deep point is that fallback is explicit, localized, and testable. The code does not hide where it prefers the gateway and where it is willing to degrade to direct transport.

If you ever need to harden this further, this is the exact seam you would tighten.

## 9. Helix Readiness Is More Than "Token Exists"

One of the most common mistakes in Twitch integrations is to say "we have a token, therefore Helix is ready."

This repository does not do that. It separates:

- value presence
- token expiry
- scope completeness
- broadcaster identity presence
- client id presence

That is why the System UI can truthfully show states like:

```text
HELIX INCOMPLETE
```

instead of falsely implying that a stored token means redemption sync will succeed.

When a maintainer works in this area, the checklist should be:

1. Do we have client id?
2. Do we have broadcaster id?
3. Do we have access token?
4. Is it expired?
5. Does it include the required scopes?
6. Can the gateway carry Twitch calls safely?

If any of those answers are "no," readiness is partial at best.

## 10. Reconcile Is A Batch Resolver, Not A Widget Trick

`src/domains/system/system-oauth.reconcile.js` owns redemption status sync. It is not supposed to be a UI gimmick or a widget-owned patch path. It is a server-owned reconciliation engine.

The algorithm is:

1. resolve the Helix context
2. determine which reward ids to scan
3. list pending redemptions per reward
4. patch each redemption to the target status
5. accumulate failures and counts
6. return a rich summary payload

Representative core:

```js
async function reconcilePendingRedemptions(input = {}) {
  const targetStatus = asString(source.status || "FULFILLED").toUpperCase();
  const context = await resolveHelixContext(source);
  if (!context.ok) return context;

  let rewardIds = [...new Set(requestedRewardIds)];
  if (!rewardIds.length) {
    const rewardLookup = await fetchManagedRewardIdsViaContext(context, { maxRewards });
    if (!rewardLookup.ok) return rewardLookup;
    rewardIds = rewardLookup.rewardIds || [];
  }

  for (const rewardId of rewardIds) {
    const pendingLookup = await fetchPendingRedemptionsForRewardViaContext(context, rewardId, { maxRedemptions });
    if (!pendingLookup.ok) {
      failures.push({ rewardId, error: pendingLookup.error });
      continue;
    }
    for (const pendingRow of pendingLookup.redemptions) {
      const patchResult = await patchRedemptionStatusViaContext(context, {
        rewardId,
        redemptionId: asString(pendingRow?.id || ""),
        status: targetStatus,
        reason: asString(source.reason || "pending_reconcile")
      });
      if (patchResult.ok) {
        resolved += 1;
        continue;
      }
      failures.push({
        rewardId,
        redemptionId: asString(patchResult.redemptionId || pendingRow?.id || ""),
        error: asString(patchResult.error || "widget_status_sync_failed")
      });
    }
  }

  return { ok: true, resolved, failures };
}
```

The crucial insight:

This code is not trying to track a single reward event in real time. It is reconciling reality against desired status. That is why it works well as a safety lane when widget/browser timing is imperfect.

## 11. Auto-Reconcile Is A Supervisor Loop

The auto-reconcile mode is intentionally tiny in concept:

- keep a timer
- do not overlap runs
- skip work if profile prerequisites are missing
- store the last result

That design keeps the periodic loop understandable:

```js
const tick = async () => {
  if (reconcileRuntime.inFlight) return;
  const snapshot = normalizeProfileShape(getProfile());
  if (!snapshot.twitchClientId || !snapshot.twitchBroadcasterId || !snapshot.twitchUserAccessToken) {
    return;
  }
  reconcileRuntime.inFlight = true;
  reconcileRuntime.lastStartedAt = Date.now();
  try {
    const result = await reconcilePendingRedemptions({
      status: reconcileRuntime.status,
      reason: "auto_reconcile",
      maxRewards: reconcileRuntime.maxRewards,
      maxRedemptions: reconcileRuntime.maxRedemptions
    });
    reconcileRuntime.lastResult = result;
  } finally {
    reconcileRuntime.lastCompletedAt = Date.now();
    reconcileRuntime.inFlight = false;
  }
};
```

This is a good example of a loop that is deliberately boring. That is a compliment. The harder logic belongs in reconcile itself, not in the timer wrapper.

## 12. How The Browser UI Explains The System

The System browser lane for this feature is primarily owned by:

- `public/assets/js/domains/system/system-ops-runtime-ui.js`
- `public/templates/index/sections/panel-system.html`

That UI is doing a translation job. The backend has many precise states; the operator needs a compact read of:

- gateway running / ready / policy loaded
- Helix ready or incomplete
- scope completeness
- auto-reconcile on or off
- request errors and last result

The UI summary string is intentionally explicit:

```js
const gatewayState = gateway.enabled !== true
  ? "GATEWAY DISABLED"
  : (gateway.ready === true ? "GATEWAY READY" : (gateway.running === true ? "GATEWAY STARTING" : "GATEWAY STOPPED"));
const recState = reconcile.enabled === true ? "AUTO RECONCILE ON" : "AUTO RECONCILE OFF";
const helixState = helix.ready === true ? "HELIX READY" : "HELIX INCOMPLETE";
el.systemGatewayStatusText.value = `${gatewayState} | ${helixState} | ${recState} | ${failureToken}`;
```

This is not just cosmetic UI logic. It is part of the safety model because it prevents operators from over-trusting a half-configured system.

## 13. Widgets, Mods, And Why Direct Helix Ownership Was Reduced

The repo historically had more widget-side direct Helix behavior. The newer design deliberately pulls ownership back toward the server.

The current intended model is:

- widget/browser surfaces gather user intent and metadata
- mods can forward redemption identifiers and action context
- System OAuth + gateway-first transport own the actual Helix mutation lane

This matters for reliability and removability.

If a mod is hotloaded out:

- the server still owns its own OAuth and reconcile flow
- the safe-internet lane still exists
- the server widget can still function without the mod bundle

That is exactly the kind of decoupling this codebase wants.

## 14. Docked Mod OAuth And Combined Widgets

The server now supports optional "dock onto the server" behaviors:

- mod onboarding can contribute steps into the server onboarding flow
- a compatible mod can optionally participate in combined widget generation
- mod OAuth affordances can be represented through the server panel

The important word is optional.

This should never become "the mod is now required for the server flow to work."

You can see that principle in `system-widget-template-runtime-ui.js`:

```js
async function maybeGenerateDockedModWidgetScript(systemScript = "", payload = {}) {
  if (String(payload.widgetBundleMode || "").toLowerCase() !== "combined") {
    return { ok: true, script: systemScript, modId: "", appended: false };
  }
  const modId = String(ui.modUiSelectedId || "music-request-engine").trim();
  if (!modId || !modsEndpointsAdapter || typeof modsEndpointsAdapter.invokeAction !== "function") {
    return { ok: false, script: systemScript, modId, appended: false, error: "No compatible mod widget generator is selected." };
  }
  const response = await modsEndpointsAdapter.invokeAction(modId, "admin_widget_template_get", "POST", modPayload);
  ...
}
```

That is the right shape. The server widget exists on its own. The combined mod widget path is a compatibility enhancement, not a structural dependency.

## 15. How Mods Use The Same Safe-Internet Idea

The song-request mod mirrors the same gateway-first idea on its own Twitch-related paths. That is why you see helper names like:

- `executeTwitchGatewayOrAxios`
- `fetchTwitchTokenValidation`
- `refreshTwitchAccessTokenIfNeeded`

The design is aligned with the server domain:

1. prefer the safe egress lane
2. normalize gateway responses into familiar HTTP-like shapes
3. only use direct fallback when needed

This shared design language matters because it keeps server and mod integrations conceptually compatible.

## 16. Failure Modes You Should Expect

The most common real-world failure shapes here are:

1. gateway running but policy not loaded
2. token present but expired
3. token valid but missing `channel:manage:redemptions`
4. broadcaster id missing or mismatched
5. auto-reconcile enabled but no usable context
6. widget/browser path assuming it fulfilled something that the server never reconciled

When debugging, always identify which layer failed:

```text
UI layer?
compat route?
oauth service?
gateway transport?
gateway runtime?
gateway worker?
Twitch response?
```

That layered discipline will save you enormous time.

## 17. Practical Debug Sequence

When the operator says "Twitch Helix stuff is not working," do this in order:

1. Check `/system/oauth/status` or the System UI summary.
2. Confirm `requiredScopes` includes the needed redemption scope.
3. Confirm token expiry and presence flags.
4. Check `/system/internet-gateway/status`.
5. Check `/system/widget-redemption-reconcile-status`.
6. Run a manual reconcile pass.
7. Inspect the last reconcile result JSON.
8. Only then start questioning mod/widget behavior.

Most bugs in this area are not "the widget is broken." They are "the full lane is incomplete somewhere."

## 18. Change Rules For Maintainers

When editing this area, keep these rules:

1. Do not move direct Twitch HTTP back into random browser modules.
2. Do not flatten vault, transport, device flow, and reconcile into one giant file again.
3. Do not hide incomplete Helix state behind optimistic UI text.
4. Do not make combined widget or mod docking a required path for the server.
5. Add tests for gateway-first vs fallback behavior any time transport changes.

## 19. What To Read Next

After this chapter:

- read `11-security-model-and-hardening.md` again with the gateway in mind
- read `16-song-request-player-widget-and-queue-deep-dive.md` for how a real mod consumes these lanes
- use `17-maintainer-code-walkthroughs.md` when making changes so you do not lose the safety boundaries while refactoring
