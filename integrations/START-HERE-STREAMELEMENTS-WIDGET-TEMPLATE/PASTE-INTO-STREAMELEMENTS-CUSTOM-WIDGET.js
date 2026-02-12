// ======================================================
// RaveLink Bridge + Twitch Rewards (StreamElements Widget)
// Template (sanitized)
// ======================================================
//
// 1) Replace reward IDs below with your own.
// 2) Keep BASE_URL on localhost unless you know why you need remote access.
// 3) Paste this into a StreamElements Custom Widget JS panel.
//

const COLOR_REWARD_ID = "replace_color_reward_id";
const TEACH_REWARD_ID = "replace_teach_reward_id";
const RAVE_REWARD_ID = "replace_rave_reward_id";

const BASE_URL = "http://127.0.0.1:5050";
const RAVE_DURATION_MS = 5 * 60 * 1000;

let raveActive = false;
let lastRaveTrigger = 0;

function fire(path) {
  fetch(`${BASE_URL}${path}`, { mode: "no-cors" }).catch(() => {});
}

window.addEventListener("onEventReceived", eventObj => {
  const data = eventObj?.detail?.event?.data;
  if (!data) return;

  const rewardID = data.tags?.["custom-reward-id"];
  const rawText = String(data.text || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  const now = Date.now();

  if (rewardID === RAVE_REWARD_ID) {
    if (raveActive) return;
    if ((now - lastRaveTrigger) < 3000) return;

    lastRaveTrigger = now;
    raveActive = true;
    fire("/rave/on");

    setTimeout(() => {
      if (!raveActive) return;
      raveActive = false;
      fire("/rave/off");
    }, RAVE_DURATION_MS);
    return;
  }

  if (rewardID === TEACH_REWARD_ID) {
    fire(`/teach?value1=${encodeURIComponent(rawText)}`);
    return;
  }

  if (rewardID === COLOR_REWARD_ID) {
    fire(`/color?value1=${encodeURIComponent(rawText)}`);
  }
});
