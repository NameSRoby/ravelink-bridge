// [TITLE] Module: public/assets/js/domains/ui-tooltips-mods-runtime-ui.js
// [TITLE] Purpose: mod UI/import tooltip copy ownership
// [TITLE] Functionality Index:
// [TITLE] - mod UI host tooltips
// [TITLE] - mod import/hotswap tooltips

function applyModsUiTooltips({ el, setNodeTitle }) {
  setNodeTitle(el.modUiSelect, "Choose a loaded mod UI package.");
  setNodeTitle(el.modUiRefreshBtn, "Refresh UI catalog from mod loader routes.");
  setNodeTitle(el.modUiReloadBtn, "Open the selected mod UI in its generated RaveLink tab.");
  setNodeTitle(el.modUiOpenBtn, "Open selected mod UI in a separate browser tab.");
  setNodeTitle(el.modUiStatus, "Current status for mod UI catalog and selected host frame.");
  setNodeTitle(el.modUiFrame, "Sandboxed mod UI frame.");
  setNodeTitle(el.modDropZone, "Drop a mod folder here to import directly.");
  setNodeTitle(el.modImportStatus, "Current drag/drop import status.");
  setNodeTitle(el.modImportBrowseBtn, "Pick a mod folder from disk and import it.");
  setNodeTitle(el.modImportOverwrite, "Replace existing mod files when mod id already exists.");
  setNodeTitle(el.modImportEnable, "Automatically enable imported mod and apply hotswap.");
  setNodeTitle(el.modImportPicker, "Folder picker for mod import.");
  setNodeTitle(el.moddingReadmeBtn, "Open formatted modding developer docs in a separate page.");
}
