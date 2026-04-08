// [TITLE] Module: public/assets/js/domains/mods/mods-import-runtime-ui.js
// [TITLE] Purpose: mods import pipeline runtime for browse/drop descriptor payload flows
// [TITLE] Functionality Index:
// [TITLE] - import descriptor normalization and relative path sanitization
// [TITLE] - file reading + base64 payload assembly for upload route
// [TITLE] - drag/drop directory traversal and import action orchestration
// [DEV] Complex Flow:
// [DEV] Import pipeline must preserve deterministic path normalization and mod snapshot
// [DEV] apply semantics so browse/drop workflows behave identically across Windows shells.

function createModsImportRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const windowRef = deps.windowRef || window;
  const FileReaderRef = deps.FileReaderRef || FileReader;
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const renderMods = typeof deps.renderMods === "function" ? deps.renderMods : (() => {});
  const loadMods = typeof deps.loadMods === "function" ? deps.loadMods : (async () => false);
  const cloneModConfig = typeof deps.cloneModConfig === "function"
    ? deps.cloneModConfig
    : (config => JSON.parse(JSON.stringify(config || {})));
  const modsEndpointsAdapter = deps.modsEndpointsAdapter && typeof deps.modsEndpointsAdapter === "object"
    ? deps.modsEndpointsAdapter
    : {};

  function normalizeImportRelativePath(rawPath) {
    const normalized = String(rawPath || "")
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "")
      .trim();
    if (!normalized) return "";
    const parts = normalized.split("/").filter(Boolean);
    const safe = [];
    for (const part of parts) {
      if (part === "." || part === "..") continue;
      safe.push(part);
    }
    return safe.join("/");
  }

  function setModImportStatus(text) {
    if (!el.modImportStatus) return;
    el.modImportStatus.value = String(text || "").trim();
  }

  function setModImportBusy(busy) {
    const nextBusy = busy === true;
    ui.modImportBusy = nextBusy;
    if (el.modImportBrowseBtn) el.modImportBrowseBtn.disabled = nextBusy;
    if (el.modImportPicker) el.modImportPicker.disabled = nextBusy;
    if (el.modDropZone) {
      el.modDropZone.classList.toggle("busy", nextBusy);
      el.modDropZone.setAttribute("aria-busy", nextBusy ? "true" : "false");
    }
  }

  function filesToImportDescriptors(fileList) {
    const files = Array.from(fileList || []);
    return files.map(file => ({
      file,
      relativePath: normalizeImportRelativePath(file.webkitRelativePath || file.name || ""),
      name: String(file?.name || "").trim()
    })).filter(entry => entry.file && entry.relativePath);
  }

  function readImportFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReaderRef();
      reader.onerror = () => reject(new Error(`failed to read ${String(file?.name || "file")}`));
      reader.onload = () => {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        const base64 = comma >= 0 ? result.slice(comma + 1) : "";
        if (!base64) {
          reject(new Error(`empty file payload for ${String(file?.name || "file")}`));
          return;
        }
        resolve(base64);
      };
      reader.readAsDataURL(file);
    });
  }

  async function buildImportPayloadFromDescriptors(descriptors) {
    const rows = Array.isArray(descriptors) ? descriptors : [];
    const out = [];
    const seen = new Set();
    for (const row of rows) {
      const file = row?.file;
      const relativePath = normalizeImportRelativePath(row?.relativePath || row?.name || file?.name || "");
      if (!file || !relativePath) continue;
      if (seen.has(relativePath)) continue;
      seen.add(relativePath);
      const data = await readImportFileAsBase64(file);
      out.push({
        path: relativePath,
        data
      });
    }
    return out;
  }

  async function readDroppedEntriesRecursively(entry, prefix = "") {
    if (!entry) return [];
    if (entry.isFile) {
      return new Promise(resolve => {
        entry.file(file => {
          const fileName = normalizeImportRelativePath(file?.name || "");
          const pref = normalizeImportRelativePath(prefix || "");
          const relativePath = normalizeImportRelativePath(pref ? `${pref}/${fileName}` : fileName);
          if (!relativePath) {
            resolve([]);
            return;
          }
          resolve([{
            file,
            name: fileName,
            relativePath
          }]);
        }, () => resolve([]));
      });
    }

    if (!entry.isDirectory) return [];
    const nextPrefix = normalizeImportRelativePath(prefix ? `${prefix}/${entry.name || ""}` : entry.name || "");
    const reader = entry.createReader();
    const chunked = [];

    const readEntriesChunk = () => new Promise(resolve => {
      reader.readEntries(entries => resolve(Array.isArray(entries) ? entries : []), () => resolve([]));
    });

    while (true) {
      const chunk = await readEntriesChunk();
      if (!chunk.length) break;
      chunked.push(...chunk);
    }

    let out = [];
    for (const child of chunked) {
      const nested = await readDroppedEntriesRecursively(child, nextPrefix);
      out = out.concat(nested);
    }
    return out;
  }

  async function descriptorsFromDropEvent(event) {
    const dataTransfer = event?.dataTransfer;
    if (!dataTransfer) return [];

    const itemEntries = [];
    const items = Array.from(dataTransfer.items || []);
    for (const item of items) {
      const asEntry = typeof item?.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
      if (asEntry) itemEntries.push(asEntry);
    }

    if (itemEntries.length) {
      let out = [];
      for (const entry of itemEntries) {
        const nested = await readDroppedEntriesRecursively(entry, "");
        out = out.concat(nested);
      }
      if (out.length) return out;
    }

    return filesToImportDescriptors(dataTransfer.files || []);
  }

  async function importModFromDescriptors(descriptors, sourceLabel = "drop") {
    const records = Array.isArray(descriptors) ? descriptors : [];
    if (!records.length) {
      setModImportStatus("No files found. Drop a folder that contains mod.json.");
      setBadge(el.health, "warn", "MOD IMPORT: NO FILES");
      return false;
    }

    setModImportBusy(true);
    setModImportStatus(`Preparing ${records.length} file(s) from ${sourceLabel}...`);

    try {
      const files = await buildImportPayloadFromDescriptors(records);
      if (!files.length) {
        setModImportStatus("No readable files found for import.");
        setBadge(el.health, "warn", "MOD IMPORT EMPTY");
        return false;
      }

      setModImportStatus(`Uploading ${files.length} file(s)...`);
      const payload = {
        files,
        overwrite: el.modImportOverwrite?.checked === true,
        enableAfterImport: el.modImportEnable?.checked !== false,
        reload: true
      };

      const response = await modsEndpointsAdapter.importMods(payload);
      if (!response.ok || !response.data?.ok) {
        const errorText = String(response.data?.error || `status ${response.status || 0}`);
        setModImportStatus(`Import failed: ${errorText}`);
        setBadge(el.health, "bad", "MOD IMPORT FAIL");
        return false;
      }

      const snapshot = response.data?.snapshot;
      if (snapshot?.ok) {
        ui.modsDraftDirty = false;
        ui.modsDraftConfig = cloneModConfig(snapshot.config || {});
        renderMods(snapshot);
      } else {
        await loadMods();
      }

      const modId = String(response.data?.modId || "mod").trim();
      setModImportStatus(`Imported ${modId} (${response.data?.importedFiles || files.length} files).`);
      setBadge(el.health, "ok", `MOD IMPORTED ${modId}`);
      return true;
    } catch (err) {
      setModImportStatus(`Import error: ${err?.message || err}`);
      setBadge(el.health, "bad", "MOD IMPORT ERROR");
      return false;
    } finally {
      setModImportBusy(false);
    }
  }

  return {
    normalizeImportRelativePath,
    setModImportStatus,
    setModImportBusy,
    filesToImportDescriptors,
    readImportFileAsBase64,
    buildImportPayloadFromDescriptors,
    readDroppedEntriesRecursively,
    descriptorsFromDropEvent,
    importModFromDescriptors
  };
}
