// features.js - what the network sees at a decision: a 9x9-tile window around the ball and a few
// numbers. Shared by gen.js (recording), train.js and the bots that use the network, so all agree.
const N = require('./nav');

const R = 4, S = 2 * R + 1;          // window radius and side, in tiles
const CH = 5;                        // wall, spike, boost, other hazard, route distance
const NS = 12;                       // numbers after the window
const SIZE = CH * S * S + NS;
const MS = 2.5;                      // top speed on plain floor, m/s

function channels(t) {
  const v = typeof t === 'string' ? parseFloat(t) : t, f = Math.floor(v);
  return [
    v === 0 || v === 1 ? 1 : f === 1 ? 0.5 : 0,                 // wall (diagonals half)
    v === 7 ? 1 : 0,                                             // spike
    f === 5 || f === 14 || f === 15 ? 1 : 0,                     // boost
    f === 9 || f === 10 || f === 13 || v === 22 || f === 24 || f === 25 ? 1 : 0, // gate, bomb, portal, well
  ];
}

function features(task, x, y, vx, vy, out = new Float32Array(SIZE)) {
  const F = task.F, T = F.tiles, TL = N.TILE;
  const tx = Math.round(x / TL), ty = Math.round(y / TL);
  const d0 = N.fieldAt(F, x, y), dRef = isFinite(d0) ? d0 : 0;
  for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) {
    const a = tx + dx, b = ty + dy, inside = a >= 0 && b >= 0 && a < F.W && b < F.H;
    const c = inside ? channels(T[a][b]) : [1, 0, 0, 0];
    const k = (dx + R) * S + (dy + R);
    for (let ch = 0; ch < 4; ch++) out[ch * S * S + k] = c[ch];
    // route distance to the goal relative to the ball's, in window-radii; walls and dead ends high
    const d = inside ? F.d[a * F.H + b] : Infinity;
    out[4 * S * S + k] = isFinite(d) ? Math.max(-2, Math.min(2, (d - dRef) / (R * TL))) : 2;
  }
  const o = CH * S * S, gx = task.goal.x - x, gy = task.goal.y - y, gd = Math.hypot(gx, gy) || 1;
  const [ux, uy] = N.pathDir(F, x, y);
  const est = (task.touch ? N.heuristicTouch : N.heuristic)(F, task.goal, x, y, vx, vy);
  out[o] = vx / MS; out[o + 1] = vy / MS;
  out[o + 2] = x / TL - tx; out[o + 3] = y / TL - ty;               // where in its tile the ball is
  out[o + 4] = gx / gd; out[o + 5] = gy / gd;                       // straight-line direction to goal
  out[o + 6] = Math.min(gd, 12) / 4;                                // straight-line distance (capped)
  out[o + 7] = ux; out[o + 8] = uy;                                 // direction along the route
  out[o + 9] = isFinite(d0) ? Math.min(d0, 20) / 4 : 5;             // route distance (capped)
  out[o + 10] = Math.min(est, 1200) / 60 / 4;                       // hand-written time estimate
  out[o + 11] = N.clearLine(F, x, y, task.goal.x, task.goal.y) ? 1 : 0;
  return out;
}

// ---------- version 2: a boost-aware view (network run 5 on) ----------
// Run 4 was taught boost routes but its view only had the boost-blind route map, so nothing it could see
// explained them. Version 2 adds, from the route map that treats live boosts as shortcuts (nav.boostField,
// with the tiles as they are now): a sixth window channel of boost-aware route distance, and four numbers:
// boost-aware route direction (2), boost-aware route distance and boost-aware time estimate. The boost
// channel marks only live boosts the ball's team can use (a used boost stops counting until it returns).
const CH2 = 6, NS2 = 16, SIZE2 = CH2 * S * S + NS2;
const live = (t) => { const v = typeof t === 'string' ? parseFloat(t) : t; return v === 5 || v === 14; }; // red ball
function features2(task, x, y, vx, vy, tiles, out = new Float32Array(SIZE2)) {
  const v1 = features(task, x, y, vx, vy), o1 = CH * S * S, cells = S * S;
  out.set(v1.subarray(0, o1), 0);
  const FB = N.boostField(task, tiles), TL = N.TILE;
  const tx = Math.round(x / TL), ty = Math.round(y / TL);
  const d0 = N.fieldAt(FB, x, y), dRef = isFinite(d0) ? d0 : 0;
  for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) {
    const a = tx + dx, b = ty + dy, inside = a >= 0 && b >= 0 && a < FB.W && b < FB.H, k = (dx + R) * S + (dy + R);
    out[2 * cells + k] = inside && live(tiles[a][b]) ? 1 : 0;                     // live boosts only
    const d = inside ? FB.d[a * FB.H + b] : Infinity;
    out[5 * cells + k] = isFinite(d) ? Math.max(-2, Math.min(2, (d - dRef) / (R * TL))) : 2;
  }
  const o = CH2 * cells;
  out.set(v1.subarray(o1, o1 + NS), o);                                          // the 12 version-1 numbers
  let [ux, uy] = N.pathDir(FB, x, y);
  if (!ux && !uy) [ux, uy] = downhill(FB, tx, ty); // the ball's own tile tied with the best one ahead
  const est = N.heuristicTouch(FB, task.goal, x, y, vx, vy);
  out[o + 12] = ux; out[o + 13] = uy;
  out[o + 14] = isFinite(d0) ? Math.min(d0, 20) / 4 : 5;
  out[o + 15] = Math.min(est, 1200) / 60 / 4;                                   // boost-aware time estimate
  return out;
}
// direction to the neighbouring tile closest to the goal
function downhill(F, tx, ty) {
  let best = Infinity, dx = 0, dy = 0;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    if (!a && !b) continue;
    const x = tx + a, y = ty + b; if (x < 0 || y < 0 || x >= F.W || y >= F.H) continue;
    const v = F.d[x * F.H + y] + (a && b ? Math.SQRT2 : 1) * N.TILE;
    if (v < best) { best = v; dx = a; dy = b; }
  }
  const L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L];
}
// what train.js needs to know about each version's layout
const LAYOUT = {
  1: { SIZE, CH, NS, est: SIZE - 2, vectors: [0, 2, 4, 7] },
  2: { SIZE: SIZE2, CH: CH2, NS: NS2, est: SIZE2 - 1, vectors: [0, 2, 4, 7, 12] },
};

module.exports = { features, features2, SIZE, SIZE2, R, S, CH, CH2, NS, NS2, LAYOUT };
