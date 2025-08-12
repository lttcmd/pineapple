// src/game/deck.js
// Deterministic deck & shuffle using xmur3 + mulberry32 (stable, no 1.0 edge case)

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  };
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    // Strictly < 1.0 (no 1.0 edge case)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeDeck() {
  const suits = ["c", "d", "h", "s"];
  const ranks = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
  const d = [];
  for (const r of ranks) for (const s of suits) d.push(`${r}${s}`);
  return d;
}

export function shuffleDeterministic(deck, seedStr) {
  // Build a 32-bit seed from the full seed string
  const seedGen = xmur3(seedStr);
  const rng = mulberry32(seedGen());

  // Fisher–Yates
  for (let i = deck.length - 1; i > 0; i--) {
    // rng() is always in [0,1), so j is guaranteed 0..i
    const j = Math.floor(rng() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}
