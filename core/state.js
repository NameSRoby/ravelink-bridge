/**
 * ======================================================
 * CORE STATE — FINAL / SINGLE SOURCE OF TRUTH
 * ======================================================
 * This file knows:
 * - who currently owns the lights
 * - whether commands are allowed
 * - when locks were acquired
 *
 * NOTHING ELSE should track this state.
 */

const state = {
    lockOwner: null,      // e.g. "rave"
    lockSince: 0
};

/* =========================
   LOCK CONTROL
========================= */
function lock(owner) {
    if (!owner) return false;
    state.lockOwner = owner;
    state.lockSince = Date.now();
    console.log(`[STATE] locked by ${owner}`);
    return true;
}

function unlock(owner) {
    if (state.lockOwner !== owner) return false;
    state.lockOwner = null;
    state.lockSince = 0;
    console.log(`[STATE] unlocked by ${owner}`);
    return true;
}

function forceUnlock() {
    console.log(`[STATE] force unlock (was ${state.lockOwner})`);
    state.lockOwner = null;
    state.lockSince = 0;
}

/* =========================
   QUERIES
========================= */
function isLocked() {
    return state.lockOwner !== null;
}

function isLockedBy(owner) {
    return state.lockOwner === owner;
}

function getStatus() {
    return {
        locked: isLocked(),
        owner: state.lockOwner,
        since: state.lockSince
    };
}

module.exports = {
    lock,
    unlock,
    forceUnlock,
    isLocked,
    isLockedBy,
    getStatus
};
