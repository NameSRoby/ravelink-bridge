# Palette Family Repair Map

## Goal
Keep family identity clearly distinct at low/medium counts, with controlled cross-family convergence only at high density.

## Current Discrepancies (Audit Findings)

### P0 - Color logic is duplicated in multiple runtime paths
- `core/rave-engine.js:1950` defines manual palette families and spans for engine-driven palette output.
- `server.js:352` defines a second copy for fixture override pathing (`pickFixturePaletteColor` at `server.js:5203`).
- `public/index.html:6703` and `public/index.html:6842` define a third copy for UI family/preset behavior.
- `core/midi/midi-manager.js:14` defines another copy for MIDI family toggles/presets.
- Risk: changing one path can make global palette output differ from fixture overrides, UI presets, and MIDI actions.

### P0 - Adjacent families overlap too early at 8 colors
- Current span policy is global for all families (`core/rave-engine.js:2047`, `server.js:444`), using 8-color indices `[2..9]`.
- With current family arrays, adjacent overlap already happens at 8:
  - `green` vs `cyan` overlap zone (roughly mid/upper green-cyan hues).
  - `cyan` vs `blue` overlap zone (roughly ~198-200 deg).
- This violates the stricter identity rule where heavy merge should happen mainly at 12.

### P1 - Cyan family drifts too blue in shared definitions
- `core/rave-engine.js:2008` and `server.js:407` define cyan with upper entries very close to blue-family low entries.
- Even when technically different, practical fixture gamut/compression can make cyan read as "just blue" in low/mid density playback.

### P1 - Ordered-flow optimizer can weaken perceived family identity
- `core/rave-engine.js:2936` and `server.js:4528` rotate/reverse family segments to minimize transition distance.
- This helps smoothness but can make boundaries feel less explicit when users expect fixed family progression feel.

### P2 - Presets and aliases reinforce ambiguity
- "Cool bridge" preset heavily weights cyan/blue adjacency:
  - `public/index.html:6857`
  - `core/midi/midi-manager.js:33`
- Legacy alias semantics can confuse intent:
  - `palette_family_purple` maps to red tone (`core/midi/action-normalizer.js:20`, `public/index.html:5798`).

### P2 - No regression tests for family distinctness contracts
- Existing tests validate patch plumbing and endpoint behavior (`tests/api-regression.test.js`) but not hue-separation constraints.

## Repair Plan

## Pass 1 (P0): Single source of truth for palette families
1. Create shared module (example: `core/palette/family-spec.js`) containing:
   - Family order, aliases, per-family color definitions, per-count selection rules, presets.
2. Refactor all consumers to import the shared module:
   - `core/rave-engine.js`
   - `server.js` fixture override palette path
   - `core/midi/midi-manager.js`
3. Remove duplicated hard-coded family arrays/spans from those files.

## Pass 2 (P0/P1): Re-shape cyan and adjacent boundaries
1. Replace one-size-fits-all span selection with per-family/per-count selection policy.
2. Tighten boundary rules:
   - 1/3/5: no adjacent-family overlap.
   - 8: near-touch allowed, overlap disallowed.
   - 12: controlled overlap allowed.
3. Re-anchor cyan to read as green-blue bridge (teal/aqua leaning), not blue clone.
4. Shift blue low edge away from cyan high edge for 3/5/8 counts.

## Pass 3 (P1): Preserve identity in ordered mode
1. Keep ordered flow smoothing, but constrain rotate/reverse choices by family boundary guards.
2. Add option to lock family direction when identity-preservation mode is enabled.

## Pass 4 (P2): UI/MIDI consistency cleanup
1. Align preset definitions with new distinctness policy:
   - Rebalance `duo_cool` and `duo_warm` count distributions.
2. Keep legacy aliases for compatibility, but relabel clearly in UI and docs.
3. Surface family intent in UI copy (bridge vs anchor family behavior at each count tier).

## Pass 5 (P2): Add test coverage for color-family integrity
1. Add tests that verify adjacent-family hue separation per count tier.
2. Add snapshot tests ensuring engine and server fixture override paths generate equivalent family sequences from same config.
3. Add preset contract tests (UI/MIDI preset IDs map to same patch semantics).

## Acceptance Criteria
- Same palette config yields consistent family sequence behavior across:
  - global engine output
  - fixture override output
  - UI preset activation
  - MIDI preset/family actions
- Cyan is visually distinguishable from blue at 1/3/5/8 on both Hue and WiZ.
- 12-color mode may approach adjacent families but remains ordered and intentional.
- No endpoint or profile persistence regression.

