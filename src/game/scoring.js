// src/game/scoring.js
// Full OFC Pineapple scoring: fouls, row wins, scoop bonus, royalties.

import rules from "./rules.js";
import { rank5, rankTop3, compare5, compareTop3, isRoyalFlush } from "./evaluator.js";

const RANKS = "23456789TJQKA";
const RVAL = Object.fromEntries([...RANKS].map((r, i) => [r, i]));

/* ---------- helpers ---------- */

function rankCounts(cards) {
  const m = new Map();
  for (const c of cards) {
    const r = c[0];
    m.set(r, (m.get(r) || 0) + 1);
  }
  return m;
}

/** From a 5-card hand, compute the best possible 3-card "top" (trips > pair > high). */
function bestTopFromFive(cards) {
  const counts = rankCounts(cards);

  // Trips possible?
  for (let i = RANKS.length - 1; i >= 0; i--) {
    const r = RANKS[i];
    if ((counts.get(r) || 0) >= 3) {
      // build any 3 with that rank (suits irrelevant to rankTop3)
      return rankTop3([r + "s", r + "h", r + "d"]);
    }
  }

  // Best pair + best kicker
  let pairRank = null;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    const r = RANKS[i];
    if ((counts.get(r) || 0) >= 2) { pairRank = r; break; }
  }
  if (pairRank) {
    for (let i = RANKS.length - 1; i >= 0; i--) {
      const k = RANKS[i];
      if (k !== pairRank && (counts.get(k) || 0) >= 1) {
        return rankTop3([pairRank + "s", pairRank + "h", k + "d"]);
      }
    }
  }

  // Otherwise 3 highest distinct ranks
  const uniq = [...new Set(cards.map(c => c[0]))]
    .sort((a, b) => RVAL[b] - RVAL[a])
    .slice(0, 3);
  return rankTop3([uniq[0] + "s", uniq[1] + "h", uniq[2] + "d"]);
}

/* ---------- validation (fouls) ---------- */

export function validateBoard(board) {
  const { top, middle, bottom } = board;
  if (top.length !== 3 || middle.length !== 5 || bottom.length !== 5) {
    return { fouled: true, reason: "wrong counts" };
  }

  const m5 = rank5(middle);
  const b5 = rank5(bottom);

  // bottom must be >= middle
  if (compare5(b5, m5) < 0) return { fouled: true, reason: "bottom < middle" };

  // top must be <= best-top-from-middle (prevents top outclassing middle)
  const t3 = rankTop3(top);
  const midBestTop = bestTopFromFive(middle);
  if (compareTop3(t3, midBestTop) > 0) {
    return { fouled: true, reason: "top > middle" };
  }

  return { fouled: false };
}

/* ---------- royalties ---------- */

function royaltiesFive(cards, lineKey /* 'middle' | 'bottom' */) {
  const table = rules.royalties?.[lineKey] || {};
  const r = rank5(cards);

  if (r.cat === 8) { // straight flush (maybe royal)
    return isRoyalFlush(cards)
      ? (table.royal_flush || 0)
      : (table.straight_flush || 0);
  }
  if (r.cat === 7) return table.quads || 0;
  if (r.cat === 6) return table.full_house || 0;
  if (r.cat === 5) return table.flush || 0;
  if (r.cat === 4) return table.straight || 0;
  if (r.cat === 3) return table.trips || 0; // some rules pay trips in middle

  return 0;
}

function royaltiesTop(cards) {
  const tbl = rules.royalties?.top || {};
  const r = rankTop3(cards);

  if (r.cat === 2) {
    // trips e.g. 'QQQ'
    const counts = rankCounts(cards);
    const tripRank = [...counts.entries()].find(([_, c]) => c === 3)[0];
    const key = tripRank + tripRank + tripRank;
    return (tbl.trips && tbl.trips[key]) || 0;
  }

  if (r.cat === 1) {
    // pair e.g. 'QQ'
    const counts = rankCounts(cards);
    const pairRank = [...counts.entries()].find(([_, c]) => c === 2)[0];
    const key = pairRank + pairRank;
    return (tbl.pairs && tbl.pairs[key]) || 0;
  }

  return 0;
}

function totalRoyalties(board) {
  return (
    (royaltiesTop(board.top) || 0) +
    (royaltiesFive(board.middle, "middle") || 0) +
    (royaltiesFive(board.bottom, "bottom") || 0)
  );
}

/* ---------- pairwise settle ---------- */
/**
 * Returns integer points from A's perspective (A - B):
 *  - Row wins: +rowWin / 0 / -rowWin
 *  - Scoop bonus: +scoopBonus if A sweeps 3-0 (or - if B sweeps)
 *  - Royalties: (A royalties - B royalties)
 *  - Fouls:
 *      • If both foul → 0
 *      • If A fouls, B not:  -(foulPenalty) + (B royalties)
 *      • If B fouls, A not:  +(foulPenalty) + (A royalties)
 */
export function settlePairwise(aBoard, bBoard) {
  const rowWin = rules.scoring?.rowWin ?? 1;
  const scoopBonus = rules.scoring?.scoopBonus ?? 3;
  const foulPenalty = rules.scoring?.foulPenalty ?? 6;
  const pushesAllowed = rules.scoring?.pushesAllowed ?? true;

  const av = validateBoard(aBoard);
  const bv = validateBoard(bBoard);

  // Both foul
  if (av.fouled && bv.fouled) return 0;

  // One fouls: fouler pays, non-fouler keeps royalties
  if (av.fouled && !bv.fouled) {
    const bRoy = totalRoyalties(bBoard);
    return -foulPenalty + bRoy;
  }
  if (!av.fouled && bv.fouled) {
    const aRoy = totalRoyalties(aBoard);
    return foulPenalty + aRoy;
  }

  // Neither foul: compare rows
  let pts = 0;

  // Top (3)
  const tCmp = compareTop3(rankTop3(aBoard.top), rankTop3(bBoard.top));
  if (tCmp > 0) pts += rowWin; else if (tCmp < 0) pts -= rowWin; else if (!pushesAllowed) pts += 0;

  // Middle (5)
  const mCmp = compare5(rank5(aBoard.middle), rank5(bBoard.middle));
  if (mCmp > 0) pts += rowWin; else if (mCmp < 0) pts -= rowWin; else if (!pushesAllowed) pts += 0;

  // Bottom (5)
  const bCmp = compare5(rank5(aBoard.bottom), rank5(bBoard.bottom));
  if (bCmp > 0) pts += rowWin; else if (bCmp < 0) pts -= rowWin; else if (!pushesAllowed) pts += 0;

  // Scoop?
  const wins = [tCmp, mCmp, bCmp].map(x => (x > 0 ? 1 : x < 0 ? -1 : 0));
  if (wins.every(w => w === 1)) pts += (rules.scoring?.scoopBonus ?? 3);
  if (wins.every(w => w === -1)) pts -= (rules.scoring?.scoopBonus ?? 3);

  // Royalties (net)
  pts += (totalRoyalties(aBoard) - totalRoyalties(bBoard));

  return pts;
}
export function settlePairwiseDetailed(aBoard, bBoard) {
  const rowWin = rules.scoring?.rowWin ?? 1;
  const scoopBonus = rules.scoring?.scoopBonus ?? 3;
  const foulPenalty = rules.scoring?.foulPenalty ?? 6;

  const av = validateBoard(aBoard);
  const bv = validateBoard(bBoard);

  const detail = {
    a: { total: 0, lines: { top: 0, middle: 0, bottom: 0 }, scoop: 0, royalties: 0, royaltiesBreakdown: { top: 0, middle: 0, bottom: 0 }, foul: av.fouled },
    b: { total: 0, lines: { top: 0, middle: 0, bottom: 0 }, scoop: 0, royalties: 0, royaltiesBreakdown: { top: 0, middle: 0, bottom: 0 }, foul: bv.fouled }
  };

  // Both foul → 0
  if (av.fouled && bv.fouled) return detail;

  // One fouls: fouler pays, non-fouler keeps royalties
  if (av.fouled && !bv.fouled) {
    const bRoyTop = royaltiesTop(bBoard.top);
    const bRoyMid = royaltiesFive(bBoard.middle, "middle");
    const bRoyBot = royaltiesFive(bBoard.bottom, "bottom");
    const bRoy = bRoyTop + bRoyMid + bRoyBot;
    detail.b.royalties = bRoy;
    detail.b.royaltiesBreakdown = { top: bRoyTop, middle: bRoyMid, bottom: bRoyBot };
    detail.a.total = -foulPenalty + 0;      // A pays
    detail.b.total = +foulPenalty + bRoy;   // B gets penalty + royalties
    return detail;
  }
  if (!av.fouled && bv.fouled) {
    const aRoyTop = royaltiesTop(aBoard.top);
    const aRoyMid = royaltiesFive(aBoard.middle, "middle");
    const aRoyBot = royaltiesFive(aBoard.bottom, "bottom");
    const aRoy = aRoyTop + aRoyMid + aRoyBot;
    detail.a.royalties = aRoy;
    detail.a.royaltiesBreakdown = { top: aRoyTop, middle: aRoyMid, bottom: aRoyBot };
    detail.a.total = +foulPenalty + aRoy;
    detail.b.total = -foulPenalty + 0;
    return detail;
  }

  // Neither foul: compare rows
  const tCmp = compareTop3(rankTop3(aBoard.top),    rankTop3(bBoard.top));
  const mCmp = compare5   (rank5   (aBoard.middle), rank5   (bBoard.middle));
  const bCmp = compare5   (rank5   (aBoard.bottom), rank5   (bBoard.bottom));

  if (tCmp > 0) { detail.a.lines.top    = +rowWin; detail.b.lines.top    = -rowWin; }
  else if (tCmp < 0) { detail.a.lines.top    = -rowWin; detail.b.lines.top    = +rowWin; }

  if (mCmp > 0) { detail.a.lines.middle = +rowWin; detail.b.lines.middle = -rowWin; }
  else if (mCmp < 0) { detail.a.lines.middle = -rowWin; detail.b.lines.middle = +rowWin; }

  if (bCmp > 0) { detail.a.lines.bottom = +rowWin; detail.b.lines.bottom = -rowWin; }
  else if (bCmp < 0) { detail.a.lines.bottom = -rowWin; detail.b.lines.bottom = +rowWin; }

  // Scoop bonus
  const winsA = [tCmp, mCmp, bCmp].every(x => x > 0);
  const winsB = [tCmp, mCmp, bCmp].every(x => x < 0);
  if (winsA) { detail.a.scoop = +scoopBonus; detail.b.scoop = 0; }
  if (winsB) { detail.b.scoop = +scoopBonus; detail.a.scoop = 0; }

  // Royalties per row
  const aRoyTop = royaltiesTop(aBoard.top);
  const aRoyMid = royaltiesFive(aBoard.middle, "middle");
  const aRoyBot = royaltiesFive(aBoard.bottom, "bottom");
  const bRoyTop = royaltiesTop(bBoard.top);
  const bRoyMid = royaltiesFive(bBoard.middle, "middle");
  const bRoyBot = royaltiesFive(bBoard.bottom, "bottom");
  detail.a.royaltiesBreakdown = { top: aRoyTop, middle: aRoyMid, bottom: aRoyBot };
  detail.b.royaltiesBreakdown = { top: bRoyTop, middle: bRoyMid, bottom: bRoyBot };
  detail.a.royalties = aRoyTop + aRoyMid + aRoyBot;
  detail.b.royalties = bRoyTop + bRoyMid + bRoyBot;

  // Totals
  const sumLinesA = detail.a.lines.top + detail.a.lines.middle + detail.a.lines.bottom;
  const sumLinesB = detail.b.lines.top + detail.b.lines.middle + detail.b.lines.bottom;

  detail.a.total = sumLinesA + detail.a.scoop + (detail.a.royalties - detail.b.royalties);
  detail.b.total = sumLinesB + detail.b.scoop + (detail.b.royalties - detail.a.royalties);

  return detail;
}