// src/game/evaluator.js
// Proper 5-card evaluator + 3-card (top) evaluator with correct comparisons.

const RANKS = "23456789TJQKA";
const RVAL = Object.fromEntries([...RANKS].map((r, i) => [r, i]));

/* ---------- utilities ---------- */

function countByRank(cards) {
  const m = new Map();
  for (const c of cards) {
    const r = c[0];
    m.set(r, (m.get(r) || 0) + 1);
  }
  // Array of [rankChar, count], sorted by (count desc, rank desc)
  return [...m.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return RVAL[b[0]] - RVAL[a[0]];
  });
}

function isFlush(cards) {
  const s = cards.map(c => c[1]);
  return s.every(x => x === s[0]);
}

function isStraight(cards) {
  const vals = [...new Set(cards.map(c => RVAL[c[0]]))].sort((a, b) => a - b);
  if (vals.length !== 5) return { ok: false };

  // Normal straight
  let ok = true;
  for (let i = 1; i < 5; i++) if (vals[i] !== vals[i - 1] + 1) { ok = false; break; }
  if (ok) return { ok: true, high: vals[4] };

  // Wheel A-2-3-4-5  (A treated low)
  const wheel = [0, 1, 2, 3, 12];
  const isWheel = vals.every((v, i) => v === wheel[i]);
  if (isWheel) return { ok: true, high: 3 }; // 5-high straight (index of '5' = 3)
  return { ok: false };
}

export function isRoyalFlush(cards) {
  if (!isFlush(cards)) return false;
  const st = isStraight(cards);
  if (!st.ok) return false;
  const ranks = new Set(cards.map(c => c[0]));
  return ["T", "J", "Q", "K", "A"].every(r => ranks.has(r));
}

/* ---------- 5-card evaluator ---------- */
/**
 * Returns:
 *  - cat: 0..8 (0=high,1=pair,2=two pair,3=trips,4=straight,5=flush,6=full house,7=quads,8=straight flush)
 *  - key: number[] tiebreakers (higher wins lexicographically)
 */
export function rank5(cards) {
  if (cards.length !== 5) throw new Error("rank5 expects 5 cards");

  const flush = isFlush(cards);
  const st = isStraight(cards);
  if (flush && st.ok) return { cat: 8, key: [st.high] };

  const counts = countByRank(cards); // sorted by count desc, rank desc
  const pattern = counts.map(([, c]) => c).join("-");

  if (pattern === "4-1") { // quads
    const [qr] = counts[0], [k] = counts[1];
    return { cat: 7, key: [RVAL[qr], RVAL[k]] };
  }
  if (pattern === "3-2") { // full house
    const [tr] = counts[0], [pr] = counts[1];
    return { cat: 6, key: [RVAL[tr], RVAL[pr]] };
  }
  if (flush) {
    const vals = cards.map(c => RVAL[c[0]]).sort((a, b) => b - a);
    return { cat: 5, key: vals };
  }
  if (st.ok) return { cat: 4, key: [st.high] };

  if (pattern === "3-1-1") { // trips
    const [tr] = counts[0];
    const kick = [counts[1][0], counts[2][0]].map(r => RVAL[r]).sort((a, b) => b - a);
    return { cat: 3, key: [RVAL[tr], ...kick] };
  }
  if (pattern === "2-2-1") { // two pair
    const p1 = RVAL[counts[0][0]], p2 = RVAL[counts[1][0]];
    const hi = Math.max(p1, p2), lo = Math.min(p1, p2);
    const k = RVAL[counts[2][0]];
    return { cat: 2, key: [hi, lo, k] };
  }
  if (pattern === "2-1-1-1") { // one pair
    const [pr] = counts[0];
    const kick = [counts[1][0], counts[2][0], counts[3][0]].map(r => RVAL[r]).sort((a, b) => b - a);
    return { cat: 1, key: [RVAL[pr], ...kick] };
  }

  // high card
  const vals = cards.map(c => RVAL[c[0]]).sort((a, b) => b - a);
  return { cat: 0, key: vals };
}

export function compare5(a, b) {
  if (a.cat !== b.cat) return a.cat - b.cat;
  const n = Math.max(a.key.length, b.key.length);
  for (let i = 0; i < n; i++) {
    const av = a.key[i] ?? -1, bv = b.key[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/* ---------- 3-card (top) evaluator ---------- */
/** trips > pair > high; tiebreakers by ranks descending */
export function rankTop3(cards) {
  if (cards.length !== 3) throw new Error("rankTop3 expects 3 cards");
  const counts = countByRank(cards);
  const pattern = counts.map(([, c]) => c).join("-");

  if (pattern === "3") return { cat: 2, key: [RVAL[counts[0][0]]] }; // trips
  if (pattern === "2-1") {
    const pair = RVAL[counts[0][0]];
    const kick = RVAL[counts[1][0]];
    return { cat: 1, key: [pair, kick] };
  }
  const vals = cards.map(c => RVAL[c[0]]).sort((a, b) => b - a);
  return { cat: 0, key: vals }; // high
}

export function compareTop3(a, b) {
  if (a.cat !== b.cat) return a.cat - b.cat;
  const n = Math.max(a.key.length, b.key.length);
  for (let i = 0; i < n; i++) {
    const av = a.key[i] ?? -1, bv = b.key[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}
