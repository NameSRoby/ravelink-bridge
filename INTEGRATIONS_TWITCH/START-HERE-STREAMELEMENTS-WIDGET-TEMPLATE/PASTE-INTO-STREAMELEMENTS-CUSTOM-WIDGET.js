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

// ===== SERVER =====
const BASE_URL = "http://127.0.0.1:5050";

// ===== LOCAL GUARDS =====
let raveActive = false;
let lastRaveTrigger = 0;

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

    lastRaveTrigger = now;
    raveActive = true;

    fetch(`${BASE_URL}/rave/on`, { mode: "no-cors" }).catch(() => {});

    // auto shutoff (5 min)
    setTimeout(() => {
      if (!raveActive) return;
      raveActive = false;
      fetch(`${BASE_URL}/rave/off`, { mode: "no-cors" }).catch(() => {});
    }, 5 * 60 * 1000);

    return;
  }

  // =========================
  // TEACH
  // =========================
  if (rewardID === TEACH_REWARD_ID) {
    fetch(
      `${BASE_URL}/teach?value1=${encodeURIComponent(rawText)}`,
      { mode: "no-cors" }
    ).catch(() => {});
    return;
  }

  // =========================
  // COLOR
  // =========================
  if (rewardID !== COLOR_REWARD_ID) return;

  fetch(
    `${BASE_URL}/color?value1=${encodeURIComponent(rawText)}`,
    { mode: "no-cors" }
  ).catch(() => {});
});
