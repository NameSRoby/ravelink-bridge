// [TITLE] Module: app/runtime/lifecycle-error-classifier.js
// [TITLE] Purpose: classify process-level errors into recoverable vs fatal buckets
// [TITLE] Functionality Index:
// [TITLE] - detect known recoverable Hue Entertainment DTLS handshake failures
// [TITLE] - keep classification deterministic from error message + stack signatures
// [DEV] Complex Flow:
// [DEV] Process-level handlers should remain conservative. This classifier only marks
// [DEV] explicitly known, isolated transport faults as recoverable.

function normalizeErrorBlob(error) {
  const message = String(error?.message || error || "").trim();
  const stack = String(error?.stack || "").trim();
  const blob = `${message}\n${stack}`.toLowerCase();
  return {
    message,
    stack,
    blob
  };
}

function includesAny(text = "", tokens = []) {
  const source = String(text || "");
  for (const token of tokens) {
    if (!token) continue;
    if (source.includes(String(token))) return true;
  }
  return false;
}

function isRecoverableHueDtlsHandshakeError(error) {
  const { blob } = normalizeErrorBlob(error);
  if (!blob) return false;
  const hasHandshakeTimeout = includesAny(blob, [
    "dtls handshake timed out",
    "hue_entertainment_start_timeout",
    "dtls_socket_error"
  ]);
  if (!hasHandshakeTimeout) return false;
  return includesAny(blob, [
    "node-dtls-client",
    "hue-sync",
    "hue entertainment"
  ]);
}

function isRecoverableLifecycleError(error) {
  return isRecoverableHueDtlsHandshakeError(error);
}

module.exports = {
  isRecoverableLifecycleError,
  isRecoverableHueDtlsHandshakeError
};

