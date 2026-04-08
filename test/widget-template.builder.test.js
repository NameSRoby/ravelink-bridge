// [TITLE] Test Module: test/widget-template.builder.test.js
// [TITLE] Purpose: generated widget template runtime behavior + config shape regression guards

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const {
  normalizeWidgetPayload,
  generateWidgetTemplateScript
} = require("../src/domains/system/widget-template.builder");

function createFetchResponse({ ok = true, status = 200, body = { ok: true } } = {}) {
  const textBody = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok,
    status,
    text: async () => textBody
  };
}

test("generated widget script preserves config shape for editor typing", () => {
  const script = generateWidgetTemplateScript(normalizeWidgetPayload({ twitchStatusSyncEnabled: true }));
  assert.equal(script.includes("Object.freeze(RAVELINK_WIDGET_CONFIG);"), true);
  assert.equal(script.includes("RAVELINK_WIDGET_CONFIG || {}"), false);
});

test("generated widget runtime handles redemption and syncs fulfilled Twitch status", async () => {
  const config = normalizeWidgetPayload({
    colorRewardId: "reward-color",
    baseUrl: "http://127.0.0.1:5050",
    twitchStatusSyncEnabled: true,
    twitchClientId: "client-id",
    twitchUserAccessToken: "user-token",
    twitchBroadcasterId: "1234567"
  });
  const script = generateWidgetTemplateScript(config);

  const listeners = new Map();
  const fetchCalls = [];
  const context = {
    URL,
    URLSearchParams,
    Date,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: {
      log: () => {},
      warn: () => {}
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({
        url: String(url),
        options
      });
      return createFetchResponse({ ok: true, status: 200, body: { ok: true } });
    },
    window: {
      location: {
        origin: "https://streamelements.com"
      },
      addEventListener: (eventName, handler) => {
        listeners.set(String(eventName), handler);
      }
    }
  };

  vm.runInNewContext(script, context, { timeout: 2000 });
  const runtime = context.window.RaveLinkWidgetRuntime;
  assert.equal(typeof runtime, "object");
  assert.equal(runtime.config.twitchStatusSyncEnabled, true);

  const onEventReceived = listeners.get("onEventReceived");
  assert.equal(typeof onEventReceived, "function");

  onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        reward: {
          id: "reward-color"
        },
        redemption: {
          id: "redemption-1",
          reward: {
            id: "reward-color"
          },
          user_input: "teal",
          user_name: "viewer"
        }
      }
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fetchCalls.length, 2);

  const bridgeCall = fetchCalls[0];
  assert.equal(bridgeCall.url, "http://127.0.0.1:5050/color");
  assert.equal(String(bridgeCall.options.method || "").toUpperCase(), "POST");
  assert.deepEqual(JSON.parse(String(bridgeCall.options.body || "{}")), {
    text: "teal"
  });

  const twitchCall = fetchCalls[1];
  assert.equal(String(twitchCall.options.method || "").toUpperCase(), "POST");
  assert.equal(twitchCall.url, "http://127.0.0.1:5050/system/widget-redemption-status");
  assert.deepEqual(JSON.parse(String(twitchCall.options.body || "{}")), {
    rewardId: "reward-color",
    redemptionId: "redemption-1",
    broadcasterId: "1234567",
    status: "FULFILLED",
    reason: "",
    twitchClientId: "client-id",
    twitchUserAccessToken: "user-token",
    twitchBroadcasterId: "1234567"
  });
});

test("generated widget runtime handles legacy StreamElements reward tags envelopes", async () => {
  const config = normalizeWidgetPayload({
    colorRewardId: "reward-color",
    baseUrl: "http://127.0.0.1:5050",
    twitchStatusSyncEnabled: true,
    twitchClientId: "client-id",
    twitchUserAccessToken: "user-token",
    twitchBroadcasterId: "1234567"
  });
  const script = generateWidgetTemplateScript(config);

  const listeners = new Map();
  const fetchCalls = [];
  const context = {
    URL,
    URLSearchParams,
    Date,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: {
      log: () => {},
      warn: () => {}
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({
        url: String(url),
        options
      });
      return createFetchResponse({ ok: true, status: 200, body: { ok: true } });
    },
    window: {
      location: {
        origin: "https://streamelements.com"
      },
      addEventListener: (eventName, handler) => {
        listeners.set(String(eventName), handler);
      }
    }
  };

  vm.runInNewContext(script, context, { timeout: 2000 });
  const onEventReceived = listeners.get("onEventReceived");
  assert.equal(typeof onEventReceived, "function");

  onEventReceived({
    detail: {
      listener: "event",
      event: {
        data: {
          tags: {
            "custom-reward-id": "reward-color"
          },
          redemption: {
            id: "redemption-tags-1",
            user_input: "cyan",
            user_name: "viewerLegacy"
          }
        }
      }
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fetchCalls.length, 2);
  const bridgeCall = fetchCalls[0];
  assert.equal(bridgeCall.url, "http://127.0.0.1:5050/color");
  assert.deepEqual(JSON.parse(String(bridgeCall.options.body || "{}")), {
    text: "cyan"
  });

  const twitchCall = fetchCalls[1];
  assert.equal(String(twitchCall.options.method || "").toUpperCase(), "POST");
  assert.equal(twitchCall.url, "http://127.0.0.1:5050/system/widget-redemption-status");
  assert.deepEqual(JSON.parse(String(twitchCall.options.body || "{}")), {
    rewardId: "reward-color",
    redemptionId: "redemption-tags-1",
    broadcasterId: "1234567",
    status: "FULFILLED",
    reason: "",
    twitchClientId: "client-id",
    twitchUserAccessToken: "user-token",
    twitchBroadcasterId: "1234567"
  });
});

test("generated widget runtime handles StreamElements item envelopes with user input", async () => {
  const config = normalizeWidgetPayload({
    colorRewardId: "reward-color",
    baseUrl: "http://127.0.0.1:5050",
    twitchStatusSyncEnabled: true,
    twitchClientId: "client-id",
    twitchUserAccessToken: "user-token",
    twitchBroadcasterId: "1234567"
  });
  const script = generateWidgetTemplateScript(config);

  const listeners = new Map();
  const fetchCalls = [];
  const context = {
    URL,
    URLSearchParams,
    Date,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: {
      log: () => {},
      warn: () => {}
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({
        url: String(url),
        options
      });
      return createFetchResponse({ ok: true, status: 200, body: { ok: true } });
    },
    window: {
      location: {
        origin: "https://streamelements.com"
      },
      addEventListener: (eventName, handler) => {
        listeners.set(String(eventName), handler);
      }
    }
  };

  vm.runInNewContext(script, context, { timeout: 2000 });
  const onEventReceived = listeners.get("onEventReceived");
  assert.equal(typeof onEventReceived, "function");

  onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        item: {
          id: "redemption-item-1",
          user_input: "magenta",
          reward: {
            id: "reward-color"
          }
        }
      }
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fetchCalls.length, 2);
  const bridgeCall = fetchCalls[0];
  assert.equal(bridgeCall.url, "http://127.0.0.1:5050/color");
  assert.deepEqual(JSON.parse(String(bridgeCall.options.body || "{}")), {
    text: "magenta"
  });

  const twitchCall = fetchCalls[1];
  assert.equal(String(twitchCall.options.method || "").toUpperCase(), "POST");
  assert.equal(twitchCall.url, "http://127.0.0.1:5050/system/widget-redemption-status");
  assert.deepEqual(JSON.parse(String(twitchCall.options.body || "{}")), {
    rewardId: "reward-color",
    redemptionId: "redemption-item-1",
    broadcasterId: "1234567",
    status: "FULFILLED",
    reason: "",
    twitchClientId: "client-id",
    twitchUserAccessToken: "user-token",
    twitchBroadcasterId: "1234567"
  });
});

test("generated widget runtime dedupes repeated reward events", async () => {
  const config = normalizeWidgetPayload({
    colorRewardId: "reward-color",
    baseUrl: "http://127.0.0.1:5050",
    twitchStatusSyncEnabled: true,
    twitchClientId: "client-id",
    twitchUserAccessToken: "user-token",
    twitchBroadcasterId: "1234567"
  });
  const script = generateWidgetTemplateScript(config);

  const listeners = new Map();
  const fetchCalls = [];
  const context = {
    URL,
    URLSearchParams,
    Date,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: {
      log: () => {},
      warn: () => {}
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({
        url: String(url),
        options
      });
      return createFetchResponse({ ok: true, status: 200, body: { ok: true } });
    },
    window: {
      location: {
        origin: "https://streamelements.com"
      },
      addEventListener: (eventName, handler) => {
        listeners.set(String(eventName), handler);
      }
    }
  };

  vm.runInNewContext(script, context, { timeout: 2000 });
  const onEventReceived = listeners.get("onEventReceived");
  assert.equal(typeof onEventReceived, "function");

  const eventEnvelope = {
    detail: {
      listener: "redemption-latest",
      event: {
        redemption: {
          id: "redemption-dedupe-1",
          reward: {
            id: "reward-color"
          },
          user_input: "teal",
          user_name: "viewerDeduped"
        }
      }
    }
  };
  onEventReceived(eventEnvelope);
  onEventReceived(eventEnvelope);

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fetchCalls.length, 2);
});

test("generated widget runtime marks teach refundRecommended responses as canceled", async () => {
  const config = normalizeWidgetPayload({
    teachRewardId: "reward-teach",
    baseUrl: "http://127.0.0.1:5050",
    twitchStatusSyncEnabled: true,
    twitchClientId: "client-id",
    twitchUserAccessToken: "user-token",
    twitchBroadcasterId: "1234567"
  });
  const script = generateWidgetTemplateScript(config);

  const listeners = new Map();
  const fetchCalls = [];
  const context = {
    URL,
    URLSearchParams,
    Date,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: {
      log: () => {},
      warn: () => {}
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({
        url: String(url),
        options
      });
      const requestUrl = String(url || "");
      if (requestUrl === "http://127.0.0.1:5050/teach") {
        return createFetchResponse({
          ok: true,
          status: 200,
          body: {
            ok: true,
            changed: false,
            refundRecommended: true
          }
        });
      }
      return createFetchResponse({ ok: true, status: 200, body: { ok: true } });
    },
    window: {
      location: {
        origin: "https://streamelements.com"
      },
      addEventListener: (eventName, handler) => {
        listeners.set(String(eventName), handler);
      }
    }
  };

  vm.runInNewContext(script, context, { timeout: 2000 });
  const onEventReceived = listeners.get("onEventReceived");
  assert.equal(typeof onEventReceived, "function");

  onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        redemption: {
          id: "redemption-teach-1",
          reward: {
            id: "reward-teach"
          },
          user_input: "ocean glow #12abef",
          user_name: "viewerTeach"
        }
      }
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fetchCalls.length, 2);
  const twitchCall = fetchCalls[1];
  assert.equal(String(twitchCall.options.method || "").toUpperCase(), "POST");
  assert.equal(twitchCall.url, "http://127.0.0.1:5050/system/widget-redemption-status");
  assert.deepEqual(JSON.parse(String(twitchCall.options.body || "{}")), {
    rewardId: "reward-teach",
    redemptionId: "redemption-teach-1",
    broadcasterId: "1234567",
    status: "CANCELED",
    reason: "refund_recommended",
    twitchClientId: "client-id",
    twitchUserAccessToken: "user-token",
    twitchBroadcasterId: "1234567"
  });
});

test("generated widget runtime announces teach success and shows how to use taught color", async () => {
  const config = normalizeWidgetPayload({
    teachRewardId: "reward-teach",
    baseUrl: "http://127.0.0.1:5050",
    twitchStatusSyncEnabled: true,
    twitchClientId: "client-id",
    twitchUserAccessToken: "user-token",
    twitchBroadcasterId: "1234567",
    streamElementsBotChatEnabled: true,
    streamElementsBotChannelId: "channel-teach",
    streamElementsBotJwt: "jwt-token",
    colorChangeRedemptionName: "change my lights"
  });
  const script = generateWidgetTemplateScript(config);

  const listeners = new Map();
  const fetchCalls = [];
  const context = {
    URL,
    URLSearchParams,
    Date,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: {
      log: () => {},
      warn: () => {}
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({
        url: String(url),
        options
      });
      const requestUrl = String(url || "");
      if (requestUrl === "http://127.0.0.1:5050/teach") {
        return createFetchResponse({
          ok: true,
          status: 200,
          body: {
            ok: true,
            changed: true,
            taughtName: "ocean glow",
            taughtHex: "#12abef"
          }
        });
      }
      return createFetchResponse({ ok: true, status: 200, body: { ok: true } });
    },
    window: {
      location: {
        origin: "https://streamelements.com"
      },
      addEventListener: (eventName, handler) => {
        listeners.set(String(eventName), handler);
      }
    }
  };

  vm.runInNewContext(script, context, { timeout: 2000 });
  const onEventReceived = listeners.get("onEventReceived");
  assert.equal(typeof onEventReceived, "function");

  onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        redemption: {
          id: "redemption-teach-success-1",
          reward: {
            id: "reward-teach"
          },
          user_input: "ocean glow #12abef",
          user_name: "viewerTeach"
        }
      }
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fetchCalls.length, 3);
  assert.equal(fetchCalls[0].url, "http://127.0.0.1:5050/teach");
  assert.equal(fetchCalls[1].url, "http://127.0.0.1:5050/system/widget-redemption-status");
  const chatCall = fetchCalls[2];
  assert.equal(chatCall.url, "https://api.streamelements.com/kappa/v2/bot/channel-teach/say");
  const chatPayload = JSON.parse(String(chatCall.options.body || "{}"));
  assert.equal(String(chatPayload.message || "").includes("Color taught"), true);
  assert.equal(String(chatPayload.message || "").includes("ocean glow"), true);
  assert.equal(String(chatPayload.message || "").includes("change my lights"), true);
});

test("generated widget runtime announces teach duplicate and suggests existing color usage", async () => {
  const config = normalizeWidgetPayload({
    teachRewardId: "reward-teach",
    baseUrl: "http://127.0.0.1:5050",
    twitchStatusSyncEnabled: true,
    twitchClientId: "client-id",
    twitchUserAccessToken: "user-token",
    twitchBroadcasterId: "1234567",
    streamElementsBotChatEnabled: true,
    streamElementsBotChannelId: "channel-teach-dup",
    streamElementsBotJwt: "jwt-token",
    colorChangeRedemptionName: "change my lights"
  });
  const script = generateWidgetTemplateScript(config);

  const listeners = new Map();
  const fetchCalls = [];
  const context = {
    URL,
    URLSearchParams,
    Date,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: {
      log: () => {},
      warn: () => {}
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({
        url: String(url),
        options
      });
      const requestUrl = String(url || "");
      if (requestUrl === "http://127.0.0.1:5050/teach") {
        return createFetchResponse({
          ok: true,
          status: 200,
          body: {
            ok: true,
            changed: false,
            refundRecommended: true,
            reason: "already_exists",
            taughtName: "ocean glow",
            taughtHex: "#12abef"
          }
        });
      }
      return createFetchResponse({ ok: true, status: 200, body: { ok: true } });
    },
    window: {
      location: {
        origin: "https://streamelements.com"
      },
      addEventListener: (eventName, handler) => {
        listeners.set(String(eventName), handler);
      }
    }
  };

  vm.runInNewContext(script, context, { timeout: 2000 });
  const onEventReceived = listeners.get("onEventReceived");
  assert.equal(typeof onEventReceived, "function");

  onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        redemption: {
          id: "redemption-teach-dup-1",
          reward: {
            id: "reward-teach"
          },
          user_input: "ocean glow #12abef",
          user_name: "viewerTeachDup"
        }
      }
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fetchCalls.length, 3);
  assert.equal(fetchCalls[0].url, "http://127.0.0.1:5050/teach");
  assert.equal(fetchCalls[1].url, "http://127.0.0.1:5050/system/widget-redemption-status");
  const chatCall = fetchCalls[2];
  assert.equal(chatCall.url, "https://api.streamelements.com/kappa/v2/bot/channel-teach-dup/say");
  const chatPayload = JSON.parse(String(chatCall.options.body || "{}"));
  assert.equal(String(chatPayload.message || "").includes("already exists"), true);
  assert.equal(String(chatPayload.message || "").includes("change my lights"), true);
  assert.equal(String(chatPayload.message || "").toLowerCase().includes("refunded"), true);
});

test("generated widget runtime announces color failure in chat and keeps refund path", async () => {
  const config = normalizeWidgetPayload({
    colorRewardId: "reward-color",
    baseUrl: "http://127.0.0.1:5050",
    twitchStatusSyncEnabled: true,
    twitchClientId: "client-id",
    twitchUserAccessToken: "user-token",
    twitchBroadcasterId: "1234567",
    streamElementsBotChatEnabled: true,
    streamElementsBotChannelId: "channel-1",
    streamElementsBotJwt: "jwt-token"
  });
  const script = generateWidgetTemplateScript(config);

  const listeners = new Map();
  const fetchCalls = [];
  const context = {
    URL,
    URLSearchParams,
    Date,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: {
      log: () => {},
      warn: () => {}
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({
        url: String(url),
        options
      });
      const requestUrl = String(url || "");
      if (requestUrl === "http://127.0.0.1:5050/color") {
        return createFetchResponse({
          ok: false,
          status: 409,
          body: {
            ok: false,
            error: "light commands are blocked while RAVE is active"
          }
        });
      }
      if (requestUrl === "http://127.0.0.1:5050/system/widget-redemption-status") {
        return createFetchResponse({ ok: true, status: 200, body: { ok: true } });
      }
      return createFetchResponse({ ok: true, status: 200, body: { ok: true } });
    },
    window: {
      location: {
        origin: "https://streamelements.com"
      },
      addEventListener: (eventName, handler) => {
        listeners.set(String(eventName), handler);
      }
    }
  };

  vm.runInNewContext(script, context, { timeout: 2000 });
  const onEventReceived = listeners.get("onEventReceived");
  assert.equal(typeof onEventReceived, "function");

  onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        redemption: {
          id: "redemption-color-fail-1",
          reward: {
            id: "reward-color"
          },
          user_input: "blue",
          user_name: "viewerFail"
        }
      }
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fetchCalls.length, 3);
  const chatCall = fetchCalls[2];
  assert.equal(chatCall.url, "https://api.streamelements.com/kappa/v2/bot/channel-1/say");
  assert.equal(String(chatCall.options.method || "").toUpperCase(), "POST");
  assert.equal(String(chatCall.options.headers?.Authorization || ""), "Bearer jwt-token");
  const chatPayload = JSON.parse(String(chatCall.options.body || "{}"));
  assert.equal(String(chatPayload.message || "").includes("@viewerFail"), true);
  assert.equal(String(chatPayload.message || "").toLowerCase().includes("color change failed"), true);
  assert.equal(String(chatPayload.message || "").toLowerCase().includes("refunded"), true);
});

test("generated widget runtime announces rave activation in chat with duration", async () => {
  const config = normalizeWidgetPayload({
    raveRewardId: "reward-rave",
    baseUrl: "http://127.0.0.1:5050",
    twitchStatusSyncEnabled: false,
    streamElementsBotChatEnabled: true,
    streamElementsBotChannelId: "channel-2",
    streamElementsBotJwt: "jwt-token"
  });
  const script = generateWidgetTemplateScript(config);

  const listeners = new Map();
  const fetchCalls = [];
  const context = {
    URL,
    URLSearchParams,
    Date,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: {
      log: () => {},
      warn: () => {}
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({
        url: String(url),
        options
      });
      return createFetchResponse({ ok: true, status: 200, body: { ok: true } });
    },
    window: {
      location: {
        origin: "https://streamelements.com"
      },
      addEventListener: (eventName, handler) => {
        listeners.set(String(eventName), handler);
      }
    }
  };

  vm.runInNewContext(script, context, { timeout: 2000 });
  const onEventReceived = listeners.get("onEventReceived");
  assert.equal(typeof onEventReceived, "function");

  onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        redemption: {
          id: "redemption-rave-chat-1",
          reward: {
            id: "reward-rave"
          },
          user_input: "on",
          user_name: "viewerRave"
        }
      }
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0].url, "http://127.0.0.1:5050/rave/on");
  const chatCall = fetchCalls[1];
  assert.equal(chatCall.url, "https://api.streamelements.com/kappa/v2/bot/channel-2/say");
  const chatPayload = JSON.parse(String(chatCall.options.body || "{}"));
  assert.equal(String(chatPayload.message || "").includes("RAVE is on"), true);
  assert.equal(String(chatPayload.message || "").includes("5 minutes"), true);
});

test("generated widget runtime turns rave on even when redemption includes arbitrary input", async () => {
  const config = normalizeWidgetPayload({
    raveRewardId: "reward-rave",
    baseUrl: "http://127.0.0.1:5050",
    twitchStatusSyncEnabled: false
  });
  const script = generateWidgetTemplateScript(config);

  const listeners = new Map();
  const fetchCalls = [];
  const context = {
    URL,
    URLSearchParams,
    Date,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: {
      log: () => {},
      warn: () => {}
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({
        url: String(url),
        options
      });
      return createFetchResponse({ ok: true, status: 200, body: { ok: true } });
    },
    window: {
      location: {
        origin: "https://streamelements.com"
      },
      addEventListener: (eventName, handler) => {
        listeners.set(String(eventName), handler);
      }
    }
  };

  vm.runInNewContext(script, context, { timeout: 2000 });
  const onEventReceived = listeners.get("onEventReceived");
  assert.equal(typeof onEventReceived, "function");

  onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        item: {
          id: "redemption-rave-1",
          user_input: "party mode now",
          reward: {
            id: "reward-rave"
          }
        }
      }
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fetchCalls.length, 1);
  const bridgeCall = fetchCalls[0];
  assert.equal(bridgeCall.url, "http://127.0.0.1:5050/rave/on");
  assert.equal(String(bridgeCall.options.method || "").toUpperCase(), "POST");
  assert.equal(fetchCalls.some(call => call.url.includes("/rave/off")), false);
});

test("generated widget runtime resets rave auto-off timer on repeated activation by default", async () => {
  const config = normalizeWidgetPayload({
    raveRewardId: "reward-rave",
    baseUrl: "http://127.0.0.1:5050",
    twitchStatusSyncEnabled: false
  });
  const script = generateWidgetTemplateScript(config);

  const listeners = new Map();
  const fetchCalls = [];
  const scheduledTimers = [];
  const clearedTimers = [];
  let nextTimerId = 0;
  let raveOnCallCount = 0;
  const context = {
    URL,
    URLSearchParams,
    Date,
    setTimeout: (_fn, ms) => {
      nextTimerId += 1;
      scheduledTimers.push({ id: nextTimerId, ms: Number(ms || 0) });
      return nextTimerId;
    },
    clearTimeout: timerId => {
      clearedTimers.push(Number(timerId || 0));
    },
    console: {
      log: () => {},
      warn: () => {}
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({
        url: String(url),
        options
      });
      const requestUrl = String(url || "");
      if (requestUrl === "http://127.0.0.1:5050/rave/on") {
        raveOnCallCount += 1;
        return createFetchResponse({
          ok: true,
          status: 200,
          body: {
            ok: true,
            alreadyActive: raveOnCallCount > 1
          }
        });
      }
      return createFetchResponse({ ok: true, status: 200, body: { ok: true } });
    },
    window: {
      location: {
        origin: "https://streamelements.com"
      },
      addEventListener: (eventName, handler) => {
        listeners.set(String(eventName), handler);
      }
    }
  };

  vm.runInNewContext(script, context, { timeout: 2000 });
  const onEventReceived = listeners.get("onEventReceived");
  assert.equal(typeof onEventReceived, "function");

  onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        redemption: {
          id: "redemption-rave-repeat-1",
          reward: {
            id: "reward-rave"
          },
          user_input: "first"
        }
      }
    }
  });
  onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        redemption: {
          id: "redemption-rave-repeat-2",
          reward: {
            id: "reward-rave"
          },
          user_input: "second"
        }
      }
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls.every(call => call.url === "http://127.0.0.1:5050/rave/on"), true);
  assert.equal(scheduledTimers.length, 2);
  assert.equal(clearedTimers.length, 1);
  assert.equal(clearedTimers[0], 1);
});

test("generated widget runtime can ignore repeated rave activations for auto-off timer", async () => {
  const config = normalizeWidgetPayload({
    raveRewardId: "reward-rave",
    baseUrl: "http://127.0.0.1:5050",
    raveAutoOffResetOnRepeat: false,
    twitchStatusSyncEnabled: false
  });
  const script = generateWidgetTemplateScript(config);

  const listeners = new Map();
  const fetchCalls = [];
  const scheduledTimers = [];
  const clearedTimers = [];
  let nextTimerId = 0;
  let raveOnCallCount = 0;
  const context = {
    URL,
    URLSearchParams,
    Date,
    setTimeout: (_fn, ms) => {
      nextTimerId += 1;
      scheduledTimers.push({ id: nextTimerId, ms: Number(ms || 0) });
      return nextTimerId;
    },
    clearTimeout: timerId => {
      clearedTimers.push(Number(timerId || 0));
    },
    console: {
      log: () => {},
      warn: () => {}
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({
        url: String(url),
        options
      });
      const requestUrl = String(url || "");
      if (requestUrl === "http://127.0.0.1:5050/rave/on") {
        raveOnCallCount += 1;
        return createFetchResponse({
          ok: true,
          status: 200,
          body: {
            ok: true,
            alreadyActive: raveOnCallCount > 1
          }
        });
      }
      return createFetchResponse({ ok: true, status: 200, body: { ok: true } });
    },
    window: {
      location: {
        origin: "https://streamelements.com"
      },
      addEventListener: (eventName, handler) => {
        listeners.set(String(eventName), handler);
      }
    }
  };

  vm.runInNewContext(script, context, { timeout: 2000 });
  const onEventReceived = listeners.get("onEventReceived");
  assert.equal(typeof onEventReceived, "function");

  onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        redemption: {
          id: "redemption-rave-ignore-1",
          reward: {
            id: "reward-rave"
          },
          user_input: "first"
        }
      }
    }
  });
  onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        redemption: {
          id: "redemption-rave-ignore-2",
          reward: {
            id: "reward-rave"
          },
          user_input: "second"
        }
      }
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls.every(call => call.url === "http://127.0.0.1:5050/rave/on"), true);
  assert.equal(scheduledTimers.length, 1);
  assert.equal(clearedTimers.length, 0);
});

test("generated widget runtime matches reward names with case and typo tolerance", async () => {
  const config = normalizeWidgetPayload({
    colorRewardId: "Change My Lights",
    baseUrl: "http://127.0.0.1:5050",
    twitchStatusSyncEnabled: false
  });
  const script = generateWidgetTemplateScript(config);

  const listeners = new Map();
  const fetchCalls = [];
  const context = {
    URL,
    URLSearchParams,
    Date,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: {
      log: () => {},
      warn: () => {}
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({
        url: String(url),
        options
      });
      return createFetchResponse({ ok: true, status: 200, body: { ok: true } });
    },
    window: {
      location: {
        origin: "https://streamelements.com"
      },
      addEventListener: (eventName, handler) => {
        listeners.set(String(eventName), handler);
      }
    }
  };

  vm.runInNewContext(script, context, { timeout: 2000 });
  const onEventReceived = listeners.get("onEventReceived");
  assert.equal(typeof onEventReceived, "function");

  onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        redemption: {
          id: "redemption-name-case-1",
          reward: {
            id: "reward-uuid-a",
            title: "change my lights"
          },
          user_input: "blue"
        }
      }
    }
  });

  onEventReceived({
    detail: {
      listener: "redemption-latest",
      event: {
        redemption: {
          id: "redemption-name-typo-2",
          reward: {
            id: "reward-uuid-b",
            title: "change my lghts"
          },
          user_input: "green"
        }
      }
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls.every(call => call.url === "http://127.0.0.1:5050/color"), true);
});
