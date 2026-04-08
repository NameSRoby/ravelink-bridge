// [TITLE] Module: domains/engine-v2/engine.scheduler.js
// [TITLE] Purpose: deterministic single-tick engine execution pipeline
// [TITLE] Functionality Index:
// [TITLE] - normalize input snapshots into scene state
// [TITLE] - apply policy stack and map fixture intents
// [TITLE] - dispatch intents by brand and publish telemetry projection
// [DEV] Complex Flow:
// [DEV] Scheduler executes a strict stage order to keep behavior deterministic:
// [DEV] gather -> normalize -> compute -> policy -> map -> dispatch -> project.

const {
  normalizeEngineInputSnapshot,
  clampNumber,
  buildEngineTelemetryProjection
} = require("./engine.contracts");

function defaultComputeSceneState(input = {}) {
  const telemetry = input.telemetry && typeof input.telemetry === "object" ? input.telemetry : {};
  const energy = clampNumber(telemetry.energy, 0, 1, 0);
  const rms = clampNumber(telemetry.rms, 0, 1, 0);
  const flux = clampNumber(telemetry.flux, 0, 1, 0);
  const transient = clampNumber(telemetry.transient, 0, 1, 0);
  const bpm = clampNumber(telemetry.bpm, 0, 260, 0);
  const beatConfidence = clampNumber(telemetry.beatConfidence, 0, 1, 0);
  const sceneIntent = (energy > 0.6 || transient > 0.7)
    ? "impact"
    : (rms > 0.35 || flux > 0.35)
      ? "motion"
      : "idle";
  return {
    energy,
    rms,
    transient,
    flux,
    bpm,
    beatConfidence,
    sceneIntent
  };
}

module.exports = function createEngineScheduler(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const computeSceneState = typeof options.computeSceneState === "function"
    ? options.computeSceneState
    : defaultComputeSceneState;
  const applyPolicies = typeof options.applyPolicies === "function"
    ? options.applyPolicies
    : ((sceneState) => ({ ok: true, state: { ...sceneState }, applied: [], errors: [] }));
  const mapIntents = typeof options.mapIntents === "function"
    ? options.mapIntents
    : (() => []);
  const dispatchByBrand = typeof options.dispatchByBrand === "function"
    ? options.dispatchByBrand
    : (() => ({ sent: 0, failed: 0, dryRun: true }));
  const buildTelemetryProjection = typeof options.buildTelemetryProjection === "function"
    ? options.buildTelemetryProjection
    : buildEngineTelemetryProjection;

  function runTick(rawInput = {}, tickMeta = {}) {
    const tickStartedAt = Number(now() || Date.now());
    const input = normalizeEngineInputSnapshot(rawInput);
    const sceneBase = computeSceneState(input);
    const policyResult = applyPolicies(sceneBase, {
      input,
      tickMeta
    });
    const sceneState = policyResult?.state && typeof policyResult.state === "object"
      ? policyResult.state
      : sceneBase;
    const intents = mapIntents({
      sceneState,
      fixtures: input.fixtures,
      routing: sceneState.routing || {}
    });
    const dispatch = dispatchByBrand(intents, {
      input,
      sceneState,
      tickMeta
    });
    const tickEndedAt = Number(now() || Date.now());
    const loopDurationMs = Math.max(0, tickEndedAt - tickStartedAt);

    const projection = buildTelemetryProjection({
      status: {
        running: true,
        tickMs: tickMeta.tickMs || 100,
        tickCount: Number(tickMeta.tickCount || 0),
        lastTickAt: tickEndedAt,
        loopDurationMs,
        intentsCount: intents.length
      },
      sceneState,
      dispatch
    });

    return {
      ok: policyResult?.ok !== false,
      input,
      sceneBase,
      sceneState,
      policy: {
        applied: Array.isArray(policyResult?.applied) ? policyResult.applied : [],
        errors: Array.isArray(policyResult?.errors) ? policyResult.errors : []
      },
      intents,
      dispatch,
      projection,
      timing: {
        startedAt: tickStartedAt,
        endedAt: tickEndedAt,
        loopDurationMs
      }
    };
  }

  return {
    runTick
  };
};
