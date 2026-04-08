# 11. Security Model and Hardening

This chapter explains the security model the way a maintainer needs to understand it: as layered runtime boundaries with specific ownership, not as a vague list of best practices.

The important question is:

> which layer is supposed to stop which class of mistake or attack?

When you understand that, hardening changes become much easier to place correctly.

Read this chapter together with `15-system-oauth-helix-and-safe-internet.md` when touching Twitch, OAuth, gateway, or Helix behavior. This chapter explains security posture. Chapter 15 explains the deeper runtime flow.

## 1) Security Layers

The main security layers are:

1. HTTP request security middleware
2. route-level write guards
3. domain-level permission checks
4. mod loader and sandbox controls
5. secret and OAuth handling
6. gateway-first outbound internet policy

Primary files:

- `src/app/runtime/request-security.middleware.js`
- `src/app/register-routes.js`
- `src/app/register-compat-routes.js`
- `src/domains/mods/mod-loader.port.js`
- `src/domains/mods/mod-sandbox.runtime.js`
- `src/domains/system/system-oauth.service.js`

Each layer exists because a different failure mode needs to be stopped at a different boundary.

## 2) HTTP Boundary Protection

The first major layer is [`request-security.middleware.js`](../../src/app/runtime/request-security.middleware.js).

This layer owns:

- origin validation
- CORS behavior
- method and preflight handling
- JSON parser limits
- deterministic JSON parse and payload-too-large responses
- CSP differences between core UI and `/mods-ui/*`

This middleware is trying to prevent application-boundary mistakes such as:

- unsafe cross-origin mutation
- unexpected parser behavior
- casual overexposure of embedded UI surfaces

It is not a replacement for route-level access control. It is the first perimeter.

## 3) Route-Level Write Protection

Mutating routes should still use `enforceWriteAccess`.

Pattern:

```js
app.post("/audio/config", enforceWriteAccess, async (req, res) => {
  res.json(await audioRuntimeService.patchConfig(getRequestMap(req.body)));
});
```

This is a second layer beyond middleware because the repo wants a local-first mutation model. A request can pass the general HTTP boundary checks and still not be allowed to mutate state from a remote source.

This is one of the clearest security rules in the repo:

- read access is often broader
- mutation is local-first unless explicitly opened

## 4) Domain-Level Permission Checks

Some security does not belong in middleware or generic route guards. It belongs inside the owning domain.

Examples:

- song-request mod admin vs viewer action permissions
- overlay token requirements
- Twitch redemption reconciliation scope validation
- command ownership rules such as who may skip or remove which request

This is important because business-permission logic cannot be fully expressed as generic HTTP boundary rules.

## 5) Mod Sandbox Security Boundaries

The mod system has two important protection classes:

### Filesystem and path containment

The platform must prevent mods or mod UI routes from escaping their intended root.

### Capability restriction

The sandbox must not behave like unrestricted host Node execution.

The restricted `require` model in `mod-sandbox.runtime.js` is a core part of that:

```js
if (token.startsWith("./") || token.startsWith("../")) {
  const resolved = resolveScriptFile(path.dirname(normalizedPath), token);
  const safe = sanitizeScriptPath(modRoot, path.relative(modRoot, resolved));
  return evaluateModule(safe);
}
...
throw new Error(`require("${token}") is not allowed in sandbox`);
```

This is one of the best examples in the repo of security as explicit policy, not implicit trust.

## 6) Secret and Token Handling

The repository has a few consistent rules around secrets:

1. do not trust plaintext config as the only home for sensitive values
2. avoid logging raw token values
3. prefer explicit channels and normalized contracts
4. keep operator status useful without leaking privileged data

Examples:

- server OAuth values live in the system vault model
- mod-local OAuth values use mod runtime vault storage
- overlay access tokens are persisted as runtime artifacts rather than exposed everywhere in plain UI state

## 7) OAuth Vault Model

The System OAuth service stack exists partly for maintainability, but also for hardening.

The split across:

- `system-oauth.vault.js`
- `system-oauth.transport.js`
- `system-oauth.device-flow.js`
- `system-oauth.reconcile.js`

helps separate:

- storage
- transport
- device-flow state
- redemption reconciliation logic

That separation is useful from a security perspective because each lane can be audited more clearly.

## 8) Gateway-First Outbound Internet Policy

One of the more unusual and important security ideas in this repository is that outbound internet access is treated as an explicit capability.

That is why gateway and safe-internet language exists in the System UI and docs.

The point is not only convenience. The point is that sensitive outbound flows such as OAuth and Helix interactions should:

- be observable
- be policy-shaped
- avoid being scattered across arbitrary browser code
- remain auditable from the server side

This is a strong design choice, and it is part of the security model, not just a networking detail.

## 9) Common Threat Scenarios to Think About

When reviewing security-sensitive changes, test at least these scenarios:

- cross-origin browser call to localhost mutating endpoint
- remote LAN write attempt without explicit opt-in
- mod path traversal attempt through UI asset serving
- unauthorized admin action against a mod endpoint
- duplicate or replayed widget or chat command event
- overbroad status payload leaking more than an operator needs

This list exists because these are realistic failure classes for this repository's architecture.

## 10) Security Regression Testing Strategy

Use targeted tests for each boundary:

- middleware contract tests
- route write-guard tests
- mod loader and sandbox tests
- action-level auth tests in the song-request mod
- system OAuth tests

The important rule is:

> add a regression test at the layer where the security guarantee actually lives

If the guarantee is route-level, do not only add a service test.
If the guarantee is mod action auth, do not only add a middleware test.

## 11) Hardening Checklist for Contributors

Before merging a security-sensitive change:

1. confirm no mutating route bypasses `enforceWriteAccess`
2. confirm status or diagnostics payloads do not expose secrets
3. confirm tokens are stored in the right lane
4. confirm mod or widget actions still enforce the intended role boundary
5. add at least one focused test for the security claim you changed
6. run the relevant verification scripts and targeted suites

## 12) Core Principle

Security in this repository works because it is layered:

- middleware protects the application boundary
- route guards protect mutation boundaries
- domains protect business permissions
- sandboxing protects extension boundaries
- vault and gateway design protect sensitive integration behavior

If you keep those layers explicit, hardening changes remain coherent instead of becoming scattered one-off fixes.
