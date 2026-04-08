const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");

const createServer = require("../../src/app/create-server");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createIsolatedRoot() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-preengine-"));
  const sourcePublicRoot = path.resolve(__dirname, "../../public");
  const targetPublicRoot = path.join(rootDir, "public");
  ensureDir(path.dirname(targetPublicRoot));
  fs.cpSync(sourcePublicRoot, targetPublicRoot, { recursive: true });
  return rootDir;
}

function toUrl(baseUrl, routePath = "/") {
  const normalized = String(routePath || "/").startsWith("/")
    ? String(routePath || "/")
    : `/${String(routePath || "")}`;
  return `${String(baseUrl || "").replace(/\/+$/, "")}${normalized}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function removeDirWithRetry(dirPath = "", options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 8));
  const delayMs = Math.max(10, Number(options.delayMs || 75));
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return {
        ok: true,
        attempts: attempt
      };
    } catch (error) {
      lastError = error;
      const code = String(error?.code || "").trim().toUpperCase();
      if (code !== "EPERM" && code !== "EBUSY") {
        break;
      }
      if (attempt < maxAttempts) {
        await sleep(delayMs * attempt);
      }
    }
  }
  return {
    ok: false,
    error: lastError
  };
}

async function shutdownTestServices(services = {}) {
  const source = services && typeof services === "object" ? services : {};
  try {
    source.systemOauthService?.stopAutoReconcile?.();
  } catch {
    // ignore
  }
  try {
    source.internetGatewayRuntime?.shutdown?.();
  } catch {
    // ignore
  }
  try {
    if (typeof source.modRuntime?.shutdown === "function") {
      await source.modRuntime.shutdown();
    }
  } catch {
    // ignore
  }
}

async function requestJson(baseUrl, method, routePath, body = null, headers = {}) {
  const requestHeaders = {
    "Content-Type": "application/json",
    "Connection": "close",
    ...headers
  };
  const response = await fetch(toUrl(baseUrl, routePath), {
    method,
    headers: requestHeaders,
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { __raw: text };
  }
  return {
    status: response.status,
    ok: response.ok,
    data
  };
}

async function bootHttpTestServer() {
  const rootDir = createIsolatedRoot();
  const serverBundle = createServer({ rootDir });
  const listener = serverBundle.app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  if (typeof listener.unref === "function") {
    listener.unref();
  }
  const { port } = listener.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function close() {
    await shutdownTestServices(serverBundle.services || {});
    if (typeof listener.closeAllConnections === "function") {
      listener.closeAllConnections();
    }
    if (typeof listener.closeIdleConnections === "function") {
      listener.closeIdleConnections();
    }
    await Promise.race([
      new Promise(resolve => listener.close(resolve)),
      new Promise(resolve => setTimeout(resolve, 500))
    ]);
    const removed = await removeDirWithRetry(rootDir, {
      maxAttempts: 10,
      delayMs: 80
    });
    if (!removed.ok) {
      const message = String(removed.error?.message || removed.error || "root_cleanup_failed");
      console.warn(`[TEST][HTTP] temp root cleanup warning: ${message}`);
    }
  }

  return {
    rootDir,
    baseUrl,
    listener,
    services: serverBundle.services,
    requestJson: (method, routePath, body = null, headers = {}) => requestJson(baseUrl, method, routePath, body, headers),
    requestText: async (method, routePath, body = null, headers = {}) => {
      const response = await fetch(toUrl(baseUrl, routePath), {
        method,
        headers: {
          Connection: "close",
          ...(headers || {})
        },
        body: body === null ? undefined : body
      });
      return {
        status: response.status,
        ok: response.ok,
        text: await response.text()
      };
    },
    close
  };
}

module.exports = {
  bootHttpTestServer
};
