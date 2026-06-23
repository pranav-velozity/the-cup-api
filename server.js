import http from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import { clerkMiddleware } from "@clerk/express";

import adminRoutes from "./routes/admin.js";
import organizerRoutes from "./routes/organizer.js";
import playerRoutes from "./routes/player.js";
import publicRoutes from "./routes/public.js";
import scoreRoutes from "./routes/score.js";
import { initRealtime } from "./lib/realtime.js";
import { vapidPublicKey } from "./lib/push.js";

dotenv.config();

const app = express();

// Render runs behind a proxy — needed for correct IPs + rate limiting
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : "*",
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// Clerk auth context on every request (reads CLERK_SECRET_KEY from env).
// Individual routes decide whether auth is required.
app.use(clerkMiddleware());

app.get("/health", (req, res) =>
  res.json({ ok: true, service: "the-cup-api", version: "v2.7-adminview", time: new Date().toISOString() })
);

// Public client config (the VAPID public key the browser needs to subscribe).
app.get("/api/config", (req, res) =>
  res.json({ vapidPublicKey: vapidPublicKey() })
);

app.use("/api/admin", adminRoutes);
app.use("/api/organizer", organizerRoutes);
app.use("/api/player", playerRoutes);
app.use("/api/score", scoreRoutes);
app.use("/api", publicRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

const port = process.env.PORT || 3001;
const server = http.createServer(app);

// Attach Socket.IO for live board updates (one room per tournament code).
initRealtime(server, process.env.CORS_ORIGIN);

server.listen(port, () => console.log(`the-cup-api listening on :${port}`));
