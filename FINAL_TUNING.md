# Final Tuning Lock (2026-02-11)

## Locked Defaults
- Overclock default: `6 Hz` (`RAVE_DEFAULT_OVERCLOCK_LEVEL=2`).
- Slow modes retained: `2 Hz` and `4 Hz`.
- Supported rates: `2/4/6/8/10/12/14/16 Hz`.
- Default auto profile: `balanced` (`RAVE_AUTO_PROFILE=balanced`).
- Default audio reactivity preset: `balanced` (`RAVE_AUDIO_REACTIVITY_PRESET=balanced`).
- Meta auto recommended default: `on` (`RAVE_META_AUTO_DEFAULT=1`).
- Hue transport on engine start: automatically switches to entertainment mode in `server.js` (`handleRaveOn`).

## Final Stability Tweaks
- Added stricter auto flow-scene switching windows to reduce rapid scene churn.
- Added extra hold/confirm penalties specifically for auto flow-to-flow scene hops.
- Kept fast pulse-path responsive for strong build/drop/extreme-motion moments.

## Burn-In Validation (10-minute virtual run)
- Duration: `600000 ms` simulated.
- Coverage: all core scenes (`idle_soft, flow, pulse_drive`) with palette families and meta-auto on/off.

Results:
- Scene changes: `60` total (`6.0/min`).
- Behavior changes: `68` total (`6.8/min`).
- Fast scene-thrash `<2s`: `0`.
- Very-fast scene-thrash `<1s`: `0`.
- Overclock changes: `37` total (`3.7/min`).

## Runtime Quick Check
1. Start engine and audio: `POST /rave/on`
2. Ensure meta auto ON: `POST /rave/meta/auto/on`
3. Verify palette runtime: `GET /rave/palette`
4. Set palette families: `POST /rave/palette` body `{"families":["blue","purple"],"colorsPerFamily":3,"disorder":false}`
5. Set palette disorder: `POST /rave/palette` body `{"disorder":true,"disorderAggression":0.35}`
6. Verify telemetry: `GET /rave/telemetry` (`scene`, `behavior`, `overclockLevel`, `metaAutoReason`, `metaAutoGenre`)

## Notes
- `metaAutoReason` can change frequently by design; this is expected and does not imply scene thrash.
- Scene stability should now be visibly smoother in `auto` while preserving impactful pulse moments on stronger musical events.
