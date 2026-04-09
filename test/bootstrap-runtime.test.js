const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getHashCachePath,
  isProtectedInstallRoot,
  shouldInstallDependencies
} = require("../scripts/bootstrap-runtime.js");

test("bootstrap runtime detects Program Files as a protected install root", () => {
  const env = {
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    ProgramW6432: "C:\\Program Files"
  };

  assert.equal(
    isProtectedInstallRoot("C:\\Program Files\\RaveLink Bridge", env, "win32"),
    true
  );
  assert.equal(
    isProtectedInstallRoot("D:\\Apps\\RaveLink Bridge", env, "win32"),
    false
  );
});

test("bootstrap runtime uses a per-user hash cache for protected installs", () => {
  const env = {
    LOCALAPPDATA: "C:\\Users\\Tester\\AppData\\Local",
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    ProgramW6432: "C:\\Program Files"
  };

  const hashCachePath = getHashCachePath("C:\\Program Files\\RaveLink Bridge", env, "win32");
  assert.equal(
    hashCachePath,
    "C:\\Users\\Tester\\AppData\\Local\\RaveLink Bridge\\runtime\\bootstrap\\deps-lock.sha256"
  );
});

test("bootstrap runtime trusts packaged dependencies in protected installs", () => {
  const decision = shouldInstallDependencies({
    forceInstallRequested: false,
    modulesPresent: true,
    cachedHash: "",
    lockHash: "abc123",
    protectedInstallRoot: true
  });

  assert.deepEqual(decision, {
    needsInstall: false,
    reason: "protected_install_uses_packaged_dependencies",
    ignoreForceInstall: false
  });
});

test("bootstrap runtime ignores forced reinstalls in protected installs", () => {
  const decision = shouldInstallDependencies({
    forceInstallRequested: true,
    modulesPresent: true,
    cachedHash: "old",
    lockHash: "new",
    protectedInstallRoot: true
  });

  assert.deepEqual(decision, {
    needsInstall: false,
    reason: "protected_install_uses_packaged_dependencies",
    ignoreForceInstall: true
  });
});

test("bootstrap runtime still requests install in writable dev workspaces", () => {
  const decision = shouldInstallDependencies({
    forceInstallRequested: false,
    modulesPresent: false,
    cachedHash: "",
    lockHash: "abc123",
    protectedInstallRoot: false
  });

  assert.deepEqual(decision, {
    needsInstall: true,
    reason: "node_modules_missing_or_incomplete",
    ignoreForceInstall: false
  });
});
