# Third-Party Notices

This file tracks third-party code usage, adapted logic, and required attribution for `v1.6.3`.

## Policy

- If code is adapted from an external source or repository, add an entry before merge.
- Include source URL, license, and impacted local files.
- Keep entries specific and auditable.

## Entry Template

Use this format for each source:

```text
Name:
Source:
License:
Used In:
Notes:
```

## Current Notices

- Name: hue-sync
  Source: https://www.npmjs.com/package/hue-sync
  License: MIT (per package metadata)
  Used In: `src/adapters/brands/hue-entertainment.runtime.js`
  Notes: optional transport dependency for Hue Entertainment DTLS session start/send/stop.

- Name: node-dtls-client
  Source: https://www.npmjs.com/package/node-dtls-client
  License: MIT (per package metadata)
  Used In: transitively through `hue-sync` when Entertainment transport is active.
  Notes: declared as optional dependency to keep local startup resilient if installation is unavailable.

- Name: cross-fetch
  Source: https://www.npmjs.com/package/cross-fetch
  License: MIT (per package metadata)
  Used In: `src/adapters/brands/hue-entertainment.runtime.js`
  Notes: required fetch compatibility shim for Hue Entertainment runtime behavior (`hue-sync` peer dependency).

- Name: WiZ Local Control Documentation
  Source: https://gitlab.com/wizlighting/wiz-local-control/-/raw/master/README.md
  License: Documentation reference only (no code copied; license not specified in the referenced README)
  Used In: `src/adapters/brands/wiz-bridge.adapter.js`, `src/domains/engine-v2/engine.runtime.js`
  Notes: used to confirm local `setPilot` dimming contract (`10..100`) and keep WiZ brightness mapping and protocol constraints explicit.
