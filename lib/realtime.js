// ============================================================
//  Realtime layer — Socket.IO rooms, one per tournament code.
//
//  Clients viewing a board join the room `t:<code>`. When any hole
//  is scored, the server recomputes the board and emits `board` to
//  that room, plus a lightweight `event` for the ticker. This is what
//  makes the tug bar, flash, and Last-9 strip update live.
// ============================================================

let io = null;

export function initRealtime(server, corsOrigin) {
  // Lazy import so the app still boots if socket.io isn't installed yet.
  return import("socket.io").then(({ Server }) => {
    io = new Server(server, {
      cors: {
        origin: corsOrigin ? corsOrigin.split(",") : "*",
        methods: ["GET", "POST"],
      },
    });

    io.on("connection", (socket) => {
      socket.on("join", (code) => {
        if (typeof code === "string" && code.trim()) {
          socket.join(`t:${code.trim()}`);
        }
      });
      socket.on("leave", (code) => {
        if (typeof code === "string") socket.leave(`t:${code.trim()}`);
      });
    });

    console.log("✓ realtime (socket.io) ready");
    return io;
  }).catch((e) => {
    console.warn("realtime disabled (socket.io not available):", e.message);
    return null;
  });
}

export function emitBoard(code, board) {
  if (io && code) io.to(`t:${code}`).emit("board", board);
}

export function emitEvent(code, event) {
  if (io && code) io.to(`t:${code}`).emit("event", event);
}
