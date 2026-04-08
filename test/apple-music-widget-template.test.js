// [TITLE] Test Module: test/apple-music-widget-template.test.js
// [TITLE] Purpose: smoke-check Song Request widget template runtime bootstrap behavior

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const WIDGET_TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "mods",
  "song-request-mod",
  "templates",
  "PASTE-INTO-STREAMELEMENTS-CUSTOM-WIDGET.js"
);

function replaceConstAssignment(source = "", constName = "", literal = "''") {
  const name = String(constName || "").trim();
  if (!name) return source;
  const pattern = new RegExp(`(^\\s*const\\s+${name}\\s*=\\s*)([^;]+)(;\\s*$)`, "m");
  if (!pattern.test(source)) return source;
  return source.replace(pattern, `$1${literal}$3`);
}

function buildWidgetScript(replacements = {}) {
  let script = fs.readFileSync(WIDGET_TEMPLATE_PATH, "utf8");
  const rows = Object.entries(replacements);
  for (const [key, literal] of rows) {
    script = replaceConstAssignment(script, key, literal);
  }
  return script;
}

function createWidgetVmContext(options = {}) {
  const listeners = new Map();
  const fetchCalls = [];
  const intervalFns = new Map();
  let nextIntervalId = 1;
  const fetchImpl = options.fetchImpl || (async () => ({
    ok: true,
    status: 200,
    text: async () => "{}"
  }));
  const context = {
    URL,
    Date,
    setTimeout,
    clearTimeout,
    setInterval: handler => {
      const id = nextIntervalId;
      nextIntervalId += 1;
      intervalFns.set(id, handler);
      return id;
    },
    clearInterval: intervalId => {
      intervalFns.delete(Number(intervalId || 0));
    },
    fetch: async (url, init) => {
      fetchCalls.push({
        url: String(url || ""),
        method: String(init?.method || "GET").toUpperCase(),
        body: init?.body ? String(init.body) : ""
      });
      return fetchImpl(url, init);
    },
    console: {
      log: () => {},
      warn: () => {}
    },
    window: {
      location: { origin: "https://streamelements.com" },
      addEventListener: (eventName, handler) => {
        listeners.set(String(eventName), handler);
      }
    }
  };
  return {
    context,
    listeners,
    fetchCalls,
    async runIntervals() {
      const runners = Array.from(intervalFns.values());
      for (const handler of runners) {
        if (typeof handler !== "function") continue;
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve(handler());
      }
    }
  };
}

async function flushMicrotasks(iterations = 3) {
  for (let i = 0; i < iterations; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

test("Song Request widget template bootstraps and exposes runtime API", () => {
  const script = buildWidgetScript();
  const { context, listeners } = createWidgetVmContext();

  vm.runInNewContext(script, context, { timeout: 2000 });

  const api = context.window.RaveLinkSongRequestWidget;
  assert.equal(typeof api, "object");
  assert.equal(typeof api?.onEventReceived, "function");
  assert.equal(typeof api?.config, "object");
  assert.equal(typeof api?.config?.enableChatCommands, "boolean");
  assert.equal(typeof api?.config?.botEnabled, "boolean");
  assert.equal(typeof api?.config?.nowPlayingAnnouncerEnabled, "boolean");
  assert.equal(typeof listeners.get("onEventReceived"), "function");
});

test("Song Request widget handles nested redemption envelopes and dispatches request action", async () => {
  const script = buildWidgetScript({
    SONG_REQUEST_REWARD_ID: JSON.stringify("reward-song")
  });
  const { context, fetchCalls } = createWidgetVmContext({
    fetchImpl: async url => {
      const requestUrl = String(url || "");
      if (requestUrl.endsWith("/chat_dedupe_claim")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, claimed: true })
        };
      }
      if (requestUrl.endsWith("/request")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, chatMessage: "queued" })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "{}"
      };
    }
  });

  vm.runInNewContext(script, context, { timeout: 2000 });
  const api = context.window.RaveLinkSongRequestWidget;
  api.onEventReceived({
    detail: {
      listener: "event",
      event: {
        data: {
          redemption: {
            id: "red-1",
            user_input: "Queen - Bohemian Rhapsody",
            user_name: "viewerA",
            user_id: "user-1",
            broadcaster_id: "broad-1",
            reward: { id: "reward-song" }
          }
        }
      }
    }
  });

  await flushMicrotasks();

  const requestCall = fetchCalls.find(call => call.url.endsWith("/request"));
  assert.ok(requestCall, "expected request action call");
  const payload = requestCall?.body ? JSON.parse(requestCall.body) : {};
  assert.equal(payload.target, "queue");
  assert.equal(payload.text, "Queen - Bohemian Rhapsody");
  assert.equal(payload.query, "Queen - Bohemian Rhapsody");
  assert.equal(payload.rewardId, "reward-song");
  assert.equal(payload.redemptionId, "red-1");
  assert.equal(payload.username, "viewerA");
  assert.equal(payload.userId, "user-1");
  assert.equal(payload.broadcasterId, "broad-1");
});

test("Song Request widget handles legacy reward-id tags payloads", async () => {
  const script = buildWidgetScript({
    SONG_REQUEST_REWARD_ID: JSON.stringify("reward-song")
  });
  const { context, fetchCalls } = createWidgetVmContext({
    fetchImpl: async url => {
      const requestUrl = String(url || "");
      if (requestUrl.endsWith("/chat_dedupe_claim")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, claimed: true })
        };
      }
      if (requestUrl.endsWith("/request")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, chatMessage: "queued" })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "{}"
      };
    }
  });

  vm.runInNewContext(script, context, { timeout: 2000 });
  const api = context.window.RaveLinkSongRequestWidget;
  api.onEventReceived({
    detail: {
      listener: "event",
      event: {
        data: {
          tags: {
            "custom-reward-id": "reward-song",
            "room-id": "broad-legacy"
          },
          redemption: {
            id: "red-legacy-1",
            user_input: "Muse - Uprising",
            user_name: "legacyViewer",
            user_id: "legacy-user-1"
          }
        }
      }
    }
  });

  await flushMicrotasks();

  const requestCall = fetchCalls.find(call => call.url.endsWith("/request"));
  assert.ok(requestCall, "expected request action call for legacy reward tags");
  const payload = requestCall?.body ? JSON.parse(requestCall.body) : {};
  assert.equal(payload.target, "queue");
  assert.equal(payload.text, "Muse - Uprising");
  assert.equal(payload.rewardId, "reward-song");
  assert.equal(payload.redemptionId, "red-legacy-1");
  assert.equal(payload.username, "legacyViewer");
  assert.equal(payload.userId, "legacy-user-1");
  assert.equal(payload.broadcasterId, "broad-legacy");
});

test("Song Request widget handles StreamElements item redemption envelopes", async () => {
  const script = buildWidgetScript({
    SONG_REQUEST_REWARD_ID: JSON.stringify("reward-song")
  });
  const { context, fetchCalls } = createWidgetVmContext({
    fetchImpl: async url => {
      const requestUrl = String(url || "");
      if (requestUrl.endsWith("/chat_dedupe_claim")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, claimed: true })
        };
      }
      if (requestUrl.endsWith("/request")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, chatMessage: "queued" })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "{}"
      };
    }
  });

  vm.runInNewContext(script, context, { timeout: 2000 });
  const api = context.window.RaveLinkSongRequestWidget;
  api.onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        item: {
          id: "red-item-1",
          user_input: "Daft Punk - One More Time",
          reward: { id: "reward-song" }
        }
      }
    }
  });

  await flushMicrotasks();

  const requestCall = fetchCalls.find(call => call.url.endsWith("/request"));
  assert.ok(requestCall, "expected request action call for item envelope");
  const payload = requestCall?.body ? JSON.parse(requestCall.body) : {};
  assert.equal(payload.target, "queue");
  assert.equal(payload.query, "Daft Punk - One More Time");
  assert.equal(payload.rewardId, "reward-song");
  assert.equal(payload.redemptionId, "red-item-1");
});

test("Song Request widget executes chat commands even when listener token is generic", async () => {
  const script = buildWidgetScript({
    ENABLE_CHAT_COMMANDS: "true",
    REQUEST_COMMAND: JSON.stringify("!request")
  });
  const { context, fetchCalls } = createWidgetVmContext({
    fetchImpl: async url => {
      const requestUrl = String(url || "");
      if (requestUrl.endsWith("/chat_dedupe_claim")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, claimed: true })
        };
      }
      if (requestUrl.endsWith("/request")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, chatMessage: "queued" })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "{}"
      };
    }
  });

  vm.runInNewContext(script, context, { timeout: 2000 });
  const api = context.window.RaveLinkSongRequestWidget;
  api.onEventReceived({
    detail: {
      listener: "event",
      event: {
        data: {
          text: "!request Lose Yourself",
          displayName: "viewerB",
          userId: "user-2",
          msgId: "msg-2"
        }
      }
    }
  });

  await flushMicrotasks();

  const requestCall = fetchCalls.find(call => call.url.endsWith("/request"));
  assert.ok(requestCall, "expected chat command request action");
  const payload = requestCall?.body ? JSON.parse(requestCall.body) : {};
  assert.equal(payload.query, "Lose Yourself");
  assert.equal(payload.username, "viewerB");
  assert.equal(payload.userId, "user-2");
  assert.equal(payload.eventMessageId, "msg-2");
});

test("Song Request widget now-playing announcer ignores navigation titles", async () => {
  const script = buildWidgetScript({
    STREAMELEMENTS_BOT_CHAT_ENABLED: "true",
    STREAMELEMENTS_BOT_CHANNEL_ID: JSON.stringify("channel-1"),
    STREAMELEMENTS_BOT_JWT: JSON.stringify("jwt-1")
  });
  let stateReads = 0;
  const { context, fetchCalls, runIntervals } = createWidgetVmContext({
    fetchImpl: async url => {
      const requestUrl = String(url || "");
      if (requestUrl.endsWith("/state")) {
        stateReads += 1;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            ok: true,
            nowPlaying: {
              isPlaying: true,
              title: "Favourite Songs - Playlist",
              artist: ""
            }
          })
        };
      }
      if (requestUrl.endsWith("/chat_dedupe_claim")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, claimed: true })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "{}"
      };
    }
  });

  vm.runInNewContext(script, context, { timeout: 2000 });
  await runIntervals();
  await flushMicrotasks();

  assert.equal(stateReads > 0, true);
  const botCall = fetchCalls.find(call => call.url.includes("/kappa/v2/bot/"));
  assert.equal(Boolean(botCall), false);
});

test("Song Request widget now-playing announcer dedupes repeated track snapshots", async () => {
  const script = buildWidgetScript({
    STREAMELEMENTS_BOT_CHAT_ENABLED: "true",
    STREAMELEMENTS_BOT_CHANNEL_ID: JSON.stringify("channel-2"),
    STREAMELEMENTS_BOT_JWT: JSON.stringify("jwt-2")
  });
  let stateReads = 0;
  const { context, fetchCalls, runIntervals } = createWidgetVmContext({
    fetchImpl: async url => {
      const requestUrl = String(url || "");
      if (requestUrl.endsWith("/state")) {
        stateReads += 1;
        const requestId = stateReads;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            ok: true,
            nowPlaying: {
              isPlaying: true,
              title: "Nuclear",
              artist: "Mike Oldfield",
              requestId
            }
          })
        };
      }
      if (requestUrl.endsWith("/chat_dedupe_claim")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, claimed: true })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "{}"
      };
    }
  });

  vm.runInNewContext(script, context, { timeout: 2000 });
  await runIntervals();
  await flushMicrotasks();
  await runIntervals();
  await flushMicrotasks();

  const botCalls = fetchCalls.filter(call => call.url.includes("/kappa/v2/bot/"));
  assert.equal(botCalls.length, 1);
  const body = botCalls[0]?.body ? JSON.parse(botCalls[0].body) : {};
  assert.equal(String(body.message || "").includes("Now playing: Nuclear - Mike Oldfield"), true);
});

test("Song Request widget matches reward names with case and typo tolerance", async () => {
  const script = buildWidgetScript({
    SONG_REQUEST_REWARD_ID: JSON.stringify("Song Request")
  });
  const { context, fetchCalls } = createWidgetVmContext({
    fetchImpl: async url => {
      const requestUrl = String(url || "");
      if (requestUrl.endsWith("/chat_dedupe_claim")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, claimed: true })
        };
      }
      if (requestUrl.endsWith("/request")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, chatMessage: "queued" })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "{}"
      };
    }
  });

  vm.runInNewContext(script, context, { timeout: 2000 });
  const api = context.window.RaveLinkSongRequestWidget;

  api.onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        data: {
          tags: {
            "custom-reward-id": "unrelated-reward-id-1",
            "custom-reward-title": "song request"
          },
          redemption: {
            id: "red-name-case-1",
            user_input: "Nine Inch Nails - Closer"
          }
        }
      }
    }
  });

  api.onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        data: {
          tags: {
            "custom-reward-id": "unrelated-reward-id-2",
            "custom-reward-title": "song requset"
          },
          redemption: {
            id: "red-name-typo-2",
            user_input: "Justice - D.A.N.C.E."
          }
        }
      }
    }
  });

  await flushMicrotasks();

  const requestCalls = fetchCalls.filter(call => call.url.endsWith("/request"));
  assert.equal(requestCalls.length, 2);
  const firstPayload = requestCalls[0]?.body ? JSON.parse(requestCalls[0].body) : {};
  const secondPayload = requestCalls[1]?.body ? JSON.parse(requestCalls[1].body) : {};
  assert.equal(firstPayload.query, "Nine Inch Nails - Closer");
  assert.equal(secondPayload.query, "Justice - D.A.N.C.E.");
});
