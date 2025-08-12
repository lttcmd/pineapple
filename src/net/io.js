import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { config } from "../config/env.js";
import { Events } from "./events.js";
import {
  createRoomHandler, joinRoomHandler, leaveRoomHandler,
  startRoundHandler, placeHandler, discardHandler, readyHandler
} from "../game/rooms.js";

export function attachIO(httpServer) {
  const io = new Server(httpServer, { cors: { origin: "*" } });

  // Expect { auth: { token } } from client
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("auth required"));
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      socket.user = payload; // { sub, phone }
      next();
    } catch {
      next(new Error("invalid token"));
    }
  });

  io.on("connection", (socket) => {
    socket.emit(Events.AUTH_OK, { userId: socket.user.sub });

    socket.on(Events.CREATE_ROOM, () => createRoomHandler(io, socket));
    socket.on(Events.JOIN_ROOM, (p) => joinRoomHandler(io, socket, p));
    socket.on(Events.LEAVE_ROOM, (p) => leaveRoomHandler(io, socket, p));
    socket.on(Events.START_ROUND, (p) => startRoundHandler(io, socket, p));

    socket.on(Events.PLACE, (p) => placeHandler(io, socket, p));
    socket.on(Events.DISCARD, (p) => discardHandler(io, socket, p));
    socket.on(Events.READY, (p) => readyHandler(io, socket, p));
  });

  return io;
}
