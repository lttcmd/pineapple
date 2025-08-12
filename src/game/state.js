import rules from "./rules.js";
import { makeDeck, shuffleDeterministic } from "./deck.js";

export function createRoom(roomId) {
  return {
    id: roomId,
    players: new Map(), // userId -> { userId, name, socketId, board, hand, discards, ready }
    round: 0,
    seed: null,
    phase: "lobby", // lobby | initial-set | round | reveal
    sharedDeck: [],
    roundIndex: 0
  };
}

export function startRound(room) {
  room.round += 1;
  room.phase = "initial-set";
  room.roundIndex = 0;
  room.seed = `${room.id}:${room.round}:${Date.now()}`;
  room.sharedDeck = shuffleDeterministic(makeDeck(), room.seed);

  for (const p of room.players.values()) {
    p.board = { top: [], middle: [], bottom: [] };
    p.hand = [];
    p.discards = [];
    p.ready = false;
    p.currentDeal = [];
  }
  dealToAll(room, rules.deal.initialSetCount);
}

export function dealToAll(room, nCards) {
  for (let i = 0; i < nCards; i++) {
    const card = room.sharedDeck.pop();
    for (const p of room.players.values()) p.hand.push(card);
  }
}

export function allReady(room) {
  return [...room.players.values()].every(p => p.ready);
}
