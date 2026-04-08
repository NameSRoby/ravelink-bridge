// [TITLE] Test Module: test/mod-loader.sandbox.test.js
// [TITLE] Purpose: verify mod loader sandbox execution and filesystem discovery contracts

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const createModRuntime = require("../src/domains/mods/mod-loader.port");

function createTempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-mod-loader-"));
  const modsRoot = path.join(dir, "mods");
  const configPath = path.join(modsRoot, "mods.config.json");
  fs.mkdirSync(modsRoot, { recursive: true });
  return {
    dir,
    modsRoot,
    configPath
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("mod loader discovers enabled mod and executes sandbox hook/action", async () => {
  const temp = createTempRoot();
  const modRoot = path.join(temp.modsRoot, "music-mod");
  fs.mkdirSync(path.join(modRoot, "lib"), { recursive: true });
  fs.mkdirSync(path.join(modRoot, "ui"), { recursive: true });

  writeJson(path.join(modRoot, "mod.json"), {
    id: "music-mod",
    name: "Music Mod",
    version: "1.0.0",
    entry: "index.js",
    hooks: ["onRaveStart"],
    ui: {
      title: "Music Mod UI",
      entry: "ui/index.html"
    }
  });
  fs.writeFileSync(path.join(modRoot, "lib", "helper.js"), "module.exports = x => Number(x || 0) + 1;\n", "utf8");
  fs.writeFileSync(path.join(modRoot, "index.js"), [
    "const helper = require('./lib/helper');",
    "module.exports = {",
    "  hooks: {",
    "    onRaveStart({ payload, api }) {",
    "      return { startedAt: helper(payload?.at), count: api.incrementCounter('music_start', 1) };",
    "    }",
    "  },",
    "  actions: {",
    "    ping({ payload, api }) {",
    "      return { pong: true, count: api.incrementCounter('music_ping', 1), echo: payload || null };",
    "    },",
    "    'api/status'({ payload }) {",
    "      return { ok: true, lane: 'api/status', payload };",
    "    }",
    "  }",
    "};"
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(modRoot, "ui", "index.html"), "<h1>music ui</h1>", "utf8");

  writeJson(temp.configPath, {
    enabled: ["music-mod"],
    order: ["music-mod"],
    disabled: []
  });

  const runtime = createModRuntime({
    modsRoot: temp.modsRoot,
    configPath: temp.configPath
  });
  const snapshot = await runtime.load();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.total, 1);
  assert.equal(snapshot.loaded, 1);

  const hook = await runtime.invokeHook("onRaveStart", { at: 41 });
  assert.equal(hook.ok, true);
  assert.equal(hook.invoked, 1);

  const action = await runtime.invokeAction("music-mod", "ping", "POST");
  assert.equal(action.status, 200);
  assert.equal(action.body?.ok, true);
  assert.equal(action.body?.result?.pong, true);

  const actionWithPayload = await runtime.invokeAction("music-mod", "ping", "POST", {
    body: { value: 42 },
    query: { scope: "test" }
  });
  assert.equal(actionWithPayload.status, 200);
  assert.equal(actionWithPayload.body?.result?.echo?.body?.value, 42);
  assert.equal(actionWithPayload.body?.result?.echo?.query?.scope, "test");

  const actionWithPatchVerb = await runtime.invokeAction("music-mod", "ping", "PATCH", {
    body: { value: 7 }
  });
  assert.equal(actionWithPatchVerb.status, 200);
  assert.equal(actionWithPatchVerb.body?.result?.echo?.method, "PATCH");
  assert.equal(actionWithPatchVerb.body?.result?.echo?.body?.value, 7);

  const nestedHttp = await runtime.invokeAction("music-mod", "api/status", "GET", {
    query: { source: "unit" },
    body: {}
  });
  assert.equal(nestedHttp.status, 200);
  assert.equal(nestedHttp.body?.ok, true);
  assert.equal(nestedHttp.body?.result?.lane, "api/status");
  assert.equal(nestedHttp.body?.result?.payload?.query?.source, "unit");

  const uiCatalog = runtime.getUiCatalog();
  assert.equal(uiCatalog.ok, true);
  assert.equal(Array.isArray(uiCatalog.mods), true);
  assert.equal(uiCatalog.mods[0]?.id, "music-mod");
  assert.equal(uiCatalog.mods[0]?.loaded, true);

  const uiAsset = runtime.resolveUiAsset("music-mod", "");
  assert.equal(uiAsset.ok, true);
  assert.equal(path.basename(uiAsset.filePath), "index.html");

  fs.rmSync(temp.dir, { recursive: true, force: true });
});

test("mod loader import writes files to mods root and enables mod", async () => {
  const temp = createTempRoot();
  writeJson(temp.configPath, {
    enabled: [],
    order: [],
    disabled: []
  });

  const runtime = createModRuntime({
    modsRoot: temp.modsRoot,
    configPath: temp.configPath
  });
  await runtime.load();

  const payload = {
    files: [
      {
        path: "pack/mod.json",
        data: Buffer.from(JSON.stringify({
          id: "pack-mod",
          name: "Pack Mod",
          version: "1.0.0",
          entry: "index.js"
        }), "utf8").toString("base64")
      },
      {
        path: "pack/index.js",
        data: Buffer.from("module.exports = { actions: { ping: () => ({ ok: true }) } };", "utf8").toString("base64")
      }
    ],
    overwrite: true,
    enableAfterImport: true,
    reload: true
  };
  const result = await runtime.importMods(payload);
  assert.equal(result.ok, true);
  assert.equal(result.modId, "pack-mod");
  assert.equal(result.snapshot.loaded, 1);

  const exists = fs.existsSync(path.join(temp.modsRoot, "pack", "mod.json"));
  assert.equal(exists, true);

  fs.rmSync(temp.dir, { recursive: true, force: true });
});

test("mod loader rejects ui asset traversal into sibling path", async () => {
  const temp = createTempRoot();
  const modRoot = path.join(temp.modsRoot, "safe-mod");
  const evilRoot = path.join(temp.modsRoot, "safe-mod-ui-evil");
  fs.mkdirSync(path.join(modRoot, "ui"), { recursive: true });
  fs.mkdirSync(evilRoot, { recursive: true });

  writeJson(path.join(modRoot, "mod.json"), {
    id: "safe-mod",
    name: "Safe Mod",
    version: "1.0.0",
    entry: "index.js",
    ui: {
      title: "Safe UI",
      entry: "ui/index.html"
    }
  });
  fs.writeFileSync(path.join(modRoot, "index.js"), "module.exports = {};\n", "utf8");
  fs.writeFileSync(path.join(modRoot, "ui", "index.html"), "<h1>safe</h1>", "utf8");
  fs.writeFileSync(path.join(evilRoot, "leak.html"), "<h1>leak</h1>", "utf8");

  writeJson(temp.configPath, {
    enabled: ["safe-mod"],
    order: ["safe-mod"],
    disabled: []
  });

  const runtime = createModRuntime({
    modsRoot: temp.modsRoot,
    configPath: temp.configPath
  });
  await runtime.load();

  const asset = runtime.resolveUiAsset("safe-mod", "../ui-evil/leak.html");
  assert.equal(asset.ok, false);
  assert.equal(asset.error, "mod_ui_asset_not_found");

  fs.rmSync(temp.dir, { recursive: true, force: true });
});

test("sandbox rejects require path traversal into sibling mod folder", async () => {
  const temp = createTempRoot();
  const modRoot = path.join(temp.modsRoot, "safe-mod");
  const siblingRoot = path.join(temp.modsRoot, "safe-mod-evil");
  fs.mkdirSync(modRoot, { recursive: true });
  fs.mkdirSync(siblingRoot, { recursive: true });

  writeJson(path.join(modRoot, "mod.json"), {
    id: "safe-mod",
    name: "Safe Mod",
    version: "1.0.0",
    entry: "index.js",
    hooks: ["onRaveStart"]
  });
  fs.writeFileSync(path.join(modRoot, "index.js"), [
    "module.exports = {",
    "  hooks: {",
    "    onRaveStart() {",
    "      const stolen = require('../safe-mod-evil/secret');",
    "      return stolen();",
    "    }",
    "  }",
    "};"
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(siblingRoot, "secret.js"), "module.exports = () => 'stolen';\n", "utf8");

  writeJson(temp.configPath, {
    enabled: ["safe-mod"],
    order: ["safe-mod"],
    disabled: []
  });

  const runtime = createModRuntime({
    modsRoot: temp.modsRoot,
    configPath: temp.configPath
  });
  await runtime.load();

  const hook = await runtime.invokeHook("onRaveStart", {});
  assert.equal(hook.ok, false);
  assert.equal(hook.invoked, 0);
  assert.equal(hook.failed, 1);
  assert.equal(String(hook.errors?.[0]?.error || "").includes("escaped mod root"), true);

  fs.rmSync(temp.dir, { recursive: true, force: true });
});
