"use strict";

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isNonArrayObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getRequestMap(value) {
  return value && typeof value === "object" ? value : {};
}

function createRequestValueReader(req) {
  const body = getRequestMap(req.body);
  const query = getRequestMap(req.query);
  return key => {
    if (hasOwn(body, key)) return body[key];
    if (hasOwn(query, key)) return query[key];
    return undefined;
  };
}

function patchOptionalNumber(read, patch, key, patchKey = key) {
  const raw = read(key);
  if (raw === undefined) return;
  patch[patchKey] = Number(raw);
}

function patchOptionalLowerString(read, patch, key, patchKey = key) {
  const raw = read(key);
  if (raw === undefined) return;
  patch[patchKey] = String(raw || "").trim().toLowerCase();
}

function mergePatchObject(patch, key, next) {
  patch[key] = {
    ...(patch[key] || {}),
    ...next
  };
}

function parseLowerTokenList(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map(item => String(item || "").trim().toLowerCase())
      .filter(Boolean);
  }
  const asText = String(raw || "").trim();
  if (!asText) return [];
  return asText
    .split(",")
    .map(item => String(item || "").trim().toLowerCase())
    .filter(Boolean);
}

function createRequestPatchUtils(options = {}) {
  const parseBoolean = typeof options.parseBoolean === "function"
    ? options.parseBoolean
    : (() => null);

  function patchOptionalBoolean(read, patch, key, patchKey = key) {
    const raw = read(key);
    if (raw === undefined) return;
    const parsed = parseBoolean(raw, null);
    if (parsed !== null) patch[patchKey] = parsed;
  }

  return {
    hasOwn,
    isNonArrayObject,
    getRequestMap,
    createRequestValueReader,
    patchOptionalBoolean,
    patchOptionalNumber,
    patchOptionalLowerString,
    mergePatchObject,
    parseLowerTokenList
  };
}

module.exports = {
  hasOwn,
  isNonArrayObject,
  getRequestMap,
  createRequestValueReader,
  patchOptionalNumber,
  patchOptionalLowerString,
  mergePatchObject,
  parseLowerTokenList,
  createRequestPatchUtils
};
