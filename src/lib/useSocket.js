import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

// Subscribe to live board updates for a tournament code. The server
// emits "board" (full recomputed snapshot) and "event" (one ticker line)
// to room t:<code> whenever any hole is scored.
export function useLiveBoard(code, { onBoard, onEvent } = {}) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!code || !BASE) return;
    const socket = io(BASE, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join", code);
    });
    socket.on("disconnect", () => setConnected(false));
    if (onBoard) socket.on("board", onBoard);
    if (onEvent) socket.on("event", onEvent);

    return () => {
      socket.emit("leave", code);
      socket.off("board");
      socket.off("event");
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return { connected };
}
