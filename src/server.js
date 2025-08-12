// src/server.js
import express from "express";
import http from "http";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { config } from "./config/env.js";
import { authRoutes } from "./auth/routes.js";
import { attachIO } from "./net/io.js";

const app = express();

// --- middleware
app.use(cors());
app.use(express.json());

// --- REST routes
app.use(authRoutes);

// --- static web (serve /src/web/*)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "web");
app.use(express.static(webRoot));

// optional: health
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// landing → login screen
app.get("/", (_req, res) => {
  res.redirect("/auth/phone.html");
});

const server = http.createServer(app);

// --- socket.io
attachIO(server);

// --- start
server.listen(config.port, () => {
  console.log(`Server listening on :${config.port}`);
  console.log(`Open http://localhost:${config.port}/  → redirects to /auth/phone.html`);
});
