# 16. Song-Request Player, Widget, Queue, and Control Flow Deep Dive

This chapter is intentionally long because the song-request mod is not just "a mod that queues songs." It is a small application living inside the mod platform. It has its own runtime state, its own UI, its own browser-driver coordination, its own queue arbitration logic, and its own Twitch integration behavior.

If you only understand it as "chat commands -> add song," you will misread almost every hard part of the code.

The correct mental model is:

```text
chat/UI/admin intent
  -> mod action normalization
  -> queue state + player actions
  -> browser-driver observation
  -> browser-player dispatch / acknowledgement
  -> history + overlay + widget + announcements
```

This mod is hard because it is synchronizing four realities at once:

1. what users requested
2. what the browser player is actually doing
3. what the mod believes is staged next
4. what Twitch/overlay/chat surfaces should say happened

## 1. File Map

The deepest file is still `mods/song-request-mod/index.js`, but do not read it as one giant undifferentiated script. Read it by responsibility:

```text
mods/song-request-mod/index.js
mods/song-request-mod/ui/index.html
mods/song-request-mod/ui/app.js
mods/song-request-mod/ui/styles.css
mods/song-request-mod/ui/overlay.html
mods/song-request-mod/templates/PASTE-INTO-STREAMELEMENTS-CUSTOM-WIDGET.js
mods/song-request-mod/providers/youtubeMusicDriver.js
test/apple-music-se-command.integration.test.js
test/apple-music-widget-announcer.test.js
test/apple-music-ui-render-hardening.test.js
```

The right way to study `index.js` is to follow the internal sub-problems:

- queue state
- current now-playing reconciliation
- player action dispatch and ack
- history archiving
- OAuth/Twitch helper behavior
- overlay/widget helpers

## 2. The Product Rule: Viewer Songs Are Interjections, Not Ownership Transfer

The mod’s queue behavior makes sense only when you understand the product rule behind it:

The streamer’s own playback may already be running through Apple Music favorites, playlist flow, or auto-play. Viewer requests are supposed to interject into that flow without taking it over permanently.

That is why the server-managed Apple dispatch logic reserves exactly one viewer-request slot behind current playback instead of trying to rebuild the whole Apple queue.

The core comment says it plainly:

```js
// [DEV] Reserve policy: keep at most one "Play Next" request staged behind current playback.
// Additional queued requests must wait in mod state until reserve is consumed.
```

That one sentence explains a lot of the surrounding complexity.

The queue is not trying to mirror the entire external player queue. It is trying to safely inject viewer intent into a player that may already contain non-viewer songs.

## 3. Queue State vs Player State

The mod keeps explicit queue state in server memory and runtime persistence. That state includes entries with statuses such as:

- `queued`
- `submitted`
- current / visible / archived equivalents

The browser player, meanwhile, has its own independent truth:

- what is currently playing
- what is in the browser-exposed Up Next tail
- what metadata Apple Music or YouTube Music exposes right now

Those truths do not always line up instantly.

That is why the mod uses a reconciliation model rather than assuming every dispatch succeeded just because it asked for it.

## 4. Server-Managed Apple Queue Dispatch

The Apple queue feed works by asking a specific question:

Is there exactly one safe "play next" slot available behind current playback?

The answer is computed by `computeAppleDispatchState()` and consumed by `primeAppleManagedQueueDispatch()`.

Representative dispatch logic:

```js
function primeAppleManagedQueueDispatch(reason = "auto") {
  const dispatchState = computeAppleDispatchState(reason);
  if (!dispatchState.ready) return null;
  const next = dispatchState.next;
  if (dispatchState.mode === "force_play_song") {
    return enqueuePlayerAction("force_play_song", { ... });
  }
  return enqueuePlayerAction("enqueue_song", {
    requestId: Math.max(0, Number(next.requestId || 0)),
    target: "queue",
    source: "queue",
    reason: `server_dispatch_${reasonToken}`,
    queueMode: "play-next",
    userKey: asString(next.userKey || ""),
    requestedBy: asString(next.username || next.userId || ""),
    song: {
      id: asString(next.song?.id || ""),
      title: asString(next.song?.title || ""),
      artist: asString(next.song?.artist || ""),
      sourceUrl: asString(next.song?.sourceUrl || next.song?.url || "")
    }
  });
}
```

The important conceptual split is this:

- the queue entry is stored in mod state
- the browser driver gets a player action
- the queue entry is only considered fully progressed when browser observation confirms the transition

That is why order can stay correct even in messy real-world playback.

## 5. FIFO Order Is Preserved In Mod State

The user requirement for order is strict:

If viewer A requests `Nuclear` and viewer B requests `Short Change Hero`, `Nuclear` must dispatch first.

The mod preserves this by treating the internal queue order as authoritative. Only the next eligible entry is staged into the reserved "play next" slot. Later entries wait until the earlier entry is consumed from the browser-visible tail.

This is why reserve fullness and tail reconciliation matter so much. Without them, you would eventually leapfrog requests.

## 6. Why Reconciliation Exists At All

Real players are messy:

- the user can manually skip
- Apple Music can end a track without exposing the exact transition cleanly
- the browser driver can see stale or partial tail snapshots
- external non-queue songs can be playing

So the mod has to observe transitions and re-derive meaning.

That is what `reconcileAppleCurrentTrackTransition()` and `reconcileAppleQueueEntriesAgainstDriverTail()` do.

### Current-track reconciliation

This function asks:

- did the currently playing track change?
- did a track effectively end near its runtime even if identity did not visibly change?
- was the prior current track actually one of our queue entries?
- if so, should it be archived to history as ended or skipped?

Representative core:

```js
const changedTrack = !isSamePlaybackTrack(nextTrack, priorTrack);
const endedWithoutTrackChange = (
  !changedTrack &&
  prior.isPlaying === true &&
  next.isPlaying !== true &&
  nextDuration > 0 &&
  nextElapsed >= Math.max(1, nextDuration - 2)
);
...
const history = archiveNowPlayingToHistory(nearEnd ? "ended" : "skipped", {
  requestId: resolvedPriorRequestId,
  title: asString(prior.title || priorEntry?.song?.title || ""),
  artist: asString(prior.artist || priorEntry?.song?.artist || "")
});
```

This is doing much more than "remove from queue when something changes." It is interpreting ambiguous player transitions into business-meaningful events.

### Tail reconciliation

`reconcileAppleQueueEntriesAgainstDriverTail()` asks:

- which queue entries should still exist in the player-exposed tail?
- which entries have disappeared from the browser tail?
- which entries are current and therefore should be preserved?
- which entries have gone missing for long enough that we should conclude they were consumed or manually removed?

This is why the queue can stay sane even when the external player is not a pure server-controlled queue.

## 7. Player Actions Are The Bridge Between Intent And Browser Control

The mod does not directly mutate the browser player inline from every handler. It enqueues player actions.

That is the right design because:

- chat commands and UI actions can arrive faster than browser automation should act
- the browser driver may be temporarily unavailable
- actions need acknowledgements, retries, or clean dropping

You can think of player actions as the controlled write lane for browser playback mutation.

Examples:

- `enqueue_song`
- `force_play_song`
- `skip_next`

When you change queue behavior, always ask:

Am I editing business state, or the player action lane?

Those are not the same layer.

## 8. Local UI Is Not Chat Simulation Anymore

The Requests tab used to read like a "pretend viewer command simulator." It is now intentionally a local broadcaster/admin control panel.

That distinction matters:

- local UI should optimize for operator efficiency
- chat commands should optimize for permission handling and user identity semantics

The local Requests tab now strips out role cosplay and focuses on broadcaster-facing operations:

- local queue control
- queue maintenance
- current playback control
- history inspection and clearing

That keeps the UI honest. It is not a fake Twitch client. It is a server-local control surface.

## 9. Chat Commands: What Actually Happens

The mod now supports the behavior that operators actually want:

### `!skip`

- broadcaster/mod can skip the current song, even if that song did not originate from the queue
- ordinary users can only skip their own queued/current request

### `!remove <fuzzy text>`

- broadcaster/mod can remove any matching queued request
- ordinary users can only remove their own
- matching understands case insensitivity, partial tokens, missing order, and fuzzy title/artist combinations

### `!volume <1-100>`

- broadcaster/mod only
- maps through the UI-configured actual output range instead of naively using the raw number as final output

The design principle is simple:

Permissions live in the command path. The local UI should not need to pretend to be different Twitch roles to be useful.

## 10. History Is A First-Class Output, Not Just Debug Noise

Playback history is important because it preserves:

- what was queued
- what actually played
- whether it ended, skipped, or was dispatched to play next
- who requested it
- runtime context

The UI now pages history at 25 entries per page and supports true history clearing.

In `ui/app.js`:

```js
const historyPageSize = 25;
...
const history = Array.isArray(snapshot?.playHistory) ? [...snapshot.playHistory] : [];
history.sort((a, b) => Number(b?.endedAt || 0) - Number(a?.endedAt || 0));
const pageCount = Math.max(1, Math.ceil(history.length / historyPageSize));
const visible = history.slice(pageStart, pageStart + historyPageSize);
```

This is the right design because the operator wants the recent story first, not an endlessly growing wall of rows.

And history clearing is a real admin action:

```text
POST /mods/music-request-engine/admin_history_clear
```

That means the operator can intentionally reset the record, not just hide it in the browser.

## 11. Overlay Token Stability

The overlay link should not silently change every restart. That would be miserable in OBS workflows.

So the mod now persists the overlay access token outside scrubbed config state in:

```text
mods/song-request-mod/.runtime/overlay-access-token.json
```

The point of this design is very practical:

- the overlay URL remains stable across restarts
- the user only rotates it intentionally
- wiping the main config does not accidentally break OBS

This is a perfect example of choosing persistence boundaries based on operator pain, not arbitrary purity.

## 12. Browser Player Mirror: Reflection, Not Reskin

The mod UI now contains a browser player mirror panel that reflects the real browser player state in the server/mod visual language.

That distinction matters:

- it does not try to imitate Apple Music markup
- it does not pretend to own Apple’s internal UI
- it reflects the functionality and observable state the browser driver can expose

This is the correct product choice because it keeps the mod consistent with the server while still giving the operator the useful player truth:

- current song
- playback status
- progress
- artwork when available
- requester ownership when it is one of our queued songs
- visible Up Next context

## 13. Widget Reliability: Announcements Only Count After Success

One of the subtle bugs that was fixed in the StreamElements widget template is worth understanding because it shows the repo’s general reliability philosophy.

The old path could effectively mark a song as "already announced" before the bot send really succeeded. That meant a transient failure could swallow a song announcement forever.

The fix was conceptually simple:

- claim should happen only after successful send
- failure should release the right to retry

That kind of bug is extremely common in event announcers. The repo now handles it in the sane direction.

## 14. Safe-Internet And Redemption Sync In The Mod

The song-request mod also lives inside the broader Twitch safe-internet model.

It now prefers the same gateway-first design and no longer tries to own legacy direct widget-side Helix mutation as the primary model.

That means:

- the widget can send redemption metadata
- the mod can forward context
- the server safe-internet lane and System OAuth can own the eventual fulfill/refund flow

This keeps the mod removable. If it disappears, the server’s own integration model still makes sense.

## 15. Theme Docking And Embedded UI

The mod UI now accepts theme updates from the host via `postMessage` and maps them onto its own CSS variables. That is how it can feel like part of the server without being welded into the server.

That is an important architectural win.

The mod remains:

- hotloadable
- removable
- openable in its own tab
- theme-aware when embedded

This is the exact balance the platform wants.

## 16. How To Read `index.js` Without Going Cross-Eyed

When you open the mod root file, read it in this order:

1. state shape and config helpers
2. queue selection and dispatch-state helpers
3. browser-driver reconciliation helpers
4. player action enqueue/ack logic
5. admin/UI action handlers
6. chat command handlers
7. overlay/widget generation helpers
8. Twitch gateway/OAuth helpers

If you read it top-to-bottom linearly, you will feel like everything is connected to everything else. The file is large, but the logic actually clusters.

## 17. Common Mistakes When Editing This Mod

### Mistake 1: Treating browser-player state as authoritative for queue order

Wrong. Internal queue order remains authoritative for viewer requests. Browser state is reconciled against it.

### Mistake 2: Assuming a queue dispatch succeeded because an action was enqueued

Wrong. Dispatch success is only meaningful once browser observation or ack closes the loop.

### Mistake 3: Clearing or trimming external player tail too aggressively

Wrong. The streamer’s own playlist/favorites/autoplay content may live there.

### Mistake 4: Reintroducing direct widget-owned redemption mutation

Wrong. Keep that server-owned when the safe-internet lane is available.

### Mistake 5: Designing the local UI like a fake chat client

Wrong. The local UI is for the operator.

## 18. A Safe Change Strategy

If you need to change behavior here, use this sequence:

1. identify whether the change is queue-state, browser-driver, or player-action behavior
2. update the smallest helper cluster possible
3. add or extend an integration test
4. verify history, queue order, and browser-player reflection together
5. only then update widget/chat/UI copy

This mod is the kind of place where a shallow "small tweak" can create weird drift three systems away. Respect the state boundaries.

## 19. What To Read Next

After this chapter:

- re-read `05-mod-platform.md` to understand how this app still fits the general mod contract
- read `15-system-oauth-helix-and-safe-internet.md` if you are changing reward fulfillment/refund or gateway behavior
- use `17-maintainer-code-walkthroughs.md` when implementing a queue, widget, or browser-driver change
