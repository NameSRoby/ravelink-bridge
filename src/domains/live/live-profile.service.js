// [TITLE] Module: domains/live/live-profile.service.js
// [TITLE] Purpose: live tab profile persistence runtime (profiles-only mode)
// [TITLE] Functionality Index:
// [TITLE] - save profile payload snapshots by name
// [TITLE] - load/delete profiles deterministically
// [TITLE] - sanitize stored profile structures

const fs = require("fs");
const path = require("path");
const {
  readJsonFile,
  writeJsonFile,
  cloneJsonSafe
} = require("../../shared/fs/json-file-store");

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9 _-]{0,63}$/i;

function normalizeProfileName(value) {
  return String(value || "").trim();
}

function sanitizeProfilesMap(input = {}) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const out = {};
  for (const [rawName, rawEntry] of Object.entries(raw)) {
    const name = normalizeProfileName(rawName);
    if (!name || !PROFILE_NAME_RE.test(name)) continue;
    const entry = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry) ? rawEntry : {};
    const payload = cloneJsonSafe(entry.payload, {});
    out[name] = {
      name,
      createdAt: Number(entry.createdAt || Date.now()),
      updatedAt: Number(entry.updatedAt || Date.now()),
      payload
    };
  }
  return out;
}

module.exports = function createLiveProfileService(options = {}) {
  const storePath = String(options.storePath || "").trim();
  if (!storePath) {
    throw new Error("createLiveProfileService requires storePath");
  }

  let profilesByName = {};

  function load() {
    const hasFile = fs.existsSync(storePath);
    const parsed = hasFile ? readJsonFile(storePath, {}) : {};
    profilesByName = sanitizeProfilesMap(parsed);
    writeJsonFile(storePath, profilesByName);
  }

  function persist() {
    writeJsonFile(storePath, profilesByName);
  }

  function listProfiles() {
    return Object.values(profilesByName)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map(profile => ({
        name: profile.name,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt
      }));
  }

  function saveProfile(nameRaw, payload = {}) {
    // [DEV] Validation is strict to keep profile identifiers clean for
    // [DEV] future cross-file references and UI dropdown safety.
    const name = normalizeProfileName(nameRaw);
    if (!name || !PROFILE_NAME_RE.test(name)) {
      return {
        ok: false,
        error: "invalid_profile_name",
        detail: "Profile name must be 1-64 chars and contain letters/numbers/spaces/_/-."
      };
    }

    const now = Date.now();
    const existing = profilesByName[name];
    const entry = {
      name,
      createdAt: existing ? Number(existing.createdAt || now) : now,
      updatedAt: now,
      payload: cloneJsonSafe(payload, {})
    };
    profilesByName[name] = entry;
    persist();
    return {
      ok: true,
      profile: {
        name: entry.name,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt
      }
    };
  }

  function loadProfile(nameRaw) {
    const name = normalizeProfileName(nameRaw);
    if (!name) {
      return {
        ok: false,
        error: "missing_profile_name"
      };
    }
    const entry = profilesByName[name];
    if (!entry) {
      return {
        ok: false,
        error: "profile_not_found",
        name
      };
    }
    return {
      ok: true,
      profile: cloneJsonSafe(entry, null)
    };
  }

  function deleteProfile(nameRaw) {
    const name = normalizeProfileName(nameRaw);
    if (!name) {
      return {
        ok: false,
        error: "missing_profile_name"
      };
    }
    if (!profilesByName[name]) {
      return {
        ok: false,
        error: "profile_not_found",
        name
      };
    }
    delete profilesByName[name];
    persist();
    return {
      ok: true,
      deleted: name
    };
  }

  load();

  return {
    listProfiles,
    saveProfile,
    loadProfile,
    deleteProfile
  };
};
