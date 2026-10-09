// league/killenv.js - one carrier against two chasers at a real kill point (chase/pinches.json), on the full real map.
// A start: a forward kill point for the carrier's team (running along it takes it towards where it scores). The carrier
// is partway along the lane running into the bump (1-2.5 m/s); the guard chaser is on the open side of the lane 1.5-3
// tiles out, roughly level and moving with it; the pressing chaser is 1.5-4 m behind along the lane, coming in.
// Results: the carrier ESCAPES when, by route around walls and spikes, it can reach its own flag (its end zone on
// neutral-flag maps) GAP seconds sooner than either chaser; a touch, or the carrier popping (spikes), is a RETURN (the
// chasers win); lasting LIMIT ticks is a DRAW, a win for the holder. Each side sees the other REACT ticks late; chasers
// hold to kill (chase/killtest.js sure). Views as league/env.js, turned so the carrier's way home points along +x
// (nearest of 4 directions), with rays to walls and spikes and the route direction home instead of a straight line.
const fs = require('fs'), path = require('path');
const { Sim, getMap, setKeys, ACTIONS } = require('../sim');
const N = require('../nav');
const KT = require('../chase/killtest');
const { distTo, blockedTile } = require('../chase/pinches');

const TOUCH = 0.385, LIMIT = 8 * 60, K = 4, REACT = 12, GAP = 0.25, RAYS = 8, TILE = 0.4;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const SPOTS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'chase', 'pinches.json'), 'utf8'));

// every forward kill point, with its map and the team it is forward for
const STARTS = [];
for (const [key, m] of Object.entries(SPOTS)) for (const l of m.lanes) for (const t of [1, 2]) if (l.fwd && l.fwd[t]) STARTS.push({ key, lane: l, team: t });

class KillGame {
  constructor(seed) { this.rs = { s: seed >>> 0 || 1 }; this.sims = {}; }
  rnd() { this.rs.s = (this.rs.s * 1664525 + 1013904223) >>> 0; return this.rs.s / 2 ** 32; }
  // one Sim per map, with its balls and the route-distance grids home for each team, made once
  world(key) {
    if (!this.sims[key]) {
      const map = getMap(key), sim = new Sim(map), T = map.tiles, goals = { 1: [], 2: [] };
      for (let x = 0; x < T.length; x++) for (let y = 0; y < T[0].length; y++) { const f = Math.floor(parseFloat(T[x][y])); if (f === 3) goals[1].push([x, y]); if (f === 4) goals[2].push([x, y]); }
      if (!goals[1].length || !goals[2].length) for (let x = 0; x < T.length; x++) for (let y = 0; y < T[0].length; y++) { const v = parseFloat(T[x][y]); if (v === 17) goals[1].push([x, y]); if (v === 18) goals[2].push([x, y]); }
      const balls = { 1: [sim.addBall(1), sim.addBall(1), sim.addBall(1)], 2: [sim.addBall(2), sim.addBall(2), sim.addBall(2)] };
      for (const t of [1, 2]) for (const b of balls[t]) sim.place(b, -10, -10, 0, 0); // parked off the map
      this.sims[key] = { sim, balls, home: { 1: distTo(T, goals[1]), 2: distTo(T, goals[2]) }, tiles0: T.map((c) => c.slice()) };
    }
    return this.sims[key];
  }
  open(x, y) { const T = this.sim.tiles, tx = Math.round(x / TILE), ty = Math.round(y / TILE); return tx >= 0 && ty >= 0 && tx < T.length && ty < T[0].length && !blockedTile(T[tx][ty]); }
  reset() {
    const r = () => this.rnd();
    for (let tries = 0; ; tries++) {
      const S = STARTS[Math.floor(r() * STARTS.length)], W = this.world(S.key), l = S.lane;
      this.key = S.key; this.sim = W.sim; this.W = W; this.team = S.team;
      // a fresh map: tiles as they started (boosts, bombs, flags), no pending respawns, every ball parked off the map
      for (let x = 0; x < W.tiles0.length; x++) for (let y = 0; y < W.tiles0[0].length; y++) this.sim.tiles[x][y] = W.tiles0[x][y];
      this.sim.queueT = []; this.sim.commit(); for (const t of [1, 2]) for (const b of W.balls[t]) this.sim.place(b, -10, -10, 0, 0);
      // lane geometry: forward along it, and the open side (away from the wall)
      const fx = Math.sign(l.to[0] - l.from[0]), fy = Math.sign(l.to[1] - l.from[1]), fl = Math.hypot(fx, fy) || 1, ux = fx / fl, uy = fy / fl;
      const side = [-uy, ux], wallSide = this.open((l.to[0] + side[0] * (l.off + 1)) * TILE, (l.to[1] + side[1] * (l.off + 1)) * TILE) ? -1 : 1;
      const ox = -side[0] * wallSide, oy = -side[1] * wallSide; // the open side
      const L = Math.hypot(l.to[0] - l.from[0], l.to[1] - l.from[1]), a = r() * 0.6 * L;
      const cx = (l.from[0] + ux * a) * TILE, cy = (l.from[1] + uy * a) * TILE, cs = 1 + r() * 1.5;
      const g = 1.5 + r() * 1.5, lv = (r() - 0.5) * 2; // guard: tiles out to the open side, and how far level (tiles)
      const gx = cx + (ox * g + ux * lv) * TILE, gy = cy + (oy * g + uy * lv) * TILE, gs = cs + (r() - 0.5);
      const b = 1.5 + r() * 2.5, px = cx - ux * b + ox * (r() - 0.5) * 0.8, py = cy - uy * b + oy * (r() - 0.5) * 0.8, ps = cs + r() * 0.8;
      if (![[cx, cy], [gx, gy], [px, py]].every(([x, y]) => this.open(x, y)) && tries < 500) continue;
      this.ca = W.balls[S.team][0]; this.ch = [W.balls[3 - S.team][0], W.balls[3 - S.team][1]];
      this.sim.place(this.ca, cx, cy, ux * cs, uy * cs);
      this.sim.place(this.ch[0], gx, gy, ux * gs, uy * gs);
      this.sim.place(this.ch[1], px, py, ux * ps, uy * ps);
      // the game frame: the carrier's way home (route direction) turned to the nearest of 4 directions
      const [hx, hy] = this.homeDir(cx, cy, this.team); this.dir = Math.abs(hx) > Math.abs(hy) ? (hx > 0 ? 0 : 2) : (hy > 0 ? 1 : 3);
      this.t = 0; this.hist = []; this.held = [null, null]; this.record();
      // a fair start: not already escaped or returned
      if (tries < 500 && (this.escaped() || this.touching())) continue;
      this.kills = [this.killKey(0), this.killKey(1)];
      this.lane = S; return this;
    }
  }
  // route distance home (metres) for a team from a point, and the direction along the route
  homeDist(x, y, team) { const D = this.W.home[team], tx = Math.round(x / TILE), ty = Math.round(y / TILE);
    return D[tx] && D[tx][ty] !== undefined && D[tx][ty] < Infinity ? D[tx][ty] * TILE : 1e9; }
  homeDir(x, y, team) { const D = this.W.home[team], tx = Math.round(x / TILE), ty = Math.round(y / TILE); let best = Infinity, bx = 0, by = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const v = D[tx + dx] && D[tx + dx][ty + dy]; if (v !== undefined && v < best) { best = v; bx = dx; by = dy; } }
    const l = Math.hypot(bx, by) || 1; return [bx / l, by / l]; }
  // seconds to get home for the carrier's team, from a ball's position and velocity
  timeHome(p) { const q = p.body.GetPosition(), v = p.body.GetLinearVelocity(), [hx, hy] = this.homeDir(q.x, q.y, this.team);
    return N.tReach(this.homeDist(q.x, q.y, this.team), v.x * hx + v.y * hy) / 60; }
  escaped() { const tc = this.timeHome(this.ca); return !this.held.some(Boolean) && this.ch.every((p) => this.timeHome(p) > tc + GAP); }
  touching() { const q = this.ca.body.GetPosition(); return this.ch.some((p) => { const c = p.body.GetPosition(); return Math.hypot(c.x - q.x, c.y - q.y) < TOUCH; }); }
  record() {
    const s = (p) => { const q = p.body.GetPosition(), v = p.body.GetLinearVelocity(); return { x: q.x, y: q.y, vx: v.x, vy: v.y }; };
    this.hist.push({ ca: s(this.ca), ch: this.ch.map(s) }); if (this.hist.length > REACT + 2) this.hist.shift();
  }
  killKey(i) {
    const q = this.ch[i].body.GetPosition(), w = this.ch[i].body.GetLinearVelocity(), c0 = this.hist[0].ca;
    if (Math.hypot(c0.x - q.x, c0.y - q.y) > 4.5) return { k: -1 };
    const st = { cx: q.x, cy: q.y, cvx: w.x, cvy: w.y, fx: c0.x, fy: c0.y, fvx: c0.vx, fvy: c0.vy };
    let best = -1, bt = Infinity; for (let k = 1; k <= 8; k++) { const t = KT.sure(st, k, 0, REACT, 0.375); if (t < bt) { bt = t; best = k; } }
    return bt < Infinity ? { k: best, t: bt } : { k: -1 };
  }
  holding(i) { return !!(this.held[i] || this.kills[i].k >= 0); }
  rot(x, y) { const [gx, gy] = DIRS[this.dir]; return [x * gx + y * gy, -x * gy + y * gx]; }
  unrot(x, y) { const [gx, gy] = DIRS[this.dir]; return [x * gx - y * gy, x * gy + y * gx]; }
  keyToWorld(a) { const [kx, ky] = ACTIONS[a], [gx, gy] = DIRS[this.dir], wx = kx * gx - ky * gy, wy = kx * gy + ky * gx; return ACTIONS.findIndex(([p, q]) => p === wx && q === wy); }
  rays(p) { const out = [], q = p.body.GetPosition();
    for (let i = 0; i < RAYS; i++) { const a = i * Math.PI / 4, [wx, wy] = this.unrot(Math.cos(a), Math.sin(a)); let d = 0;
      for (; d < 5; d += 0.1) if (!this.open(q.x + wx * d, q.y + wy * d)) break; out.push(d / 5); }
    return out; }
  view(who) {
    const now = this.hist[this.hist.length - 1], late = this.hist[0], left = 1 - this.t / LIMIT;
    const f = (o, me) => { const [x, y] = this.rot(o.x - me.x, o.y - me.y), [vx, vy] = this.rot(o.vx, o.vy); return [x / 5, y / 5, vx / 3, vy / 3]; };
    // the way home for the carrier's team from this ball: route direction, and route distance (metres / 20)
    const home = (me) => { const [hx, hy] = this.homeDir(me.x, me.y, this.team), [a, b] = this.rot(hx, hy); return [a, b, Math.min(2, this.homeDist(me.x, me.y, this.team) / 20)]; };
    if (who === 'ca') {
      const me = now.ca, order = [0, 1].sort((a, b) => Math.hypot(late.ch[a].x - me.x, late.ch[a].y - me.y) - Math.hypot(late.ch[b].x - me.x, late.ch[b].y - me.y));
      const [vx, vy] = this.rot(me.vx, me.vy);
      return Float32Array.from([vx / 3, vy / 3, ...f(late.ch[order[0]], me), ...f(late.ch[order[1]], me), ...home(me), ...this.rays(this.ca), left,
        this.kills[order[0]].k >= 0 ? 1 : 0, this.kills[order[1]].k >= 0 ? 1 : 0]);
    }
    const i = who, me = now.ch[i], mate = now.ch[1 - i], [vx, vy] = this.rot(me.vx, me.vy);
    return Float32Array.from([vx / 3, vy / 3, ...f(late.ca, me), ...f(mate, me), ...home(me), ...this.rays(this.ch[i]), left,
      this.kills[i].k >= 0 ? 1 : 0, this.kills[1 - i].k >= 0 ? 1 : 0]);
  }
  step(aCa, aCh) {
    setKeys(this.ca, this.keyToWorld(aCa));
    this.ch.forEach((p, i) => {
      if (!this.held[i] && this.kills[i].k >= 0) this.held[i] = { k: this.kills[i].k, until: this.t + this.kills[i].t + 6 };
      if (this.held[i] && this.t >= this.held[i].until) this.held[i] = null;
      setKeys(p, this.held[i] ? this.held[i].k : this.keyToWorld(aCh[i]));
    });
    for (let k = 0; k < K; k++) {
      this.sim.tickOnce(); this.t++; this.record();
      if (this.ca.dead || this.touching()) return 'return';
      for (const p of this.ch) if (p.dead) { this.sim.place(p, -10, -10, 0, 0); } // a chaser that pops is out of the play
    }
    if (this.escaped()) return 'escape';
    if (this.t >= LIMIT) return 'draw';
    this.sim.commit(); this.kills = [this.killKey(0), this.killKey(1)];
    return null;
  }
}
const VIEW = 2 + 4 + 4 + 3 + RAYS + 1 + 2; // 24 numbers
module.exports = { KillGame, VIEW, LIMIT, K, REACT, STARTS };
