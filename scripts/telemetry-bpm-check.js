#!/usr/bin/env node
"use strict";

const http = require("http");

function toNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = clamp((sorted.length - 1) * p, 0, sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const t = idx - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { raw += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw || "{}"));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(4000, () => {
      req.destroy(new Error("request timeout"));
    });
  });
}

async function main() {
  const song = String(process.argv[2] || "song").trim();
  const expected = toNum(process.argv[3], 0);
  const tolerance = Math.max(1, toNum(process.argv[4], 8));
  const durationSec = Math.max(5, toNum(process.argv[5], 45));
  const base = String(process.argv[6] || "http://127.0.0.1:3000").trim().replace(/\/+$/, "");
  const pollMs = 250;
  const endAt = Date.now() + (durationSec * 1000);

  const samples = [];
  const confidence = [];
  const scenes = new Map();
  const behaviors = new Map();

  while (Date.now() < endAt) {
    try {
      const t = await getJson(`${base}/rave/telemetry`);
      const bpm = toNum(t.bpm, 0);
      const beatConf = clamp(toNum(t.beatConfidence, 0), 0, 1);
      const scene = String(t.scene || "unknown");
      const behavior = String(t.behavior || "unknown");
      if (bpm > 0) samples.push(bpm);
      confidence.push(beatConf);
      scenes.set(scene, (scenes.get(scene) || 0) + 1);
      behaviors.set(behavior, (behaviors.get(behavior) || 0) + 1);
    } catch {}
    await new Promise(r => setTimeout(r, pollMs));
  }

  if (!samples.length) {
    console.log(JSON.stringify({
      ok: false,
      song,
      error: "no bpm samples collected",
      hint: "Start rave and play audio, then rerun."
    }, null, 2));
    process.exit(1);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const p10 = percentile(sorted, 0.1);
  const p90 = percentile(sorted, 0.9);
  const avgConf = confidence.reduce((a, b) => a + b, 0) / Math.max(1, confidence.length);
  const expectedLow = expected > 0 ? expected - tolerance : 0;
  const expectedHigh = expected > 0 ? expected + tolerance : 0;
  const inRange = expected > 0
    ? (median >= expectedLow && median <= expectedHigh)
    : null;

  const top = map => [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }));

  console.log(JSON.stringify({
    ok: true,
    song,
    sampleCount: samples.length,
    bpm: {
      median: Number(median.toFixed(2)),
      p10: Number(p10.toFixed(2)),
      p90: Number(p90.toFixed(2))
    },
    beatConfidenceAvg: Number(avgConf.toFixed(3)),
    expected: expected > 0
      ? {
          bpm: expected,
          tolerance,
          range: [Number(expectedLow.toFixed(2)), Number(expectedHigh.toFixed(2))],
          pass: inRange
        }
      : null,
    topScenes: top(scenes),
    topBehaviors: top(behaviors)
  }, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({
    ok: false,
    error: err?.message || String(err)
  }, null, 2));
  process.exit(1);
});

