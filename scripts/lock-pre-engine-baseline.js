#!/usr/bin/env node
/* [TITLE] Script: scripts/lock-pre-engine-baseline.js
 * [TITLE] Purpose: lock and record a pre-engine baseline snapshot
 * [TITLE] Functionality Index:
 * [TITLE] - run release readiness gates
 * [TITLE] - capture git/runtime metadata into dist/release-baselines artifact
 * [TITLE] - optionally create annotated git tag when repository metadata exists
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = process.cwd();
const RELEASE_DIR = path.resolve(ROOT, "dist/release-baselines");
const BASELINE_JSON = path.resolve(RELEASE_DIR, "pre-engine-baseline.json");
const BASELINE_MD = path.resolve(RELEASE_DIR, "pre-engine-baseline.md");
const BASELINE_TAG = "v1.6.2-pre-engine";

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit"
  });
  return {
    status: Number(result.status || 0),
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

function getGitMetadata() {
  const inside = run("git", ["rev-parse", "--is-inside-work-tree"], { capture: true });
  const isGit = inside.status === 0 && inside.stdout.trim() === "true";
  if (!isGit) {
    return {
      available: false,
      branch: "unavailable",
      commit: "unavailable",
      dirty: null
    };
  }
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { capture: true }).stdout.trim() || "unknown";
  const commit = run("git", ["rev-parse", "HEAD"], { capture: true }).stdout.trim() || "unknown";
  const dirtyCheck = run("git", ["status", "--porcelain"], { capture: true });
  return {
    available: true,
    branch,
    commit,
    dirty: dirtyCheck.stdout.trim().length > 0
  };
}

function writeBaselineArtifacts(snapshot) {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  fs.writeFileSync(BASELINE_JSON, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const lines = [
    "# Pre-Engine Baseline Snapshot",
    "",
    `- GeneratedAtUTC: ${snapshot.generatedAtUtc}`,
    `- NodeVersion: ${snapshot.nodeVersion}`,
    `- TagTarget: ${snapshot.tagTarget}`,
    `- GitAvailable: ${snapshot.git.available}`,
    `- Branch: ${snapshot.git.branch}`,
    `- Commit: ${snapshot.git.commit}`,
    `- DirtyWorktree: ${snapshot.git.dirty}`,
    "",
    "## Gates",
    "",
    ...snapshot.gates.map(gate => `- ${gate.name}: ${gate.status === 0 ? "pass" : `fail (${gate.status})`}`),
    ""
  ];
  fs.writeFileSync(BASELINE_MD, lines.join("\n"), "utf8");
}

function maybeCreateTag(snapshot, args) {
  if (!args.includes("--create-tag")) return;
  if (!snapshot.git.available) {
    console.warn("[BASELINE] --create-tag requested but git metadata is unavailable; skipping tag creation.");
    return;
  }
  const existing = run("git", ["tag", "--list", BASELINE_TAG], { capture: true }).stdout.trim();
  if (existing === BASELINE_TAG) {
    console.log(`[BASELINE] tag already exists: ${BASELINE_TAG}`);
    return;
  }
  const tagMessage = `Pre-engine baseline locked at ${snapshot.generatedAtUtc}`;
  const create = run("git", ["tag", "-a", BASELINE_TAG, "-m", tagMessage]);
  if (create.status !== 0) {
    throw new Error(`failed to create tag ${BASELINE_TAG}`);
  }
  console.log(`[BASELINE] created annotated tag: ${BASELINE_TAG}`);
}

function main() {
  const args = process.argv.slice(2);
  const skipGates = args.includes("--skip-gates");
  const gates = [];

  if (!skipGates) {
    const readiness = run(process.execPath, [path.resolve(__dirname, "./verify-release-readiness.js")]);
    gates.push({ name: "verify-release-readiness", status: readiness.status });
    if (readiness.status !== 0) {
      throw new Error("release readiness gate failed; baseline not locked");
    }
  } else {
    gates.push({ name: "verify-release-readiness", status: 0, skipped: true });
  }

  const snapshot = {
    generatedAtUtc: new Date().toISOString(),
    nodeVersion: process.version,
    tagTarget: BASELINE_TAG,
    git: getGitMetadata(),
    gates
  };

  writeBaselineArtifacts(snapshot);
  maybeCreateTag(snapshot, args);

  console.log(`[BASELINE] snapshot written: ${path.relative(ROOT, BASELINE_JSON)}`);
  console.log(`[BASELINE] summary written: ${path.relative(ROOT, BASELINE_MD)}`);
}

try {
  main();
} catch (error) {
  console.error(`[BASELINE] ${error.message}`);
  process.exit(1);
}
