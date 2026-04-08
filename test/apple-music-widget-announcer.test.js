// [TITLE] Test Module: test/apple-music-widget-announcer.test.js
// [TITLE] Purpose: song-request StreamElements widget now-playing announcer reliability

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const templatePath = path.join(
  __dirname,
  "..",
  "mods",
  "song-request-mod",
  "templates",
  "PASTE-INTO-STREAMELEMENTS-CUSTOM-WIDGET.js"
);

function createFetchResponse({ ok = true, status = 200, body = { ok: true } } = {}) {
  const textBody = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok,
    status,
    text: async () => textBody
  };
}

function replaceConst(source, name, literal) {
  const pattern = new RegExp(`(^\\s*const\\s+${name}\\s*=\\s*)([^;]+)(;\\s*$)`, "m");
  assert.match(source, pattern, `template should define ${name}`);
  return source.replace(pattern, `$1${literal}$3`);
}

function buildWidgetScript() {
  let source = fs.readFileSync(templatePath, "utf8");
  source = replaceConst(source, "BASE_URL", JSON.stringify("http://127.0.0.1:5050"));
  source = replaceConst(source, "STREAMELEMENTS_BOT_CHAT_ENABLED", "true");
  source = replaceConst(source, "STREAMELEMENTS_BOT_CHANNEL_ID", JSON.stringify("channel-id"));
  source = replaceConst(source, "STREAMELEMENTS_BOT_JWT", JSON.stringify("jwt-token"));
  source = replaceConst(source, "NOW_PLAYING_CHAT_ANNOUNCER_ENABLED", "true");
  source = replaceConst(source, "NOW_PLAYING_CHAT_ANNOUNCER_INTERVAL_MS", "1400");
  return source;
}

async function flushWidgetAsync() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test("song request StreamElements widget retries now-playing announce when bot send fails", async () => {
  const intervals = [];
  const fetchCalls = [];
  const botCalls = [];
  const dedupeWindows = [];
  const statePayload = {
    ok: true,
    nowPlaying: {
      isPlaying: true,
      title: "Nuclear",
      artist: "Mike Oldfield",
      videoId: "apple:nuclear"
    }
  };
  let nowMs = 1_900_000_000_000;

  class FakeDate extends Date {
    constructor(...args) {
      super(args.length ? args[0] : nowMs);
    }

    static now() {
      return nowMs;
    }
  }

  const context = {
    Date: FakeDate,
    URL,
    URLSearchParams,
    setInterval: callback => {
      intervals.push(callback);
      return intervals.length;
    },
    clearInterval: () => {},
    console: {
      log: () => {},
      warn: () => {}
    },
    fetch: async (url, options = {}) => {
      const requestUrl = String(url || "");
      const parsedUrl = new URL(requestUrl, "https://local.invalid");
      fetchCalls.push({ url: requestUrl, options });
      if (requestUrl.endsWith("/state")) {
        return createFetchResponse({ body: statePayload });
      }
      if (requestUrl.includes("/chat_dedupe_claim")) {
        const body = JSON.parse(String(options.body || "{}"));
        dedupeWindows.push(Number(body.windowMs || 0));
        return createFetchResponse({ body: { ok: true, claimed: true } });
      }
      if (parsedUrl.hostname === "api.streamelements.com") {
        botCalls.push({ url: requestUrl, options });
        return createFetchResponse({
          ok: botCalls.length > 1,
          status: botCalls.length > 1 ? 200 : 503,
          body: { ok: botCalls.length > 1 }
        });
      }
      throw new Error(`unexpected fetch ${requestUrl}`);
    },
    window: {
      location: { origin: "https://streamelements.com" },
      addEventListener: () => {}
    }
  };

  vm.runInNewContext(buildWidgetScript(), context, { timeout: 2000 });
  assert.equal(intervals.length, 1, "now-playing announcer should install one polling interval");

  intervals[0]();
  await flushWidgetAsync();
  assert.equal(botCalls.length, 1, "first now-playing attempt should reach the bot API");
  assert.match(String(botCalls[0].options.body || ""), /Nuclear/);

  intervals[0]();
  await flushWidgetAsync();
  assert.equal(botCalls.length, 1, "local retry window should prevent immediate duplicate retry");

  nowMs += 3_000;
  intervals[0]();
  await flushWidgetAsync();
  assert.equal(botCalls.length, 2, "failed bot send should be retried after the short claim window");

  nowMs += 3_000;
  intervals[0]();
  await flushWidgetAsync();
  assert.equal(botCalls.length, 2, "successful now-playing announce should not repeat for the same track");
  assert.ok(dedupeWindows.every(value => value > 0 && value <= 6000), "now-playing pre-send dedupe should stay short enough to retry");
  assert.ok(fetchCalls.some(call => call.url.endsWith("/state")), "announcer should poll mod state");
});

test("song request StreamElements widget does not own direct Twitch Helix redemption patches", () => {
  const source = fs.readFileSync(templatePath, "utf8");
  assert.equal(source.includes("TWITCH_REFUND_USER_ACCESS_TOKEN"), false);
  assert.equal(source.includes("api.twitch.tv/helix/channel_points/custom_rewards/redemptions"), false);
  assert.equal(source.includes("patchTwitchStatus"), false);
});
