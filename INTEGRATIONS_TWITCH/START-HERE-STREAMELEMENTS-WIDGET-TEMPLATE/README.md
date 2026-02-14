# START HERE - StreamElements Widget Template

If you are setting up StreamElements rewards integration, use:

- `PASTE-INTO-STREAMELEMENTS-CUSTOM-WIDGET.js`
- `reward-listener.template.js` (same sanitized template)

Quick steps:
1. Open that file.
2. Fill your Twitch reward IDs.
3. For `TEACH_REWARD_ID`, reward text format is `<name> <#RRGGBB>` (example `toxic_green #39ff14`).
4. Keep `BASE_URL` as `http://127.0.0.1:5050` when bridge and OBS run on the same PC.
5. Paste the script into a StreamElements Custom Widget.
6. Add that widget in OBS as a Browser Source.
7. Keep OBS running with that Browser Source active while testing rewards.

Legacy copy also exists at:
- `INTEGRATIONS_TWITCH/streamelements/reward-listener.template.js`
