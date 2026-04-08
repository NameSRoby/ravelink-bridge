# RaveLink Bridge Repository Documentation

This folder is the complete developer documentation set for the repository.
It combines architecture explanations, implementation walkthroughs, API/runtime references, and mod documentation.

The first half of the set explains the repository in broad, domain-first terms, but it is no longer only a high-level map.
Those chapters now include direct code examples, ownership explanations, and step-by-step logic notes for the harder route/runtime/data-flow boundaries.
The later deep-dive chapters are intentionally even denser and should be read with the code open beside them.
They are written to answer not just "what file owns this?" but "why is this split here, what truth does it own, and what breaks if you collapse that boundary?"

## Chapters

- [00-study-guide.md](./00-study-guide.md)
- [01-system-architecture.md](./01-system-architecture.md)
- [02-backend-routes-and-runtime.md](./02-backend-routes-and-runtime.md)
- [03-frontend-ui-composition.md](./03-frontend-ui-composition.md)
- [04-audio-live-and-rave.md](./04-audio-live-and-rave.md)
- [05-mod-platform.md](./05-mod-platform.md)
- [06-song-request-mod-deep-dive.md](./06-song-request-mod-deep-dive.md)
- [07-practical-cookbook-and-examples.md](./07-practical-cookbook-and-examples.md)
- [08-operations-testing-and-release.md](./08-operations-testing-and-release.md)
- [09-api-reference-index.md](./09-api-reference-index.md)
- [10-data-models-and-state-files.md](./10-data-models-and-state-files.md)
- [11-security-model-and-hardening.md](./11-security-model-and-hardening.md)
- [12-troubleshooting-and-debug-playbook.md](./12-troubleshooting-and-debug-playbook.md)
- [13-ui-shell-onboarding-theme-and-mod-docking.md](./13-ui-shell-onboarding-theme-and-mod-docking.md)
- [14-audio-live-engine-deep-dive.md](./14-audio-live-engine-deep-dive.md)
- [15-system-oauth-helix-and-safe-internet.md](./15-system-oauth-helix-and-safe-internet.md)
- [16-song-request-player-widget-and-queue-deep-dive.md](./16-song-request-player-widget-and-queue-deep-dive.md)
- [17-maintainer-code-walkthroughs.md](./17-maintainer-code-walkthroughs.md)

## Audience

- developers onboarding to this codebase
- contributors adding features or fixing bugs
- mod authors building integrations

## Suggested Pairing With Existing Docs

- `docs/REPO_HANDBOOK.md`
- `docs/architecture/*`
- `docs/migration/*`

Use this documentation set as your primary implementation guide, and pair it with architecture docs for contract-level detail.

## Reading Depth

Chapters 01-12 now give both the map and the core implementation logic. They are the best place to learn request flow, frontend boot ownership, config/state shapes, route contracts, and operational/debugging practice.

Chapters 13-17 remain the hardest deep dives: they explain the difficult runtime flows, why the code is split the way it is, how to reason about optional mod docking, how the audio/LIVE/engine pipeline turns sound into light behavior, how safe-internet and Twitch Helix redemption sync work, and how maintainers should change code without breaking the UI.

## Recommended Reading Modes

### Quick orientation

Read:

1. `00-study-guide.md`
2. `01-system-architecture.md`
3. `03-frontend-ui-composition.md`
4. `04-audio-live-and-rave.md`
5. `05-mod-platform.md`

This gives you the map without demanding deep code reading yet.

### Serious implementation onboarding

Read the full set in order, but keep the repo open and follow file paths in real time.
The deep-dive chapters are designed to be read slowly with source files and tests beside them.
If you skip the code examples and only skim prose, you will miss some of the most important ownership boundaries in the repo.

### "I need to understand the hard parts"

Start with the chapter that matches the pain point:

- browser shell, onboarding, theme, mod docking: `13-ui-shell-onboarding-theme-and-mod-docking.md`
- audio capture, LIVE state, engine behavior: `14-audio-live-engine-deep-dive.md`
- Twitch OAuth, Helix reconcile, safe internet: `15-system-oauth-helix-and-safe-internet.md`
- song-request queue, widget, player, history: `16-song-request-player-widget-and-queue-deep-dive.md`
- practical change strategy: `17-maintainer-code-walkthroughs.md`
