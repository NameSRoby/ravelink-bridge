# 06. Song Request Mod Deep Dive

This chapter studies `mods/song-request-mod` as a production-grade reference mod. It covers runtime architecture, queue/action lifecycles, chat and widget integration, browser-player coordination, admin tooling, and extension points.

The point of this chapter is not only to document one mod. It is to show how a large mod uses the platform correctly without becoming inseparable from the host server.

## Learning Outcomes

After this chapter, you should be able to:

1. explain how requests move from chat/redemption input to playback actions
2. debug queue state vs player action state
3. extend commands and admin endpoints safely
4. understand how the browser player, overlay, widget, and local control UI cooperate
5. maintain security for public-facing mod endpoints

## 1. Architecture Overview

Main files:

- `mods/song-request-mod/mod.json`
- `mods/song-request-mod/index.js`
- `mods/song-request-mod/config.json`
- `mods/song-request-mod/state.json`
- `mods/song-request-mod/ui/index.html`
- `mods/song-request-mod/ui/app.js`
- `mods/song-request-mod/ui/overlay.html`
- `mods/song-request-mod/ui/player-bridge.html`
- `mods/song-request-mod/templates/PASTE-INTO-STREAMELEMENTS-CUSTOM-WIDGET.js`
- `mods/song-request-mod/providers/youtubeMusicDriver.js`

Subsystems:

1. request intake and policy engine
2. resolver pipeline (`itunes-api`, `apple-api`, browser search modes)
3. queue and stream-session accounting
4. player action queue (`player_pull` / `player_ack`)
5. browser driver / bridge runtime
6. overlay and widget integrations
7. admin APIs and diagnostics

## 2. Runtime Entry and Sandbox Adapter

The mod exports sandbox-native `hooks` and dynamic `actions`:

```js
module.exports = {
  hooks: {
    onLoad(context) { /* ... */ },
    onBoot(context) { /* ... */ },
    onShutdown(context) { /* ... */ },
    onUnload(context) { /* ... */ },
    onHttp(context) { /* dispatch by action */ }
  },
  actions: new Proxy(Object.create(null), {
    get(_target, prop) {
      return context => runOnHttpAction(String(prop || "").toLowerCase(), context);
    },
    has() { return true; }
  })
};
```

This adapter layer is important because it lets the mod keep one internal HTTP-style dispatch model while still fitting the sandbox platform's hook/action contract.

## 3. Queue, Playback, and History Are Separate Lanes

The mod deliberately does **not** reduce everything to one list.

Core state lanes:

- `state.queue`
- `state.playlistAdds`
- `state.playerActions`
- `state.playHistory`
- `state.nowPlaying`
- `state.streamSession.requestCounts`

Why each lane exists:

- `queue`: accepted viewer requests that still matter to scheduling
- `playerActions`: work that the browser player must perform next
- `playHistory`: append-only record of what happened
- `nowPlaying`: current known playback snapshot
- `streamSession`: per-stream counters and quota state

This separation is what allows the mod to preserve FIFO request order without pretending it owns the entire browser queue.

## 4. Queue Lifecycle

A normal request path looks like this:

1. request accepted -> queue row created (`status: queued`)
2. dispatch logic promotes it into a browser/player action
3. browser player consumes action via `player_pull`
4. browser player confirms via `player_ack`
5. queue/history/now-playing state is updated

Recent behavior changes make this especially important:

- viewer requests are inserted as user interjections, not as full ownership of the user's whole music queue
- the mod preserves FIFO order of viewer requests internally
- browser autoplay / playlist content is not treated as fully mod-owned queue state

## 5. Player Pull / Ack Contract

The browser-player bridge model is central to the mod.

Flow:

1. player client calls `GET /mods/music-request-engine/player_pull`
2. mod returns pending actions
3. player executes one action
4. player posts `POST /mods/music-request-engine/player_ack`

`player_pull` example:

```json
{
  "ok": true,
  "actions": [
    {
      "actionId": 42,
      "type": "enqueue_song",
      "payload": {
        "requestId": 102,
        "song": { "id": "1450081287", "title": "Fils de joie", "artist": "Stromae" }
      }
    }
  ],
  "pendingCount": 1
}
```

`player_ack` example:

```json
{
  "actionId": 42,
  "ok": true,
  "error": ""
}
```

This split exists because the mod cannot assume synchronous control over the browser player. It has to express intent, then wait for the browser-controlled environment to acknowledge execution.

## 6. Chat Commands and Local UI Are Different Interfaces

Two command lanes exist:

1. Twitch / StreamElements chat-command style inputs
2. local operator control UI inside the mod panel

The local Requests tab is no longer supposed to be a fake Twitch chatter simulator. It is an operator console. That distinction matters because:

- chat commands need user/role semantics
- local UI actions are privileged broadcaster/operator actions

This is why recent UI cleanup removed a lot of unnecessary "pretend chatter" inputs from the local panel.

## 7. StreamElements Widget Flow

The generated widget script in `PASTE-INTO-STREAMELEMENTS-CUSTOM-WIDGET.js` is effectively a remote extension of the mod.

Typical widget flow:

1. receive redemption/chat event
2. normalize user/reward/message metadata
3. dedupe with `chat_dedupe_claim`
4. call mod request or command action
5. optionally send chat feedback
6. rely on server-side gateway/OAuth lane for redemption reconcile

This is important: the widget is no longer supposed to own direct Helix PATCH behavior on its own. The safer system-first OAuth/gateway path now owns that responsibility.

## 8. Overlay and Widget Artifacts

Overlay endpoint:

- `GET /mods/music-request-engine/overlay_state`

Overlay UI route:

- `/mods-ui/music-request-engine/overlay.html`

Widget template generation:

- `POST /mods/music-request-engine/admin_widget_template_get`

Recent overlay behavior worth documenting:

- the overlay access URL token now persists across normal server restarts
- token rotation happens when the operator explicitly requests a new URL
- this stability is important for OBS scenes and long-lived overlay references

## 9. Browser Player Mirror and Driver Diagnostics

The mod UI can now mirror browser player state instead of only showing queue rows. That means the operator UI can display:

- current track
- browser-side up-next data
- requester association when applicable
- progress and playback state
- driver/browser diagnostics

This is an important architectural improvement because the mod is not guessing blindly about playback anymore. It is explicitly mirroring the browser-side reality when the browser can provide it.

## 10. Admin Tooling

The control UI (`/mods-ui/music-request-engine/`) is an operator console for:

1. policy and limits
2. permissions
3. overlay builder and tokenized share URL rotation
4. widget template generation
5. driver warmup/restart/diagnostics
6. Twitch OAuth device flow and system-first sync
7. playback history review and clear actions

Representative policy patch:

```json
{
  "patch": {
    "requestPolicy": {
      "queueLimitMode": "active-queue",
      "defaultQueueLimit": 5,
      "maxQueueSize": 250
    },
    "security": {
      "requireViewerSecret": true,
      "requireAdminSecret": true
    }
  }
}
```

## 11. Security Model

Action security is per-action and token-based:

1. admin actions can require `adminSecret`
2. viewer actions can require `viewerSecret`
3. `overlay_state` can be protected by `overlayAccessToken`
4. keys can be supplied by body, headers, or bearer auth

Secret persistence model:

- plaintext `config.json` is scrubbed for sensitive fields
- OAuth runtime values are stored in `.runtime/twitch-oauth.vault.json`
- overlay token persistence uses runtime-scoped storage rather than user-visible config

This split is important because the mod is both:

- a local operator tool
- a public-facing integration surface for chat/widgets/overlay

Those are different trust zones.

## 12. Extension Points

Common safe extensions:

1. add resolver mode
2. add action
3. add chat command
4. extend widget template behavior
5. add UI diagnostics or operator controls

The safe pattern is always:

1. add the behavior in the mod core
2. classify auth requirements correctly
3. surface it through UI/widget only after the action contract is stable

## 13. Debugging Checklist

When behavior is unclear, inspect in this order:

1. `GET /mods/music-request-engine/status`
2. `GET /mods/music-request-engine/state`
3. `GET /mods/music-request-engine/events`
4. `POST /mods/music-request-engine/driver_status`
5. relevant UI diagnostics in the local mod UI

And when debugging queue bugs specifically, ask these questions:

1. is the queue row still pending?
2. was a player action generated?
3. did the player pull it?
4. did the player ack it?
5. did history mutate as expected?

That sequence is usually enough to isolate the lane where the bug actually lives.
