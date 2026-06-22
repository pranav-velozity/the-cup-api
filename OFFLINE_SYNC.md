# Offline-safe scoring — the contract

Golf courses have bad signal. Scoring must never block on the network and
must never lose a tap. The design that makes this safe:

**A hole result is an idempotent, last-writer-wins fact keyed by `(match_id, hole).`**
"Hole 7 of match X → A" is the same statement however many times it's sent,
in whatever order it arrives. That single property is the whole trick.

## Server (built — in this repo)

- `PUT /api/score/matches/:matchId/holes/:hole`
  body: `{ "result": "A" | "B" | "T" | null, "clientTs": "<ISO8601>" }`
  Upserts on `(match_id, hole)`. The `ON CONFLICT` only overwrites when the
  incoming `clientTs >= stored client_ts`, so a stale queued write can't clobber
  a newer value. Returns the recomputed board. Broadcasts `board` + `event`
  over Socket.IO to room `t:<code>`.

- `PUT /api/score/batch`
  body: `{ "writes": [ { "matchId", "hole", "result", "clientTs" }, ... ] }`
  The outbox-flush endpoint (max 200). Per-write permission check; returns
  `{ accepted, rejected, boards }` and broadcasts each touched board once.

- `GET /api/score/:code/board` — authoritative snapshot the board reads on load.

Permission: organizer may score any match in their tournament; a player may
score only a match their `roster_entry_id` is on (either side / either partner).

## Client (to build with the frontend)

1. **Optimistic UI** — tapping a winner updates local React state immediately
   and advances to the next hole. The user never waits for the server.
2. **Outbox in IndexedDB** — each tap enqueues
   `{ id, matchId, hole, result, clientTs: new Date().toISOString() }`.
   IndexedDB survives reloads, backgrounding, and app kills.
3. **Sync worker** — drains the outbox to `PUT /api/score/batch` whenever
   `navigator.onLine` and on a `reconnect`/`online` event, with exponential
   backoff. On success, remove those rows from the outbox.
4. **Live reads** — connect Socket.IO, `emit("join", code)`, and replace board
   state on each `board` event. While offline, keep showing the last snapshot;
   reconcile when the next `board` arrives.

Because every write carries its own `clientTs` and is keyed by `(match, hole)`,
replaying the outbox is always safe — duplicates and out-of-order delivery
converge to the same board. Last-writer-wins resolves the rare case where the
two players in a singles match score the same hole near-simultaneously.

## Why not a generic sync library
The data is tiny and the conflict model is trivially simple (one cell, one
winner, newest tap wins). A hand-rolled outbox is a few dozen lines, has no
dependencies, and is easy to reason about on a flaky network.
