// [TITLE] Module: public/assets/js/domains/system/system-widget-oauth-runtime-ui.js
// [TITLE] Purpose: Twitch OAuth helper runtime for System widget generator controls
// [TITLE] Functionality Index:
// [TITLE] - expose public Device Code activation URL helper
// [TITLE] - open activation URL in a new browser tab with deterministic status feedback
// [TITLE] - copy activation URL to clipboard with execCommand fallback
// [DEV] Complex Flow:
// [DEV] This module now delegates the activation flow to the shared oauth-flow helper so
// [DEV] widget-generator additions do not duplicate the same Twitch/device-code logic.

function createSystemWidgetOauthRuntimeUi(deps = {}) {
  const flowRuntime = typeof createSystemWidgetOauthFlowRuntimeUi === "function"
    ? createSystemWidgetOauthFlowRuntimeUi(deps)
    : null;

  function buildSystemWidgetTwitchAuthorizeUrl() {
    if (!flowRuntime || typeof flowRuntime.buildSystemWidgetTwitchAuthorizeUrl !== "function") {
      return { ok: false, error: "system widget oauth flow runtime module missing" };
    }
    return flowRuntime.buildSystemWidgetTwitchAuthorizeUrl();
  }

  async function openSystemWidgetOauthAuthorizeUrl() {
    if (!flowRuntime || typeof flowRuntime.openSystemWidgetOauthAuthorizeUrl !== "function") {
      return false;
    }
    return flowRuntime.openSystemWidgetOauthAuthorizeUrl();
  }

  async function copySystemWidgetOauthAuthorizeUrl() {
    if (!flowRuntime || typeof flowRuntime.copySystemWidgetOauthAuthorizeUrl !== "function") {
      return false;
    }
    return flowRuntime.copySystemWidgetOauthAuthorizeUrl();
  }

  return {
    buildSystemWidgetTwitchAuthorizeUrl,
    openSystemWidgetOauthAuthorizeUrl,
    copySystemWidgetOauthAuthorizeUrl
  };
}
