// [TITLE] Test Module: test/ui-live-sync-groups-transport-ui.test.js
// [TITLE] Purpose: guard LIVE sync-groups transport split

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadRuntimeFactory() {
  const filePath = path.resolve(__dirname, "..", "public", "assets", "js", "domains", "live", "live-sync-groups-transport-ui.js");
  const context = { console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename: filePath });
  return context.createLiveSyncGroupsTransportUi;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("LIVE sync-groups transport loads fallback read and saves canonical writes", async () => {
  const createLiveSyncGroupsTransportUi = loadRuntimeFactory();
  const applied = [];
  const badges = [];
  const statuses = [];
  const writePayloads = [];
  const ui = { liveSyncGroups: { enabled: false, groups: [] } };

  const runtime = createLiveSyncGroupsTransportUi({
    ui,
    el: { health: {} },
    liveEndpointsAdapter: {
      async getSyncGroups() {
        return { ok: false };
      },
      async getTriggerMatrix() {
        return { ok: true, syncGroups: { enabled: true, groups: [{ id: "g1" }] } };
      },
      async patchSyncGroups(profile) {
        writePayloads.push(profile);
        return {
          ok: true,
          data: {
            ok: true,
            snapshot: { enabled: profile.enabled, groups: profile.groups.concat([{ id: "server" }]) }
          }
        };
      }
    },
    setBadge(_node, state, text) {
      badges.push({ state, text });
    },
    setLiveSyncGroupsStatus(text) {
      statuses.push(text);
    },
    applyLiveSyncGroupsUi(snapshot, options) {
      applied.push({ snapshot, options });
      ui.liveSyncGroups = snapshot;
    },
    normalizeLiveSyncGroupsUi(value) {
      return {
        enabled: value?.enabled === true,
        groups: Array.isArray(value?.groups) ? value.groups.slice() : []
      };
    }
  });

  assert.equal(await runtime.loadLiveSyncGroupsUi({ silent: false }), true);
  assert.deepEqual(plain(applied.at(-1)), {
    snapshot: { enabled: true, groups: [{ id: "g1" }] },
    options: { statusText: "Sync groups loaded.", sync: true }
  });

  assert.equal(await runtime.applyLiveSyncGroupsSnapshot({ enabled: true, groups: [{ id: "local" }] }), true);
  assert.deepEqual(plain(writePayloads), [{ enabled: true, groups: [{ id: "local" }] }]);
  assert.deepEqual(plain(applied.at(-1)), {
    snapshot: { enabled: true, groups: [{ id: "local" }, { id: "server" }] },
    options: { statusText: "Sync groups saved.", sync: true }
  });
  assert.deepEqual(plain(badges), [{ state: "ok", text: "SYNC GROUPS SAVED" }]);
  assert.deepEqual(statuses, []);
});

