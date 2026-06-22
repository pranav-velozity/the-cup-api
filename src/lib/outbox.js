// ============================================================
//  Offline outbox — the client half of the connectivity story.
//
//  Every hole tap is written to the screen instantly (optimistic) and
//  queued here in IndexedDB. A sync worker drains the queue to the
//  server's idempotent /api/score/batch whenever we're online. Because
//  each write carries (matchId, hole, result, clientTs) and the server
//  is last-writer-wins, replaying the queue can never corrupt the board.
// ============================================================

const DB = "toto-outbox";
const STORE = "writes";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function enqueue(write) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, "readwrite");
    // Collapse repeated taps on the same hole: keep one row per (match,hole).
    const id = `${write.matchId}:${write.hole}`;
    const rec = { id, ...write, queuedAt: Date.now() };
    const r = store.put(rec);
    r.onsuccess = () => resolve(rec);
    r.onerror = () => reject(r.error);
  });
}

export async function allWrites() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = tx(db, "readonly").getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

export async function removeWrites(ids) {
  if (!ids.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, "readwrite");
    for (const id of ids) store.delete(id);
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

export async function pendingCount() {
  return (await allWrites()).length;
}

// Drain the outbox to the server. `postBatch(writes)` should call
// PUT /api/score/batch and resolve on success. Returns flushed ids.
export async function flush(postBatch) {
  const rows = await allWrites();
  if (!rows.length) return [];
  const writes = rows.map(({ matchId, hole, result, clientTs }) => ({
    matchId, hole, result, clientTs,
  }));
  await postBatch(writes);          // throws if offline / failed -> rows stay queued
  const ids = rows.map((r) => r.id);
  await removeWrites(ids);
  return ids;
}
