# Streaming Integrations

RaveLink Bridge is designed to let chat and channel points trigger local lighting actions over HTTP.

## Transport Pattern

All streaming integrations map events to bridge endpoints on:
- `http://127.0.0.1:5050`

If the bot does not run on the same machine as the bridge:
- use LAN host URL (for example `http://192.168.1.x:5050`)
- or use a secured relay/tunnel

## StreamElements Widget Path

Template:
- `INTEGRATIONS_TWITCH/START-HERE-STREAMELEMENTS-WIDGET-TEMPLATE/PASTE-INTO-STREAMELEMENTS-CUSTOM-WIDGET.js`

Setup:
1. Create Twitch rewards (for example `Color`, `Teach`, `Rave`).
2. Copy reward IDs into template constants.
3. Keep `BASE_URL` local when OBS and bridge run on same PC.
4. Create a StreamElements Custom Widget and paste template JS.
5. Add widget to OBS as a Browser Source.

## Streamer.bot Or Any HTTP-Capable Bot

You can use Streamer.bot, Mix It Up, SAMMI, or any bot that can send HTTP requests.

Common mappings:
- `POST /rave/on`
- `POST /rave/off`
- `GET /teach?value1=<phrase>`
- `GET /color?value1=<color>`

More control:
- `POST /rave/genre?name=techno`
- `POST /rave/scene?name=flow`
- `POST /rave/auto/profile?name=reactive`
- `POST /rave/audio/reactivity?name=aggressive`
- `POST /rave/meta/auto/on`

## Command Targets And Zones

Color command supports:
- `target=hue|wiz|both`
- `zone=<zone>`
- `hueZone=<zone>`
- `wizZone=<zone>`

Example:
- `/color?value1=cyan&target=wiz&zone=wiz`

## Safety

Keep high-risk endpoints out of public chat:
- `/rave/panic`
- `/rave/reload`
- `/system/stop`

Prefer local-only bridge access unless you are intentionally operating a hardened remote setup.
