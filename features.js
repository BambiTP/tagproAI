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

module.exports = { features, SIZE, R, S, CH, NS };
