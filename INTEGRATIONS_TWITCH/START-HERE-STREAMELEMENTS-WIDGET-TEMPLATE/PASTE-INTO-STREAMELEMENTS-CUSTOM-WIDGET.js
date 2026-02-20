// [TITLE] Module: INTEGRATIONS_TWITCH/START-HERE-STREAMELEMENTS-WIDGET-TEMPLATE/PASTE-INTO-STREAMELEMENTS-CUSTOM-WIDGET.js
// [TITLE] Purpose: PASTE-INTO-STREAMELEMENTS-CUSTOM-WIDGET

// ======================================================
// HUE BRIDGE + RAVE - TWITCH REWARD INTEGRATION
// SAFE | IDLE-GUARDED | NO-CORS
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

// ===== LOCAL GUARDS =====
let raveActive = false;
let lastRaveTrigger = 0;

function shouldActivateRave(rawText) {
  const gate = String(RAVE_ACTIVATE_TEXT || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  if (!gate) return true;
  if (gate === "on") return rawText.length > 0;
  return rawText === gate;
}

window.addEventListener("onEventReceived", obj => {
  if (!obj?.detail?.event?.data) return;

  const data = obj.detail.event.data;
  const rewardID = data.tags?.["custom-reward-id"];

  const rawText = (data.text || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

  const now = Date.now();

  // =========================
  // RAVE ACTIVATE
  // =========================
  if (rewardID === RAVE_REWARD_ID) {
    if (raveActive) return;
    if (now - lastRaveTrigger < 3000) return;
    if (!shouldActivateRave(rawText)) return;

    lastRaveTrigger = now;
    raveActive = true;

    fetch(`${BASE_URL}/rave/on`, { method: "POST", mode: "no-cors" }).catch(() => {});

    // auto shutoff (5 min)
    setTimeout(() => {
      if (!raveActive) return;
      raveActive = false;
      fetch(`${BASE_URL}/rave/off`, { method: "POST", mode: "no-cors" }).catch(() => {});
    }, 5 * 60 * 1000);

    return;
  }

  // =========================
  // TEACH
  // =========================
  if (rewardID === TEACH_REWARD_ID) {
    // Sends raw reward text to /teach (expects "<name> <#RRGGBB>").
    fetch(
      `${BASE_URL}/teach`,
      {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value1: rawText })
      }
    ).catch(() => {});
    return;
  }

  // =========================
  // COLOR
  // =========================
  if (rewardID !== COLOR_REWARD_ID) return;

  fetch(
    `${BASE_URL}/color`,
    {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value1: rawText })
    }
  ).catch(() => {});
});
