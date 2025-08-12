// src/game/rooms.js
import { id } from "../utils/ids.js";
import { mem } from "../store/mem.js";
import rules from "./rules.js";
import { createRoom, startRound, dealToAll, allReady } from "./state.js";
import { Events } from "../net/events.js";
import { validateBoard, settlePairwiseDetailed } from "./scoring.js";

/** Create a new room and return its id to the creator */
export function createRoomHandler(io, socket) {
  const roomId = id(6);
  const room = createRoom(roomId);
  mem.rooms.set(roomId, room);
  socket.emit(Events.CREATE_ROOM, { roomId });
}

/** Join an existing room */
export function joinRoomHandler(io, socket, { roomId, name }) {
  const room = mem.rooms.get(roomId);
  if (!room) return socket.emit(Events.ERROR, { message: "Room not found" });
  if (room.players.size >= rules.players.max) {
    return socket.emit(Events.ERROR, { message: "Room full" });
  }

  socket.join(roomId);
  const userId = socket.user.sub;

  room.players.set(userId, {
    userId,
    name: name || ("Player-" + userId.slice(-4)),
    socketId: socket.id,
    board: { top: [], middle: [], bottom: [] },
    hand: [],
    discards: [],
    ready: false,
    currentDeal: [],
    score: 0,
  });

  emitRoomState(io, roomId);
}

/** Leave room */
export function leaveRoomHandler(io, socket, { roomId }) {
  const room = mem.rooms.get(roomId);
  if (!room) return;

  room.players.delete(socket.user.sub);
  socket.leave(roomId);

  if (room.players.size === 0) {
    mem.rooms.delete(roomId);
  } else {
    emitRoomState(io, roomId);
  }
}

/** Start a new hand/round: deal initial 5 to each player (same cards to everyone) */
export function startRoundHandler(io, socket, { roomId }) {
  const room = mem.rooms.get(roomId);
  if (!room) return socket.emit(Events.ERROR, { message: "Room not found" });

  if (room.players.size < rules.players.min) {
    return socket.emit(Events.ERROR, { message: "Need more players" });
  }

  startRound(room);
  io.to(roomId).emit(Events.START_ROUND, { round: room.round });

  // Send initial 5 privately to each player (the last 5 dealt into their hand)
  for (const p of room.players.values()) {
    const slice = p.hand.slice(-rules.deal.initialSetCount);
    p.currentDeal = slice;
    io.to(p.socketId).emit(Events.DEAL_BATCH, { cards: slice });
  }

  emitRoomState(io, roomId);
}

/* ---------------- Legacy single-action handlers (kept for manual testing) ---------------- */

export function placeHandler(io, socket, { roomId, placements }) {
  const room = mem.rooms.get(roomId);
  if (!room) return;
  const p = room.players.get(socket.user.sub);
  if (!p) return;

  for (const { row, card } of placements || []) {
    const idx = p.hand.indexOf(card);
    if (idx === -1) return socket.emit(Events.ERROR, { message: "Card not in your hand" });
    if (!p.board[row]) return socket.emit(Events.ERROR, { message: "Invalid row" });

    const limit =
      row === "top" ? rules.layout.top :
      row === "middle" ? rules.layout.middle : rules.layout.bottom;

    if (p.board[row].length >= limit) {
      return socket.emit(Events.ERROR, { message: `${row} full` });
    }

    p.hand.splice(idx, 1);
    p.board[row].push(card);
  }
  emitRoomState(io, roomId);
}

export function discardHandler(io, socket, { roomId, card }) {
  const room = mem.rooms.get(roomId);
  if (!room) return;
  const p = room.players.get(socket.user.sub);
  if (!p) return;

  const idx = p.hand.indexOf(card);
  if (idx === -1) return socket.emit(Events.ERROR, { message: "Card not in your hand" });
  p.hand.splice(idx, 1);
  p.discards.push(card);
  emitRoomState(io, roomId);
}

/* ---------------- Batched READY handler (apply placements+discard atomically) ---------------- */

export function readyHandler(io, socket, { roomId, placements = [], discard = null }) {
  const room = mem.rooms.get(roomId);
  if (!room) return;

  const p = room.players.get(socket.user.sub);
  if (!p) return;

  // Apply this player's batch before marking ready
  const ok = applyBatch(room, p, { placements, discard });
  if (!ok.success) {
    return socket.emit(Events.ERROR, { message: ok.message });
  }

  // Acknowledge to the acting player with the exact applied payload
  socket.emit(Events.ACTION_APPLIED, {
    placements,
    discard: ok.discard || null,
    board: p.board,
    hand: p.hand,
    discards: p.discards,
  });

  p.ready = true;

  if (allReady(room)) {
    // reset ready flags for next step
    for (const pl of room.players.values()) pl.ready = false;

    // More pineapple rounds to go?
    if (room.roundIndex < rules.deal.rounds) {
      dealToAll(room, rules.deal.cardsPerRound);
      room.phase = "round";
      for (const pl of room.players.values()) {
        const newly = pl.hand.slice(-rules.deal.cardsPerRound);
        pl.currentDeal = newly;
        io.to(pl.socketId).emit(Events.DEAL_BATCH, { cards: newly });
      }
      room.roundIndex += 1;
      emitRoomState(io, room.id);
      return;
    }

    // Reveal & score
    room.phase = "reveal";
    const playersArr = [...room.players.values()];

    // Public boards summary (with foul reason if any)
    const boards = playersArr.map(pl => {
      const v = validateBoard(pl.board);
      return {
        userId: pl.userId,
        name: pl.name,
        board: pl.board,
        valid: !v.fouled,
        reason: v.fouled ? v.reason : null
      };
    });

    // Pairwise detailed settle
    const totals = {};
    const pairwise = [];
    for (let i = 0; i < playersArr.length; i++) {
      for (let j = i + 1; j < playersArr.length; j++) {
        const A = playersArr[i], B = playersArr[j];
        const det = settlePairwiseDetailed(A.board, B.board);
        pairwise.push({
          aUserId: A.userId,
          bUserId: B.userId,
          a: det.a,
          b: det.b
        });

        if (playersArr.length === 2) {
          // Difference-based scoring: compute gross points for each, then use the difference
          const grossA = Math.max(det.a.lines.top, 0) + Math.max(det.a.lines.middle, 0) + Math.max(det.a.lines.bottom, 0)
            + (det.a.scoop > 0 ? det.a.scoop : 0) + det.a.royalties;
          const grossB = Math.max(det.b.lines.top, 0) + Math.max(det.b.lines.middle, 0) + Math.max(det.b.lines.bottom, 0)
            + (det.b.scoop > 0 ? det.b.scoop : 0) + det.b.royalties;
          const diff = grossA - grossB;
          totals[A.userId] = (totals[A.userId] || 0) + diff;
          totals[B.userId] = (totals[B.userId] || 0) - diff;
        } else {
          // Multi-player: sum zero-sum pairwise totals
          totals[A.userId] = (totals[A.userId] || 0) + det.a.total;
          totals[B.userId] = (totals[B.userId] || 0) + det.b.total;
        }
      }
    }

    // Update cumulative scores
    for (const pl of room.players.values()) {
      const delta = totals[pl.userId] || 0;
      pl.score = (pl.score || 0) + delta;
    }

    io.to(room.id).emit(Events.REVEAL, {
      boards,
      results: totals,      // per-hand delta
      pairwise,             // detailed per-pair breakdown
      round: room.round
    });

    emitRoomState(io, room.id);
  } else {
    emitRoomState(io, roomId);
  }
}

/* ---------------- Public state emitter (redacted) ---------------- */

export function emitRoomState(io, roomId) {
  const room = mem.rooms.get(roomId);
  if (!room) return;

  const publicPlayers = [...room.players.values()].map(p => ({
    userId: p.userId,
    name: p.name,
    placed: {
      top: p.board.top.length,
      middle: p.board.middle.length,
      bottom: p.board.bottom.length
    },
    score: p.score || 0,
    ready: p.ready
  }));

  io.to(roomId).emit(Events.ROOM_STATE, {
    roomId: room.id,
    phase: room.phase,
    round: room.round,
    players: publicPlayers
  });
}

/* ---------------- Internal helpers ---------------- */

/**
 * Apply a player's batch (placements + optional discard) with per-phase validation.
 * Does not broadcast; just mutates the player's state inside the room.
 */
function applyBatch(room, player, { placements, discard }) {
  // Work on clones to validate first
  const hand = [...player.hand];
  const board = {
    top: [...player.board.top],
    middle: [...player.board.middle],
    bottom: [...player.board.bottom]
  };

  const isInitial = room.phase === "initial-set";

  if (isInitial) {
    if (discard) {
      return { success: false, message: "No discard allowed during initial set." };
    }
    const required = rules.deal.initialSetCount;
    if ((placements?.length || 0) !== required) {
      return { success: false, message: `You must place exactly ${required} cards to start.` };
    }
    // Ensure all placements are from currentDeal
    const cd = new Set(player.currentDeal || []);
    for (const { card } of placements || []) {
      if (!cd.has(card)) {
        return { success: false, message: "Placements must come from the dealt cards." };
      }
    }
  } else {
    // pineapple round: must place exactly N and discard exactly 1 (auto if missing)
    const needPlace = rules.deal.placeCountPerRound; // typically 2
    if ((placements?.length || 0) !== needPlace) {
      return { success: false, message: `You must place exactly ${needPlace} cards this round.` };
    }

    // Derive discard automatically if not provided, from currentDeal minus placements
    const cd = player.currentDeal || [];
    const placedSet = new Set((placements || []).map(p => p.card));

    // Enforce placements must come from currentDeal
    for (const { card } of placements || []) {
      if (!cd.includes(card)) {
        return { success: false, message: "Placements must come from the 3 dealt cards." };
      }
    }

    let computedDiscard = discard;
    if (!computedDiscard) {
      const leftover = cd.filter(c => !placedSet.has(c));
      if (leftover.length !== 1) {
        return { success: false, message: "Could not infer discard; please try again." };
      }
      computedDiscard = leftover[0];
    }

    // Validate discard also comes from currentDeal and not among placements
    if (!cd.includes(computedDiscard) || placedSet.has(computedDiscard)) {
      return { success: false, message: "Invalid discard selection." };
    }
    discard = computedDiscard;
  }

  // Validate placements
  if (placements) {
    for (const { row, card } of placements) {
      const idx = hand.indexOf(card);
      if (idx === -1) return { success: false, message: `Card ${card} is not in your hand.` };
      if (!board[row]) return { success: false, message: `Invalid row ${row}.` };

      const limit =
        row === "top" ? rules.layout.top :
        row === "middle" ? rules.layout.middle : rules.layout.bottom;

      if (board[row].length >= limit) {
        return { success: false, message: `${row} is full.` };
      }

      hand.splice(idx, 1);
      board[row].push(card);
    }
  }

  // Validate & apply discard
  if (discard) {
    const di = hand.indexOf(discard);
    if (di === -1) return { success: false, message: `Discard ${discard} is not in your hand.` };
    hand.splice(di, 1);
  }

  // Commit
  player.hand = hand;
  player.board.top = board.top;
  player.board.middle = board.middle;
  player.board.bottom = board.bottom;
  if (discard) player.discards.push(discard);
  // Clear currentDeal once resolved
  player.currentDeal = [];

  return { success: true, discard };
}
