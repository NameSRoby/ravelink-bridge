// [TITLE] Module: domains/engine-v2/engine.policy-registry.js
// [TITLE] Purpose: deterministic Engine v2 policy ordering and application runtime
// [TITLE] Functionality Index:
// [TITLE] - register policy handlers by id/priority
// [TITLE] - apply policy stack over scene state with deterministic ordering
// [TITLE] - collect ownership and diagnostics metadata for telemetry projection
// [DEV] Complex Flow:
// [DEV] Policy handlers are constrained to pure state transforms. Transport writes and
// [DEV] side effects are intentionally forbidden at this layer.

const { ENGINE_V2_POLICY_ORDER } = require("./engine.contracts");

function normalizePolicyId(value = "") {
  return String(value || "").trim().toLowerCase();
}

function createDefaultPolicyDefinitions() {
  return ENGINE_V2_POLICY_ORDER.map((id, index) => ({
    id,
    priority: (index + 1) * 100,
    apply(sceneState = {}) {
      return { ...sceneState };
    }
  }));
}

module.exports = function createEnginePolicyRegistry(options = {}) {
  const entries = new Map();
  const defaults = Array.isArray(options.defaults) && options.defaults.length
    ? options.defaults
    : createDefaultPolicyDefinitions();

  function registerPolicy(definition = {}) {
    const id = normalizePolicyId(definition.id);
    if (!id) {
      throw new Error("engine policy requires id");
    }
    const priorityRaw = Number(definition.priority);
    const priority = Number.isFinite(priorityRaw) ? priorityRaw : 1000;
    const apply = typeof definition.apply === "function"
      ? definition.apply
      : (state => ({ ...state }));
    entries.set(id, { id, priority, apply });
    return entries.get(id);
  }

  function unregisterPolicy(idRaw) {
    const id = normalizePolicyId(idRaw);
    if (!id) return false;
    return entries.delete(id);
  }

  function listPolicies() {
    return [...entries.values()]
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
      .map(policy => ({
        id: policy.id,
        priority: policy.priority
      }));
  }

  function applyPolicies(sceneState = {}, context = {}) {
    let next = sceneState && typeof sceneState === "object" ? { ...sceneState } : {};
    const applied = [];
    const errors = [];
    for (const policy of [...entries.values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))) {
      try {
        const result = policy.apply({ ...next }, context);
        if (result && typeof result === "object" && !Array.isArray(result)) {
          next = { ...next, ...result };
        }
        applied.push(policy.id);
      } catch (error) {
        errors.push({
          id: policy.id,
          error: String(error?.message || error)
        });
      }
    }
    return {
      ok: errors.length === 0,
      state: next,
      applied,
      errors
    };
  }

  for (const definition of defaults) {
    registerPolicy(definition);
  }

  return {
    registerPolicy,
    unregisterPolicy,
    listPolicies,
    applyPolicies
  };
};
