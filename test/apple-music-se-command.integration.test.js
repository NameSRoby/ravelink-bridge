const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");
const SOURCE_MOD_DIR = path.join(REPO_ROOT, "mods", "song-request-mod");

function buildQueueEntry({ requestId, title, artist, username, userId, status = "queued" }) {
  const rid = Number(requestId || 0);
  return {
    requestId: rid,
    target: "queue",
    status,
    input: `${title} ${artist}`.trim(),
    query: `${title} ${artist}`.trim(),
    username,
    userId,
    userKey: `${String(userId || "").toLowerCase()}::${String(username || "").toLowerCase()}`,
    source: "chat",
    queuedAt: Date.now(),
    updatedAt: Date.now(),
    song: {
      provider: "stub",
      providerId: `stub-${rid}`,
      sourceUrl: "",
      title,
      artist,
      album: "",
      durationSec: 210
    }
  };
}

function createFixture({ configPatch, statePatch, skipStartupGuard = false } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(REPO_ROOT, ".tmp-apple-se-command-"));
  const modDir = path.join(tempRoot, "mods", "song-request-mod");
  fs.mkdirSync(path.dirname(modDir), { recursive: true });
  fs.cpSync(SOURCE_MOD_DIR, modDir, { recursive: true });

  const configPath = path.join(modDir, "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.playerMode = "bridge";
  config.resolverMode = "stub";
  config.browserDriver = {
    ...(config.browserDriver || {}),
    enabled: false
  };
  if (typeof configPatch === "function") {
    configPatch(config);
  }
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const statePath = path.join(modDir, "state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (typeof statePatch === "function") {
    statePatch(state);
  }
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const runtimeDir = path.join(modDir, ".runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.rmSync(path.join(runtimeDir, "overlay-access-token.json"), { force: true });
  const startupGuardPath = path.join(runtimeDir, "startup-queue-reset.guard.json");
  if (!skipStartupGuard) {
    fs.writeFileSync(
      startupGuardPath,
      `${JSON.stringify({ pid: process.pid, appliedAt: Date.now() }, null, 2)}\n`,
      "utf8"
    );
  } else {
    fs.rmSync(startupGuardPath, { force: true });
  }

  const modPath = path.join(modDir, "index.js");
  const loaded = require(modPath);
  return {
    mod: loaded,
    modDir,
    modPath,
    cleanup() {
      delete require.cache[require.resolve(modPath)];
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  };
}

function trustedLocalModUiRequest() {
  return {
    ip: "::ffff:127.0.0.1",
    headers: {
      host: "127.0.0.1:5050",
      origin: "http://127.0.0.1:5050",
      referer: "http://127.0.0.1:5050/mods-ui/music-request-engine"
    }
  };
}

async function callSeCommand(mod, query = {}) {
  return callAction(mod, "se_command", { query });
}

async function callAction(mod, action, { query = {}, body = {}, headers = {}, ip = "", originalUrl = "" } = {}) {
  const response = await mod.actions[action]({
    api: {
      id: "music-request-engine",
      manifest: { id: "music-request-engine" },
      log: () => {}
    },
    payload: {
      query,
      body,
      headers,
      ip,
      originalUrl
    }
  });
  return response;
}

test("se_command queue returns formatted queue snapshot", async () => {
  const fixture = createFixture({
    statePatch: state => {
      state.queue = [
        buildQueueEntry({
          requestId: 2,
          title: "Everlong",
          artist: "Foo Fighters",
          username: "viewerA",
          userId: "user-a"
        })
      ];
      state.nowPlaying = {
        requestId: 1,
        title: "Numb",
        artist: "Linkin Park",
        album: "",
        videoId: "",
        sourceUrl: "",
        requesterKey: "user-b::viewerb",
        durationSec: 300,
        elapsedSec: 40,
        isPlaying: true,
        requester: "viewerB",
        updatedAt: Date.now()
      };
    }
  });

  try {
    const res = await callSeCommand(fixture.mod, {
      cmd: "queue",
      user: "viewerA",
      uid: "user-a",
      msgId: "msg-queue-1"
    });
    assert.equal(res.status, 200);
    assert.match(String(res.body || ""), /Next 1:/i);
    assert.match(String(res.body || ""), /Everlong/i);
  } finally {
    fixture.cleanup();
  }
});

test("se_command remove removes owned queued request", async () => {
  const fixture = createFixture({
    statePatch: state => {
      state.queue = [
        buildQueueEntry({
          requestId: 10,
          title: "Hysteria",
          artist: "Muse",
          username: "viewerRemove",
          userId: "user-remove"
        })
      ];
      state.nowPlaying = {
        ...(state.nowPlaying || {}),
        isPlaying: false,
        title: "",
        artist: "",
        requestId: 0
      };
    }
  });

  try {
    const res = await callSeCommand(fixture.mod, {
      cmd: "remove",
      args: "10",
      user: "viewerRemove",
      uid: "user-remove",
      msgId: "msg-remove-1"
    });
    assert.equal(res.status, 200);
    assert.match(String(res.body || ""), /viewerRemove removed Hysteria from queue/i);

    const state = await callAction(fixture.mod, "state");
    assert.equal(state.body?.queue?.length || 0, 0);
  } finally {
    fixture.cleanup();
  }
});

test("se_command remove fuzzy-matches out-of-order song text for moderators", async () => {
  const fixture = createFixture({
    statePatch: state => {
      state.queue = [
        buildQueueEntry({
          requestId: 11,
          title: "The Less I Know The Better",
          artist: "Tame Impala",
          username: "viewerOther",
          userId: "user-other"
        }),
        buildQueueEntry({
          requestId: 12,
          title: "Hysteria",
          artist: "Muse",
          username: "viewerMuse",
          userId: "user-muse"
        })
      ];
    }
  });

  try {
    const res = await callSeCommand(fixture.mod, {
      cmd: "remove",
      text: "!remove better less know",
      user: "modRemove",
      uid: "mod-remove",
      mod: "true",
      msgId: "msg-remove-fuzzy-1"
    });
    assert.equal(res.status, 200);
    assert.match(String(res.body || ""), /removed The Less I Know The Better from queue/i);

    const state = await callAction(fixture.mod, "state");
    const titles = (state.body?.queue || []).map(item => item?.song?.title);
    assert.deepEqual(titles, ["Hysteria"]);
  } finally {
    fixture.cleanup();
  }
});

test("se_command remove rejects fuzzy match against another viewer for normal chatters", async () => {
  const fixture = createFixture({
    statePatch: state => {
      state.queue = [
        buildQueueEntry({
          requestId: 13,
          title: "The Less I Know The Better",
          artist: "Tame Impala",
          username: "viewerOther",
          userId: "user-other"
        })
      ];
    }
  });

  try {
    const res = await callSeCommand(fixture.mod, {
      text: "!remove less better",
      user: "viewerNormal",
      uid: "user-normal",
      msgId: "msg-remove-fuzzy-deny-1"
    });
    assert.equal(res.status, 200);
    assert.match(String(res.body || ""), /you can only remove your own requests/i);

    const state = await callAction(fixture.mod, "state");
    assert.equal(state.body?.queue?.length || 0, 1);
  } finally {
    fixture.cleanup();
  }
});

test("se_command skip skips current queue track for owner", async () => {
  const fixture = createFixture({
    statePatch: state => {
      state.queue = [
        buildQueueEntry({
          requestId: 21,
          title: "Uprising",
          artist: "Muse",
          username: "viewerSkip",
          userId: "user-skip",
          status: "submitted"
        }),
        buildQueueEntry({
          requestId: 22,
          title: "Starlight",
          artist: "Muse",
          username: "viewerOther",
          userId: "user-other"
        })
      ];
      state.nowPlaying = {
        requestId: 21,
        title: "Uprising",
        artist: "Muse",
        album: "",
        videoId: "",
        sourceUrl: "",
        requesterKey: "user-skip::viewerskip",
        durationSec: 240,
        elapsedSec: 90,
        isPlaying: true,
        requester: "viewerSkip",
        updatedAt: Date.now()
      };
    }
  });

  try {
    const res = await callSeCommand(fixture.mod, {
      cmd: "skip",
      user: "viewerSkip",
      uid: "user-skip",
      msgId: "msg-skip-1"
    });
    assert.equal(res.status, 200);
    assert.match(String(res.body || ""), /viewerSkip skipped the current song/i);
  } finally {
    fixture.cleanup();
  }
});

test("se_command skip lets moderator skip non-queued current playback without dropping queued songs", async () => {
  const fixture = createFixture({
    statePatch: state => {
      state.queue = [
        buildQueueEntry({
          requestId: 31,
          title: "Queued Next",
          artist: "Future Band",
          username: "viewerQueued",
          userId: "user-queued"
        })
      ];
      state.nowPlaying = {
        requestId: 0,
        title: "Personal Listening Track",
        artist: "Desk DJ",
        album: "",
        videoId: "personal-track",
        sourceUrl: "",
        requesterKey: "",
        durationSec: 180,
        elapsedSec: 33,
        isPlaying: true,
        requester: "",
        updatedAt: Date.now()
      };
      state.playerActions = [];
    }
  });

  try {
    const res = await callSeCommand(fixture.mod, {
      text: "!skip",
      user: "modSkip",
      uid: "mod-skip",
      mod: "true",
      msgId: "msg-skip-nonqueue-1"
    });
    assert.equal(res.status, 200);
    assert.match(String(res.body || ""), /modSkip skipped the current song/i);

    const state = await callAction(fixture.mod, "state");
    assert.equal(state.body?.queue?.length || 0, 1);
    const action = (state.body?.playerActions || []).find(item => item?.type === "skip_next");
    assert.equal(action?.payload?.nonQueueCurrent, true);
    assert.equal(Number(action?.payload?.requestId || 0), 0);
  } finally {
    fixture.cleanup();
  }
});

test("se_command skip rejects non-queued current playback for normal chatters", async () => {
  const fixture = createFixture({
    statePatch: state => {
      state.queue = [];
      state.nowPlaying = {
        requestId: 0,
        title: "Broadcaster's Own Song",
        artist: "Desk DJ",
        album: "",
        videoId: "personal-track",
        sourceUrl: "",
        requesterKey: "",
        durationSec: 180,
        elapsedSec: 33,
        isPlaying: true,
        requester: "",
        updatedAt: Date.now()
      };
    }
  });

  try {
    const res = await callSeCommand(fixture.mod, {
      text: "!skip",
      user: "viewerSkipDeny",
      uid: "user-skip-deny",
      msgId: "msg-skip-nonqueue-deny-1"
    });
    assert.equal(res.status, 200);
    assert.match(String(res.body || ""), /you can only skip your own currently playing song/i);
  } finally {
    fixture.cleanup();
  }
});

test("se_command pause then resume for moderator", async () => {
  const fixture = createFixture({
    statePatch: state => {
      state.queue = [];
      state.nowPlaying = {
        requestId: 31,
        title: "Take On Me",
        artist: "a-ha",
        album: "",
        videoId: "",
        sourceUrl: "",
        requesterKey: "",
        durationSec: 225,
        elapsedSec: 33,
        isPlaying: true,
        requester: "",
        updatedAt: Date.now()
      };
    }
  });

  try {
    const pause = await callSeCommand(fixture.mod, {
      cmd: "pause",
      user: "modUser",
      uid: "mod-1",
      mod: "true",
      msgId: "msg-pause-1"
    });
    assert.equal(pause.status, 200);
    assert.match(String(pause.body || ""), /modUser paused playback/i);

    const resume = await callSeCommand(fixture.mod, {
      cmd: "resume",
      user: "modUser",
      uid: "mod-1",
      mod: "true",
      msgId: "msg-resume-1"
    });
    assert.equal(resume.status, 200);
    assert.match(String(resume.body || ""), /modUser resumed playback/i);
  } finally {
    fixture.cleanup();
  }
});

test("se_command supports play-equivalent routing when command token resolves to resume", async () => {
  const fixture = createFixture({
    statePatch: state => {
      state.nowPlaying = {
        requestId: 41,
        title: "Africa",
        artist: "Toto",
        album: "",
        videoId: "",
        sourceUrl: "",
        requesterKey: "",
        durationSec: 295,
        elapsedSec: 120,
        isPlaying: false,
        requester: "",
        updatedAt: Date.now()
      };
    }
  });

  try {
    const res = await callSeCommand(fixture.mod, {
      action: "resume",
      text: "!play",
      user: "modPlay",
      uid: "mod-play-1",
      mod: "true",
      msgId: "msg-play-1"
    });
    assert.equal(res.status, 200);
    assert.match(String(res.body || ""), /modPlay resumed playback/i);
  } finally {
    fixture.cleanup();
  }
});

test("se_command volume maps 1-100 input through configured output range for broadcaster", async () => {
  const fixture = createFixture({
    configPatch: config => {
      config.twitchRefund = {
        ...(config.twitchRefund || {}),
        broadcasterId: "broadcaster-1"
      };
      config.audioControls = {
        ...(config.audioControls || {}),
        enabled: true,
        minOutputPercent: 20,
        maxOutputPercent: 70
      };
    }
  });

  try {
    const res = await callSeCommand(fixture.mod, {
      text: "!volume 50",
      user: "theBroadcaster",
      uid: "broadcaster-1",
      msgId: "msg-volume-broadcaster-1"
    });
    assert.equal(res.status, 200);
    assert.match(String(res.body || ""), /set music volume to 50%/i);
    assert.match(String(res.body || ""), /mapped output 44\.7%/i);

    const state = await callAction(fixture.mod, "state");
    assert.equal(state.body?.audio?.userInputPercent, 50);
    assert.equal(state.body?.audio?.outputPercent, 44.7);
  } finally {
    fixture.cleanup();
  }
});

test("se_command volume rejects normal chatters", async () => {
  const fixture = createFixture({
    configPatch: config => {
      config.audioControls = {
        ...(config.audioControls || {}),
        enabled: true
      };
    }
  });

  try {
    const res = await callSeCommand(fixture.mod, {
      text: "!volume 50",
      user: "viewerVolume",
      uid: "user-volume",
      msgId: "msg-volume-deny-1"
    });
    assert.equal(res.status, 200);
    assert.match(String(res.body || ""), /only moderators can change volume/i);
  } finally {
    fixture.cleanup();
  }
});

test("request + player_pull preserves submission order", async () => {
  const fixture = createFixture();
  try {
    const first = await callAction(fixture.mod, "request", {
      body: {
        text: "First Song",
        user: "viewerOne",
        uid: "user-one",
        eventMessageId: "evt-order-1"
      }
    });
    const second = await callAction(fixture.mod, "request", {
      body: {
        text: "Second Song",
        user: "viewerTwo",
        uid: "user-two",
        eventMessageId: "evt-order-2"
      }
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    const pull = await callAction(fixture.mod, "player_pull", { query: { limit: 8 } });
    assert.equal(pull.status, 200);
    assert.equal(pull.body?.ok, true);
    const actions = Array.isArray(pull.body?.actions) ? pull.body.actions : [];
    const enqueued = actions.filter(item => String(item?.type || "") === "enqueue_song");
    assert.equal(enqueued.length >= 2, true);

    const firstRequestId = Number(first.body?.entry?.requestId || 0);
    const secondRequestId = Number(second.body?.entry?.requestId || 0);
    assert.equal(Number(enqueued[0]?.payload?.requestId || 0), firstRequestId);
    assert.equal(Number(enqueued[1]?.payload?.requestId || 0), secondRequestId);
  } finally {
    fixture.cleanup();
  }
});

test("server-managed Apple dispatch waits when play-next reserve is already occupied", async () => {
  const fixture = createFixture({
    configPatch: config => {
      config.playerMode = "browser-driver";
      config.browserDriver = {
        ...(config.browserDriver || {}),
        enabled: true,
        musicService: "apple-music"
      };
    },
    statePatch: state => {
      state.queue = [
        buildQueueEntry({
          requestId: 1,
          title: "Aurora Drift",
          artist: "Neon Pulse",
          username: "viewerA",
          userId: "user-a",
          status: "submitted"
        }),
        buildQueueEntry({
          requestId: 2,
          title: "Broken Compass",
          artist: "Stone Harbor",
          username: "viewerB",
          userId: "user-b",
          status: "submitted"
        }),
        buildQueueEntry({
          requestId: 3,
          title: "Cloud Atlas",
          artist: "Night Engine",
          username: "viewerC",
          userId: "user-c",
          status: "queued"
        })
      ];
      state.nowPlaying = {
        requestId: 1,
        title: "Aurora Drift",
        artist: "Neon Pulse",
        album: "",
        videoId: "",
        sourceUrl: "",
        requesterKey: "user-a::viewera",
        durationSec: 240,
        elapsedSec: 75,
        isPlaying: true,
        requester: "viewerA",
        updatedAt: Date.now()
      };
      state.playerActions = [];
    }
  });

  try {
    const res = await callAction(fixture.mod, "status");
    assert.equal(res.status, 200);
    assert.equal(res.body?.ok, true);
    assert.equal(String(res.body?.summary?.appleDispatchWaitReason || ""), "reserve_full");
  } finally {
    fixture.cleanup();
  }
});

test("server-managed Apple dispatch reserves one external-playback up-next slot in FIFO order", async () => {
  const fixture = createFixture({
    configPatch: config => {
      config.playerMode = "browser-driver";
      config.browserDriver = {
        ...(config.browserDriver || {}),
        enabled: true,
        musicService: "apple-music"
      };
    },
    statePatch: state => {
      state.queue = [
        buildQueueEntry({
          requestId: 40,
          title: "Nuclear",
          artist: "Mike Oldfield",
          username: "viewerFirst",
          userId: "user-first",
          status: "submitted"
        }),
        buildQueueEntry({
          requestId: 41,
          title: "Short Change Hero",
          artist: "The Heavy",
          username: "viewerSecond",
          userId: "user-second",
          status: "queued"
        })
      ];
      state.nowPlaying = {
        requestId: 0,
        title: "Re:Re:",
        artist: "Asian Kung-Fu Generation",
        album: "",
        videoId: "",
        sourceUrl: "",
        requesterKey: "",
        durationSec: 228,
        elapsedSec: 88,
        isPlaying: true,
        requester: "",
        updatedAt: Date.now()
      };
      state.playerActions = [];
    }
  });

  try {
    const reserveFull = await callAction(fixture.mod, "status");
    assert.equal(reserveFull.status, 200);
    assert.equal(String(reserveFull.body?.summary?.appleDispatchWaitReason || ""), "reserve_full");

    const state = await callAction(fixture.mod, "state");
    assert.deepEqual(
      (state.body?.queue || []).map(item => item?.song?.title),
      ["Nuclear", "Short Change Hero"]
    );
  } finally {
    fixture.cleanup();
  }
});

test("server-managed Apple startup reset does not request browser up-next trimming", async () => {
  const fixture = createFixture({
    skipStartupGuard: true,
    configPatch: config => {
      config.playerMode = "browser-driver";
      config.browserDriver = {
        ...(config.browserDriver || {}),
        enabled: true,
        musicService: "apple-music"
      };
    },
    statePatch: state => {
      state.queue = [
        buildQueueEntry({
          requestId: 50,
          title: "Stale Viewer Request",
          artist: "Past Stream",
          username: "viewerOld",
          userId: "user-old"
        })
      ];
    }
  });

  try {
    const driver = await callAction(fixture.mod, "driver_status", {
      ip: "::ffff:127.0.0.1",
      headers: {
        host: "127.0.0.1:5050",
        origin: "http://127.0.0.1:5050",
        referer: "http://127.0.0.1:5050/mods-ui/music-request-engine"
      }
    });
    assert.equal(driver.status, 200);

    const state = await callAction(fixture.mod, "state");
    assert.equal(state.body?.queue?.length || 0, 0);
    assert.equal(
      (state.body?.events || []).some(item => String(item?.type || "").includes("startup_trim")),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("overlay URL helper keeps generated token stable across mod restart", async () => {
  const fixture = createFixture({
    configPatch: config => {
      config.security = {
        ...(config.security || {}),
        requireAdminSecret: false,
        overlayAccessToken: ""
      };
    }
  });
  try {
    const request = trustedLocalModUiRequest();
    const first = await callAction(fixture.mod, "admin_overlay_url_get", {
      ...request,
      body: { publicBaseUrl: "http://127.0.0.1:5050" }
    });
    assert.equal(first.status, 200);
    assert.equal(first.body?.ok, true);
    assert.equal(first.body?.rotated, true);
    const firstUrl = String(first.body?.overlayUrl || "");
    assert.match(firstUrl, /\/mods-ui\/music-request-engine\/overlay\.html\?ovk=/);

    const tokenPath = path.join(fixture.modDir, ".runtime", "overlay-access-token.json");
    const tokenFile = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
    assert.equal(typeof tokenFile.overlayAccessToken, "string");
    assert.ok(tokenFile.overlayAccessToken.length >= 16);

    const persistedConfig = JSON.parse(fs.readFileSync(path.join(fixture.modDir, "config.json"), "utf8"));
    assert.equal(persistedConfig.security?.overlayAccessToken, "");

    delete require.cache[require.resolve(fixture.modPath)];
    const restartedMod = require(fixture.modPath);
    const second = await callAction(restartedMod, "admin_overlay_url_get", {
      ...request,
      body: { publicBaseUrl: "http://127.0.0.1:5050" }
    });
    assert.equal(second.status, 200);
    assert.equal(second.body?.ok, true);
    assert.equal(second.body?.rotated, false);
    assert.equal(second.body?.overlayUrl, firstUrl);
  } finally {
    fixture.cleanup();
  }
});

test("overlay URL helper rotates only when explicitly requested", async () => {
  const fixture = createFixture({
    configPatch: config => {
      config.security = {
        ...(config.security || {}),
        requireAdminSecret: false,
        overlayAccessToken: ""
      };
    }
  });
  try {
    const request = trustedLocalModUiRequest();
    const first = await callAction(fixture.mod, "admin_overlay_url_get", {
      ...request,
      body: { publicBaseUrl: "http://127.0.0.1:5050" }
    });
    assert.equal(first.status, 200);
    assert.equal(first.body?.ok, true);
    assert.equal(first.body?.rotated, true);

    const refresh = await callAction(fixture.mod, "admin_overlay_url_get", {
      ...request,
      body: { publicBaseUrl: "http://127.0.0.1:5050" }
    });
    assert.equal(refresh.status, 200);
    assert.equal(refresh.body?.ok, true);
    assert.equal(refresh.body?.rotated, false);
    assert.equal(refresh.body?.overlayUrl, first.body?.overlayUrl);

    const rotated = await callAction(fixture.mod, "admin_overlay_url_get", {
      ...request,
      body: { rotate: true, publicBaseUrl: "http://127.0.0.1:5050" }
    });
    assert.equal(rotated.status, 200);
    assert.equal(rotated.body?.ok, true);
    assert.equal(rotated.body?.rotated, true);
    assert.notEqual(rotated.body?.overlayUrl, first.body?.overlayUrl);

    delete require.cache[require.resolve(fixture.modPath)];
    const restartedMod = require(fixture.modPath);
    const afterRestart = await callAction(restartedMod, "admin_overlay_url_get", {
      ...request,
      body: { publicBaseUrl: "http://127.0.0.1:5050" }
    });
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.body?.ok, true);
    assert.equal(afterRestart.body?.rotated, false);
    assert.equal(afterRestart.body?.overlayUrl, rotated.body?.overlayUrl);
  } finally {
    fixture.cleanup();
  }
});

test("admin_policy_get denies anonymous caller without explicit admin proof", async () => {
  const fixture = createFixture();
  try {
    const res = await callAction(fixture.mod, "admin_policy_get");
    assert.equal(res.status, 403);
    assert.equal(res.body?.ok, false);
    assert.match(String(res.body?.error || ""), /admin permission required/i);
  } finally {
    fixture.cleanup();
  }
});

test("admin_policy_get allows trusted local mod UI request when admin secret is not required", async () => {
  const fixture = createFixture({
    configPatch: config => {
      config.security = {
        ...(config.security || {}),
        requireAdminSecret: false,
        adminSecret: ""
      };
    }
  });
  try {
    const res = await callAction(fixture.mod, "admin_policy_get", {
      ip: "::ffff:127.0.0.1",
      headers: {
        host: "127.0.0.1:5050",
        origin: "http://127.0.0.1:5050",
        referer: "http://127.0.0.1:5050/mods-ui/music-request-engine"
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body?.ok, true);
  } finally {
    fixture.cleanup();
  }
});

test("admin_history_clear clears persisted playback history for trusted local UI", async () => {
  const fixture = createFixture({
    configPatch: config => {
      config.security = {
        ...(config.security || {}),
        requireAdminSecret: false,
        adminSecret: ""
      };
    },
    statePatch: state => {
      state.playHistory = Array.from({ length: 31 }, (_, index) => ({
        requestId: index + 1,
        title: `History ${index + 1}`,
        artist: "Fixture",
        requester: "viewer",
        target: "queue",
        reason: "ended",
        elapsedSec: 200,
        durationSec: 210,
        endedAt: Date.now() - index
      }));
    }
  });
  try {
    const res = await callAction(fixture.mod, "admin_history_clear", trustedLocalModUiRequest());
    assert.equal(res.status, 200);
    assert.equal(res.body?.ok, true);
    assert.equal(res.body?.cleared, 31);
    assert.equal(res.body?.historyCount, 0);

    const stateRes = await callAction(fixture.mod, "state");
    assert.equal(stateRes.status, 200);
    assert.equal(Array.isArray(stateRes.body?.playHistory), true);
    assert.equal(stateRes.body.playHistory.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("admin_policy_get rejects query secret and accepts header secret when admin secret is required", async () => {
  const fixture = createFixture({
    configPatch: config => {
      config.security = {
        ...(config.security || {}),
        requireAdminSecret: true,
        adminSecret: "admin-only-secret"
      };
    }
  });
  try {
    const viaQuery = await callAction(fixture.mod, "admin_policy_get", {
      query: { apiKey: "admin-only-secret" }
    });
    assert.equal(viaQuery.status, 401);
    assert.equal(viaQuery.body?.ok, false);
    assert.match(String(viaQuery.body?.error || ""), /admin secret required/i);

    const viaHeader = await callAction(fixture.mod, "admin_policy_get", {
      headers: { "x-api-key": "admin-only-secret" }
    });
    assert.equal(viaHeader.status, 200);
    assert.equal(viaHeader.body?.ok, true);
  } finally {
    fixture.cleanup();
  }
});

test("chat_dedupe_claim does not source mutating payload fields from query", async () => {
  const fixture = createFixture();
  try {
    const res = await callAction(fixture.mod, "chat_dedupe_claim", {
      query: { dedupeKey: "legacy-query-key" }
    });
    assert.equal(res.status, 400);
    assert.equal(res.body?.ok, false);
    assert.match(String(res.body?.error || ""), /missing dedupeKey/i);
  } finally {
    fixture.cleanup();
  }
});

test("status omits permissions and role directory metadata", async () => {
  const fixture = createFixture();
  try {
    const res = await callAction(fixture.mod, "status");
    assert.equal(res.status, 200);
    assert.equal(res.body?.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(res.body || {}, "permissions"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(res.body || {}, "roleDirectoryCount"), false);
  } finally {
    fixture.cleanup();
  }
});
