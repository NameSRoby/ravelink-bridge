// [TITLE] Module: core/genre-state.js
// [TITLE] Purpose: genre-state

let ACTIVE_GENRE = "edm";

module.exports = {
  get() {
    return ACTIVE_GENRE;
  },
  set(name) {
    ACTIVE_GENRE = name || "edm";
    console.log("[GENRE] set →", ACTIVE_GENRE);
  }
};
