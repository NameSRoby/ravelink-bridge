const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function collectPasswordInputs(source) {
  return [...source.matchAll(/<input\b[^>]*type="password"[^>]*>/g)].map(match => match[0]);
}

test("server and mod secret fields opt out of browser password-manager heuristics", () => {
  const files = [
    "public/templates/index/sections/panel-fixtures.html",
    "public/templates/index/sections/panel-system.html"
  ];

  const localOnlyModPath = "mods/song-request-mod/ui/index.html";
  if (fs.existsSync(path.join(repoRoot, localOnlyModPath))) {
    files.push(localOnlyModPath);
  }

  for (const relativePath of files) {
    const source = read(relativePath);
    const passwordInputs = collectPasswordInputs(source);
    assert.ok(passwordInputs.length > 0, `${relativePath} should still contain secret fields`);
    for (const inputTag of passwordInputs) {
      assert.match(inputTag, /\bautocomplete="new-password"/, `${relativePath} password fields must use autocomplete="new-password"`);
      assert.match(inputTag, /\bdata-lpignore="true"/, `${relativePath} password fields must opt out of LastPass-style detection`);
      assert.match(inputTag, /\bdata-1p-ignore="true"/, `${relativePath} password fields must opt out of 1Password-style detection`);
    }
  }
});
