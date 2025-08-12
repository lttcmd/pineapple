export const mem = {
  users: new Map(),  // phone -> { userId, phone }
  rooms: new Map(),  // roomId -> room object
  players: new Map(), // userId -> { userId, phone, name, stats }
};
