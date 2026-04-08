// [TITLE] Module: domains/mods/hook-contract.js
// [TITLE] Purpose: canonical mod hook contract list
// [TITLE] Functionality Index:
// [TITLE] - define supported hook names for runtime compatibility

const SUPPORTED_MOD_HOOKS = Object.freeze([
  "onLoad",
  "onBoot",
  "onRaveStart",
  "onRaveStop",
  "onIntent",
  "onTelemetry",
  "onShutdown",
  "onUnload",
  "onHttp"
]);

module.exports = {
  SUPPORTED_MOD_HOOKS
};
