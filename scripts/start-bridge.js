// [TITLE] Module: scripts/start-bridge.js
// [TITLE] Purpose: start-bridge

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

function resolveHueCaPath() {
  const candidates = [];
  if (process.env.RAVE_HUE_CA_CERT_PATH) {
    candidates.push(String(process.env.RAVE_HUE_CA_CERT_PATH));
  }

  try {
    const pkgPath = require.resolve("hue-sync/package.json", { paths: [rootDir] });
    candidates.push(path.join(path.dirname(pkgPath), "signify.pem"));
  } catch {}

  candidates.push(path.join(rootDir, "node_modules", "hue-sync", "signify.pem"));
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || "";
}

const certPath = resolveHueCaPath();

if (!process.env.NODE_EXTRA_CA_CERTS) {
  if (certPath) {
    process.env.NODE_EXTRA_CA_CERTS = certPath;
  } else {
    console.warn("[BOOT] hue-sync cert not found; continuing without NODE_EXTRA_CA_CERTS");
  }
}

require(path.join(rootDir, "server.js"));
