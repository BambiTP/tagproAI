// nav.js - "arrive and stop at a point": the task, a time-to-go heuristic, a hand-written
// baseline, and a search controller that plans in the real engine.
const { Sim, getMap, mapKeys, setKeys, ACTIONS, PH } = require('./sim');

const TILE = PH.TILE, DT = 1 / 60, ACC = 0.025, MS = 2.5, DAMP = 1 - DT * 0.5;
const ARRIVE_R = 0.12;   // m (12 px) from the goal
const ARRIVE_V = 0.25;   // m/s
const K = 4;             // ticks per decision (15 Hz)
const MAX_TICKS = 900;   // 15 s

// ---------- map geometry (red ball) ----------
function blocked(t) {
  const v = typeof t === 'string' ? parseFloat(t) : t, f = Math.floor(v);
  return v === 0 || f === 1 || v === 7 || v === 9.1 || v === 9.3;
}
const PLAIN = new Set([2, 11, 12, 17, 18, 23]);
function plain(t) { return PLAIN.has(typeof t === 'string' ? parseFloat(t) : t); }

// path distance (m) from each tile centre to the goal tile; 8-connected, no corner cutting,
// tiles next to a spike or a lethal gate cost extra so paths keep clear of them
function field(tiles, gx, gy) {
  const W = tiles.length, H = tiles[0].length, n = W * H;
  const ok = new Uint8Array(n), pen = new Float32Array(n);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    ok[x * H + y] = blocked(tiles[x][y]) ? 0 : 1;
    if (tiles[x][y] === 7 || tiles[x][y] === 9.1 || tiles[x][y] === 9.3) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const a = x + dx, b = y + dy; if (a >= 0 && b >= 0 && a < W && b < H) pen[a * H + b] = 0.3;
    }
  }
  const d = new Float64Array(n).fill(Infinity);
  // Dijkstra with a binary heap
  const heap = [[0, gx * H + gy]]; d[gx * H + gy] = 0;
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [c, k] = pop();
    if (c > d[k]) continue;
    const x = (k / H) | 0, y = k - x * H;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const a = x + dx, b = y + dy;
      if (a < 0 || b < 0 || a >= W || b >= H) continue;
      const nk = a * H + b;
      if (!ok[nk]) continue;
      if (dx && dy && (!ok[a * H + y] || !ok[x * H + b])) continue;
      const nc = c + TILE * (dx && dy ? Math.SQRT2 : 1) + pen[nk] * TILE;
      if (nc < d[nk]) { d[nk] = nc; push([nc, nk]); }
    }
  }
  return { d, W, H, tiles, ok };
}

// can a ball travel the straight segment without touching a blocked tile
function clearLine(F, x0, y0, x1, y1) {
  const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L / 0.08));
  const r = 0.185; // just under the ball radius (0.19): a ball centred on a tile fits between walls
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
    for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]]) {
      const tx = Math.round((x + ox) / TILE), ty = Math.round((y + oy) / TILE);
      if (tx < 0 || ty < 0 || tx >= F.W || ty >= F.H || !F.ok[tx * F.H + ty]) return false;
    }
  }
  return true;
}

// ---------- 1-D time-to-stop-at-a-point (exact per-tick dynamics, bang-bang) ----------
const memo = new Map();
function t1(d, v) {
  if (d < 0) { d = -d; v = -v; }
  const qd = Math.round(d / 0.02), qv = Math.round(v / 0.02), key = qd * 1000 + qv;
  let r = memo.get(key);
  if (r !== undefined) return r;
  let x = 0, vv = qv * 0.02, D = qd * 0.02, ticks = 0;
  while (ticks < 2000) {
    if (Math.abs(D - x) < ARRIVE_R * 0.7 && Math.abs(vv) < ARRIVE_V * 0.7) break;
    // in the frame where the target is ahead: brake if braking now just reaches it, else push
    const sgn = D - x >= 0 ? 1 : -1, rem = (D - x) * sgn, u = vv * sgn;
    let bv = u, bx = 0;
    while (bv > 0) { bv *= DAMP; bx += bv * DT; bv -= ACC; }
    const a = (u > 0 && bx >= rem) ? -sgn : sgn;
    vv *= DAMP; x += vv * DT;
    if (a > 0 && vv < MS) vv += ACC; else if (a < 0 && vv > -MS) vv -= ACC;
    ticks++;
  }
  memo.set(key, ticks);
  return ticks;
}

// field value (m) at a point: bilinear over the 4 surrounding tile centres that are finite
function fieldAt(F, x, y) {
  const fx = x / TILE, fy = y / TILE, x0 = Math.floor(fx), y0 = Math.floor(fy);
  let s = 0, w = 0, best = Infinity;
  for (const [a, b] of [[x0, y0], [x0 + 1, y0], [x0, y0 + 1], [x0 + 1, y0 + 1]]) {
    if (a < 0 || b < 0 || a >= F.W || b >= F.H) continue;
    const v = F.d[a * F.H + b];
    if (v === Infinity) continue;
    const ww = (1 - Math.abs(fx - a)) * (1 - Math.abs(fy - b));
    // distance from the point to that tile centre, plus that tile's path distance
    const c = v + Math.hypot(x - a * TILE, y - b * TILE);
    if (c < best) best = c;
    s += ww * v; w += ww;
  }
  return best;
}
// unit direction of travel along the path: towards the lowest-cost neighbour tile in sight
function pathDir(F, x, y) {
  const tx = Math.round(x / TILE), ty = Math.round(y / TILE);
  let best = Infinity, bx = 0, by = 0;
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
    const a = tx + dx, b = ty + dy;
    if (a < 0 || b < 0 || a >= F.W || b >= F.H) continue;
    const v = F.d[a * F.H + b];
    if (v === Infinity) continue;
    const c = v + Math.hypot(x - a * TILE, y - b * TILE);
    if (c < best && clearLine(F, x, y, a * TILE, b * TILE)) { best = c; bx = a * TILE - x; by = b * TILE - y; }
  }
  const L = Math.hypot(bx, by) || 1;
  return [bx / L, by / L];
}

// time-to-go estimate in ticks
function heuristic(F, goal, x, y, vx, vy) {
  if (clearLine(F, x, y, goal.x, goal.y)) return Math.max(t1(goal.x - x, vx), t1(goal.y - y, vy));
  const d = fieldAt(F, x, y);
  if (d === Infinity) return 1e5;
  const [ux, uy] = pathDir(F, x, y);
  const vp = vx * ux + vy * uy, vq = -vx * uy + vy * ux;
  // the path's corners cost time: going around them needs speed off the straight line
  return Math.max(t1(d, vp), t1(0, vq));
}

function arrived(goal, x, y, vx, vy) {
  return Math.hypot(x - goal.x, y - goal.y) < ARRIVE_R && Math.hypot(vx, vy) < ARRIVE_V;
}

// ---------- tasks ----------
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

function makeTask(seed, keys) {
  const r = rng(seed * 2654435761);
  for (;;) {
    const key = keys[Math.floor(r() * keys.length)];
    const map = getMap(key), tiles = map.tiles, W = tiles.length, H = tiles[0].length;
    const cand = [];
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (plain(tiles[x][y])) cand.push([x, y]);
    const g = cand[Math.floor(r() * cand.length)];
    const F = field(tiles, g[0], g[1]);
    const starts = cand.filter(([x, y]) => { const d = F.d[x * H + y] / TILE; return d >= 4 && d <= 30; });
    if (!starts.length) continue;
    const s = starts[Math.floor(r() * starts.length)];
    const sp = r() * MS, sa = r() * 2 * Math.PI;
    return { key, F, goal: { x: g[0] * TILE, y: g[1] * TILE }, start: { x: s[0] * TILE, y: s[1] * TILE, vx: Math.cos(sa) * sp, vy: Math.sin(sa) * sp } };
  }
}

// ---------- controllers ----------
// baseline: per-axis bang-bang towards a waypoint (the goal if in sight, else a path tile in sight)
function baseline(task, x, y, vx, vy) {
  const F = task.F, goal = task.goal;
  let wx = goal.x, wy = goal.y, stop = true;
  if (!clearLine(F, x, y, goal.x, goal.y)) {
    const [ux, uy] = pathDir(F, x, y);
    wx = x + ux * 1.2; wy = y + uy * 1.2; stop = false;
  }
  const axis = (d, v) => {
    if (!stop) return Math.abs(d) < 0.05 ? 0 : Math.sign(d);
    let bv = Math.abs(v), bx = 0;
    while (bv > 0) { bv *= DAMP; bx += bv * DT; bv -= ACC; }
    if (Math.sign(v) === Math.sign(d) && bx >= Math.abs(d)) return -Math.sign(d);
    if (Math.abs(d) > 0.04) return Math.sign(d);
    return Math.abs(v) > 0.05 ? -Math.sign(v) : 0;
  };
  const ax = axis(wx - x, vx), ay = axis(wy - y, vy);
  return ACTIONS.findIndex(([a, b]) => a === ax && b === ay);
}

// search: beam search in the real engine. Each node is a saved game state; children try all 9
// key directions for K ticks; nodes are ranked by ticks used + estimated ticks to go.
function makeSearch({ width = 16, depth = 6 } = {}) {
  return function search(task, sim, p) {
    const root = sim.save();
    let beam = [{ s: root, g: 0, first: -1 }], bestDone = null, bestLeaf = null;
    for (let lvl = 0; lvl < depth && beam.length; lvl++) {
      const kids = [];
      for (const n of beam) {
        for (let a = 0; a < 9; a++) {
          sim.restore(n.s);
          setKeys(p, a);
          let done = false, t = 0;
          for (; t < K; t++) {
            sim.tickOnce();
            if (p.dead) break;
            const q = p.body.GetPosition(), v = p.body.GetLinearVelocity();
            if (arrived(task.goal, q.x, q.y, v.x, v.y)) { done = true; t++; break; }
          }
          if (p.dead) continue;
          const g = n.g + t, first = n.first < 0 ? a : n.first;
          if (done) { if (!bestDone || g < bestDone.g) bestDone = { g, first }; continue; }
          const q = p.body.GetPosition(), v = p.body.GetLinearVelocity();
          const f = g + heuristic(task.F, task.goal, q.x, q.y, v.x, v.y);
          if (bestDone && f >= bestDone.g) continue;
          const cell = Math.round(q.x / 0.04) + ',' + Math.round(q.y / 0.04) + ',' + Math.round(v.x / 0.1) + ',' + Math.round(v.y / 0.1);
          const st = sim.save();
          // a ball already overlapping a spike or gate pops at the start of the next tick, whatever
          // keys it presses: look one tick further so a doomed state never survives
          sim.tickOnce();
          if (p.dead) continue;
          kids.push({ f, g, first, cell, s: st });
        }
      }
      kids.sort((u, w) => u.f - w.f);
      // keep the best line for every first move, so a move that only looks slower now (braking)
      // is still there when the faster ones turn out to end in a pop further ahead
      const seen = new Set(), next = [], firsts = new Set();
      for (const k of kids) if (!firsts.has(k.first)) { firsts.add(k.first); seen.add(k.cell); next.push(k); }
      for (const k of kids) {
        if (next.length >= width) break;
        if (seen.has(k.cell)) continue;
        seen.add(k.cell); next.push(k);
      }
      next.sort((u, w) => u.f - w.f);
      beam = next;
      if (beam.length) bestLeaf = beam[0];
    }
    sim.restore(root);
    if (bestDone && (!bestLeaf || bestDone.g <= bestLeaf.f)) return bestDone.first;
    return bestLeaf ? bestLeaf.first : 0;
  };
}

module.exports = { field, heuristic, t1, arrived, makeTask, baseline, makeSearch, clearLine, K, MAX_TICKS, TILE, mapKeys, Sim, setKeys, ACTIONS };
