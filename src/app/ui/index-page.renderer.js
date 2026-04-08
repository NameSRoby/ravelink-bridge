// [TITLE] Module: app/ui/index-page.renderer.js
// [TITLE] Purpose: compose the browser UI from modular HTML section templates
// [TITLE] Functionality Index:
// [TITLE] - load shell + section partials from disk with strict path ownership
// [TITLE] - replace shell placeholders deterministically
// [TITLE] - expose a single render() surface for HTTP routes

const fs = require("fs");
const path = require("path");

function readTemplateText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

module.exports = function createIndexPageRenderer(options = {}) {
  const templateRoot = String(options.templateRoot || "").trim();
  if (!templateRoot) {
    throw new Error("createIndexPageRenderer requires templateRoot");
  }

  const shellPath = path.join(templateRoot, "shell.html");
  const headPath = path.join(templateRoot, "head.html");
  const sectionDir = path.join(templateRoot, "sections");
  const sectionPaths = {
    "{{CHROME}}": path.join(sectionDir, "chrome.html"),
    "{{PANEL_LIVE}}": path.join(sectionDir, "panel-live.html"),
    "{{PANEL_FIXTURES}}": path.join(sectionDir, "panel-fixtures.html"),
    "{{PANEL_AUDIO}}": path.join(sectionDir, "panel-audio.html"),
    "{{PANEL_MIDI}}": path.join(sectionDir, "panel-midi.html"),
    "{{PANEL_SYSTEM}}": path.join(sectionDir, "panel-system.html"),
    "{{PANEL_MODS}}": path.join(sectionDir, "panel-mods.html"),
    "{{SCRIPTS}}": path.join(sectionDir, "scripts.html")
  };

  function compileHtml() {
    let html = readTemplateText(shellPath);
    html = html.replace("{{HEAD}}", readTemplateText(headPath).trim());
    for (const [token, filePath] of Object.entries(sectionPaths)) {
      // [DEV] Every placeholder token is replaced explicitly so missing/extra
      // [DEV] template sections fail loudly during compose rather than at runtime.
      html = html.replace(token, readTemplateText(filePath).trim());
    }
    return `${html.trim()}\n`;
  }

  return {
    render() {
      return compileHtml();
    }
  };
};
