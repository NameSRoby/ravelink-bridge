// [TITLE] Module: mods/hello-mod/index.js
// [TITLE] Purpose: index

module.exports = function createHelloMod(api) {
  let seenIntents = 0;

  return {
    onLoad() {
      api.log("loaded. Enable this mod in mods/mods.config.json -> enabled.");
    },

    onBoot(payload) {
      api.log(`boot hook fired (reason=${payload?.reason || "unknown"})`);
    },

    onRaveStart() {
      api.log("rave started");
    },

    onRaveStop() {
      api.log("rave stopped");
    },

    onIntent(payload) {
      if (!payload?.intent) return;
      seenIntents += 1;
      if (seenIntents % 120 === 0) {
        api.log(`observed intents=${seenIntents}`);
      }
    },

    onHttp(request) {
      const action = String(request?.action || "status").toLowerCase();

      if (action === "status") {
        return {
          status: 200,
          body: {
            ok: true,
            mod: "hello-mod",
            seenIntents,
            state: api.getState(),
            engine: api.getEngineTelemetry()
          }
        };
      }

      if (action === "flash") {
        api.enqueueWiz(
          { r: 255, g: 96, b: 0, dimming: 55 },
          "background",
          { forceDelta: true }
        );
        return {
          status: 200,
          body: { ok: true, fired: true }
        };
      }

      return {
        status: 400,
        body: {
          ok: false,
          error: "unknown action",
          allowed: ["status", "flash"]
        }
      };
    },

    onShutdown(payload) {
      api.log(`shutdown hook fired (reason=${payload?.reason || "unknown"})`);
    }
  };
};
