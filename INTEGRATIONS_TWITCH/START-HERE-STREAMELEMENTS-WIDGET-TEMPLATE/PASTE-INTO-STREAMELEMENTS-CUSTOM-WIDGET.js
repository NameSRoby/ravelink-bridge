// [TITLE] Module: INTEGRATIONS_TWITCH/START-HERE-STREAMELEMENTS-WIDGET-TEMPLATE/PASTE-INTO-STREAMELEMENTS-CUSTOM-WIDGET.js
// [TITLE] Purpose: StreamElements custom widget reward listener

// ======================================================
// HUE BRIDGE + RAVE - TWITCH REWARD INTEGRATION
// SAFE | IDLE-GUARDED | NO-CORS (POST + QUERY)
// ======================================================
//
// Replace IDs with your own reward IDs before use.
// Keep BASE_URL as localhost when OBS/widget and bridge run on the same PC.
//

// ===== REWARD IDS =====
const COLOR_REWARD_ID = "replace_color_reward_id";
const TEACH_REWARD_ID = "replace_teach_reward_id";
const RAVE_REWARD_ID = "replace_rave_reward_id";
// Optional text gate for RAVE reward.
// - ""  => any redemption of RAVE_REWARD_ID activates
// - "on" => any non-empty user text activates
// - any other value => must match exactly (case-insensitive)
const RAVE_ACTIVATE_TEXT = "on";
// TEACH reward text format must be: <name> <#RRGGBB>
// Example reward text: toxic_green #39ff14

// ===== SERVER =====
const BASE_URL = "http://127.0.0.1:5050";
const RAVE_AUTO_OFF_MS = 5 * 60 * 1000;
const RAVE_TRIGGER_COOLDOWN_MS = 3000;

// ===== LOCAL GUARDS =====
let raveActive = false;
let lastRaveTrigger = 0;
const REWARD_IDS = Object.freeze({
  color: normalizeToken(COLOR_REWARD_ID),
  teach: normalizeToken(TEACH_REWARD_ID),
  rave: normalizeToken(RAVE_REWARD_ID)
});

const REWARD_DISPATCH = Object.freeze({
  [REWARD_IDS.rave]: handleRaveReward,
  [REWARD_IDS.teach]: handleTeachReward,
  [REWARD_IDS.color]: handleColorReward
});

function normalizeToken(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function pickFirstNonEmpty(...candidates) {
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (text) return text;
  }
  return "";
}

function getRewardId(data) {
  return normalizeToken(
    pickFirstNonEmpty(
      data?.tags?.["custom-reward-id"],
      data?.rewardId,
      data?.rewardID,
      data?.reward_id,
      data?.reward?.id,
      data?.redemption?.reward?.id,
      data?.redemption?.rewardId,
      data?.redemption?.reward_id
    )
  );
}

function getRewardText(data) {
  return normalizeText(
    pickFirstNonEmpty(
      data?.text,
      data?.message,
      data?.input,
      data?.userInput,
      data?.user_input,
      data?.redemption?.user_input,
      data?.redemption?.userInput,
      data?.redemption?.input
    )
  );
}

function getRewardEventData(payload) {
  const detail = payload && typeof payload === "object" ? payload.detail : null;
  if (!detail || typeof detail !== "object") return null;

  const candidates = [
    detail?.event?.data,
    detail?.eventData,
    detail?.data,
    detail?.event
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate;
    }
  }
  return null;
}

function shouldActivateRave(rawText) {
  const gate = normalizeText(RAVE_ACTIVATE_TEXT);
  if (!gate) return true;
  if (gate === "on") return rawText.length > 0;
  return rawText === gate;
}

function postCommand(path, value1 = "", params = {}) {
  const query = new URLSearchParams();
  const textValue = String(value1 || "").trim();
  if (textValue) query.set("value1", textValue);
  for (const [key, value] of Object.entries(params || {})) {
    const token = String(value || "").trim();
    if (!token) continue;
    query.set(String(key || "").trim(), token);
  }
  const encoded = query.toString();
  const suffix = encoded ? `?${encoded}` : "";
  return fetch(`${BASE_URL}${path}${suffix}`, { method: "POST", mode: "no-cors" }).catch(() => {});
}

function parseColorCommandShortcut(rawText) {
  const source = normalizeText(rawText);
  const match = source.match(/^(hue|wiz|both)(?:[:=\-]\s*|\s+)(.+)$/);
  if (!match) {
    return { target: "", text: source };
  }
  const target = normalizeToken(match[1]);
  const text = normalizeText(match[2]);
  return { target, text };
}

function handleRaveReward(rawText, now) {
  if (raveActive) return;
  if (now - lastRaveTrigger < RAVE_TRIGGER_COOLDOWN_MS) return;
  if (!shouldActivateRave(rawText)) return;

  lastRaveTrigger = now;
  raveActive = true;
  postCommand("/rave/on");

  setTimeout(() => {
    if (!raveActive) return;
    raveActive = false;
    postCommand("/rave/off");
  }, RAVE_AUTO_OFF_MS);
}

function handleTeachReward(rawText) {
  postCommand("/teach", rawText);
}

function handleColorReward(rawText) {
  const shortcut = parseColorCommandShortcut(rawText);
  if (shortcut.target && shortcut.text) {
    postCommand("/color", shortcut.text, { target: shortcut.target });
    return;
  }
  postCommand("/color", rawText);
}

window.addEventListener("onEventReceived", obj => {
  const data = getRewardEventData(obj);
  if (!data) return;

  const rewardID = getRewardId(data);
  if (!rewardID) return;

  const handler = REWARD_DISPATCH[rewardID];
  if (!handler) return;

  handler(getRewardText(data), Date.now());
});
