// league/env.js - one carrier against two chasers on open floor, for league training (league/league.js).
// The carrier's goal is a point GOAL_DIST metres away in one of 4 directions (multiples of 90 degrees, so every game can
// be turned to face the same way without changing the physics). Starts are random: chasers 1.5-6 m from the carrier
// (one mostly in front of it), every ball moving 0-2.5 m/s in any direction.
// Results: the carrier ESCAPES (past both chasers: it can reach the goal sooner than either, by GAP seconds) = +1 for the
// carrier; a chaser touches it (a return) = +1 for the chasers; neither in LIMIT ticks = a draw (0).
// Each side sees the other side REACT ticks late (no copying keys). Decisions every K ticks.
// Hold to kill: each decision, a chaser for which holding one key is a certain kill (chase/killtest.js fast check,
// 1 cm margin, on what the chaser sees: the carrier carried forward over the ticks it can't see, free to swerve at once) holds that key until it touches or misses; its
// network is overruled meanwhile. Both sides' views include, for each chaser, whether it has a certain kill now.
const { Sim, getMap, setKeys, ACTIONS } = require('../sim');
const N = require('../nav');
const KT = require('../chase/killtest');

const TOUCH = 0.385, LIMIT = 8 * 60, K = 4, REACT = 12, GOAL_DIST = 10, GAP = 0.25, ARENA = 60, RAYS = 8;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function arenaMap() {
  const m = JSON.parse(JSON.stringify(getMap('74724')));
  m.tiles = Array.from({ length: ARENA }, (_, x) => Array.from({ length: ARENA }, (_, y) => (x === 0 || y === 0 || x === ARENA - 1 || y === ARENA - 1 ? 1 : 2)));
  m.portals = {}; m.fields = {}; m.switches = {}; m.marsballs = []; m.key = 'arena';
  return m;
}

// seconds for a ball at p moving v to reach g at full speed (velocity towards g counts)
function timeTo(p, v, g) {
  const dx = g.x - p.x, dy = g.y - p.y, d = Math.hypot(dx, dy) || 1e-9;
  return N.tReach(Math.max(0, d - 0.19), (v.x * dx + v.y * dy) / d) / 60;
}

class Game {
  constructor(seed) {
    this.sim = new Sim(arenaMap()); this.rs = { s: seed >>> 0 || 1 };
    this.ca = this.sim.addBall(2); this.ch = [this.sim.addBall(1), this.sim.addBall(1)];
    this.root = null;
  }
  rnd() { this.rs.s = (this.rs.s * 1664525 + 1013904223) >>> 0; return this.rs.s / 2 ** 32; }
  reset() {
    const r = () => this.rnd(), c = ARENA * 0.4 / 2;
    this.dir = Math.floor(r() * 4); const [gx, gy] = DIRS[this.dir];
    const cx = c - gx * 3, cy = c - gy * 3; // carrier a bit back from the middle, goal ahead
    this.goal = { x: cx + gx * GOAL_DIST, y: cy + gy * GOAL_DIST };
    const vel = () => { const s = r() * 2.5, a = r() * 2 * Math.PI; return [Math.cos(a) * s, Math.sin(a) * s]; };
    const g0 = Math.atan2(gy, gx);
    this.sim.place(this.ca, cx, cy, ...vel());
    this.ch.forEach((p, i) => { // chaser 0 mostly in front (within 90 degrees of the goal direction), chaser 1 anywhere
      const d = 1.5 + r() * 4.5, a = i === 0 ? g0 + (r() - 0.5) * Math.PI : r() * 2 * Math.PI;
      this.sim.place(p, cx + Math.cos(a) * d, cy + Math.sin(a) * d, ...vel());
    });
    this.t = 0; this.hist = []; this.held = [null, null]; this.record(); this.kills = [this.killKey(0), this.killKey(1)];
    return this;
  }
  record() { // positions and velocities each tick, for the late views
    const s = (p) => { const q = p.body.GetPosition(), v = p.body.GetLinearVelocity(); return { x: q.x, y: q.y, vx: v.x, vy: v.y }; };
    this.hist.push({ ca: s(this.ca), ch: this.ch.map(s) }); if (this.hist.length > REACT + 2) this.hist.shift();
  }
  // a world key that is a certain kill for chaser i (on what it sees: the carrier REACT ticks ago), or -1
  killKey(i) {
    // certain against ANY carrier movement (chase/killtest.js sure): the carrier as the chaser last saw it, free to have
    // been pushing any way for the REACT ticks the chaser can't see, and every tick after
    const q = this.ch[i].body.GetPosition(), w = this.ch[i].body.GetLinearVelocity(), c0 = this.hist[0].ca;
    const st = { cx: q.x, cy: q.y, cvx: w.x, cvy: w.y, fx: c0.x, fy: c0.y, fvx: c0.vx, fvy: c0.vy };
    if (Math.hypot(c0.x - q.x, c0.y - q.y) > 4.5) return { k: -1 };
    let best = -1, bt = Infinity; for (let k = 1; k <= 8; k++) { const t = KT.sure(st, k, 0, REACT, 0.375); if (t < bt) { bt = t; best = k; } }
    return bt < Infinity ? { k: best, t: bt } : { k: -1 };
  }
  // turn a world vector into the game's frame (goal straight ahead = +x)
  rot(x, y) { const [gx, gy] = DIRS[this.dir]; return [x * gx + y * gy, -x * gy + y * gx]; }
  // and a key chosen in that frame back into a world key
  keyToWorld(a) { const [kx, ky] = ACTIONS[a], [gx, gy] = DIRS[this.dir], wx = kx * gx - ky * gy, wy = kx * gy + ky * gx;
    return ACTIONS.findIndex(([p, q]) => p === wx && q === wy); }
  rays(p) { // free distance in 8 directions (game frame), up to 5 m, scaled to 0..1
    const out = []; const q = p.body.GetPosition(), T = this.sim.tiles;
    for (let i = 0; i < RAYS; i++) { const a = i * Math.PI / 4, [wx, wy] = this.unrot(Math.cos(a), Math.sin(a)); let d = 0;
      for (; d < 5; d += 0.1) { const tx = Math.round((q.x + wx * d) / 0.4), ty = Math.round((q.y + wy * d) / 0.4);
        if (tx < 0 || ty < 0 || tx >= T.length || ty >= T[0].length || parseFloat(T[tx][ty]) !== 2) break; }
      out.push(d / 5); }
    return out;
  }
  unrot(x, y) { const [gx, gy] = DIRS[this.dir]; return [x * gx - y * gy, x * gy + y * gx]; }
  // what one ball sees: itself now, the other side REACT ticks ago, its teammate now; all in the game frame, metres / 5
  view(who) {
    const now = this.hist[this.hist.length - 1], late = this.hist[0], f = (o, me) => { const [x, y] = this.rot(o.x - me.x, o.y - me.y), [vx, vy] = this.rot(o.vx, o.vy); return [x / 5, y / 5, vx / 3, vy / 3]; };
    const left = 1 - this.t / LIMIT;
    if (who === 'ca') {
      const me = now.ca, cs = late.ch.slice().sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
      const [vx, vy] = this.rot(me.vx, me.vy), [gx, gy] = this.rot(this.goal.x - me.x, this.goal.y - me.y);
      const order = [0, 1].sort((a, b) => Math.hypot(late.ch[a].x - me.x, late.ch[a].y - me.y) - Math.hypot(late.ch[b].x - me.x, late.ch[b].y - me.y));
      return Float32Array.from([vx / 3, vy / 3, ...f(cs[0], me), ...f(cs[1], me), gx / 10, gy / 10, ...this.rays(this.ca), left,
        this.kills[order[0]].k >= 0 ? 1 : 0, this.kills[order[1]].k >= 0 ? 1 : 0]);
    }
    const i = who, me = now.ch[i], mate = now.ch[1 - i], [vx, vy] = this.rot(me.vx, me.vy), [gx, gy] = this.rot(this.goal.x - me.x, this.goal.y - me.y);
    return Float32Array.from([vx / 3, vy / 3, ...f(late.ca, me), ...f(mate, me), gx / 10, gy / 10, ...this.rays(this.ch[i]), left,
      this.kills[i].k >= 0 ? 1 : 0, this.kills[1 - i].k >= 0 ? 1 : 0]);
  }
  // is chaser i holding a kill this decision (then its network is overruled)?
  holding(i) { return !!(this.held[i] || this.kills[i].k >= 0); }
  // run K ticks with these keys (game frame); returns null while playing, else 'escape' | 'return' | 'draw'
  step(aCa, aCh) {
    setKeys(this.ca, this.keyToWorld(aCa));
    this.ch.forEach((p, i) => { // hold to kill: start holding on a certain kill, keep holding until it touches or passes
      if (!this.held[i] && this.kills[i].k >= 0) this.held[i] = { k: this.kills[i].k, until: this.t + this.kills[i].t + 6 };
      if (this.held[i] && this.t >= this.held[i].until) this.held[i] = null;
      setKeys(p, this.held[i] ? this.held[i].k : this.keyToWorld(aCh[i]));
    });
    for (let k = 0; k < K; k++) {
      this.sim.tickOnce(); this.t++; this.record();
      const q = this.ca.body.GetPosition();
      if (this.ch.some((p) => { const c = p.body.GetPosition(); return Math.hypot(c.x - q.x, c.y - q.y) < TOUCH; })) return 'return';
    }
    const q = this.ca.body.GetPosition(), v = this.ca.body.GetLinearVelocity(), tc = timeTo(q, v, this.goal);
    // no escape while a chaser is holding a kill (it is about to touch, whatever the race to the goal says)
    if (Math.hypot(q.x - this.goal.x, q.y - this.goal.y) < 0.4 || !this.held.some(Boolean) && this.ch.every((p) => timeTo(p.body.GetPosition(), p.body.GetLinearVelocity(), this.goal) > tc + GAP)) return 'escape';
    if (this.t >= LIMIT) return 'draw';
    this.sim.commit(); this.kills = [this.killKey(0), this.killKey(1)];
    return null;
  }
}
const VIEW = 2 + 4 + 4 + 2 + RAYS + 1 + 2; // 23 numbers for either side
module.exports = { Game, VIEW, LIMIT, K };
