// tune/game.js - one game of the contain chasers (tune/contain.js) against an escaper. Two kinds of test:
//
// KILL POINTS ('kp'): starts from league/killenv.js (a forward kill point: the escaper partway along the lane running
// into the bump, one chaser on the open side, one coming in behind), straight walls only (diagonal "bumps" are only
// steps in a staircase the escaper slides along), at least MINFRONT tiles from the bump. The kill point is an AREA, a
// box in lane terms: forward it ends at the CONTAIN LINE (out from the bump at right angles to the lane), backwards BACK
// tiles behind where the escaper starts, outwards OUT tiles from its row into the open. Getting its whole ball out of
// the area any way while SEP metres clear of both chasers is an escape.
//
// RUN INTO A WALL ('wall'): the escaper is on open floor running at a straight wall 4-10 tiles ahead; both chasers
// start 1.5-4 m behind it, coming after it. Getting back past both chasers (behind the rearmost one, along the run)
// while SEP metres clear of both is an escape. With the quadrant rule below, the chasers can't swap sides around it
// (both behind it on the left -> both on the right) without that counting as swipes.
//
// Rules for both: the chasers win with a committed certain kill (the hold-to-kill "solo"), or the escaper running into
// a chaser that holds its spot (BLOCKED: containing worked), or the escaper popping on spikes; a chaser moving into it
// without a certain kill is a BUMP, a loss (they are meant to contain, not ram); lasting LIMIT ticks is a HOLD (theirs).
// Missed swipes: a committed tag that ends without the touch, or a chaser going more than QBAND metres into another
// QUADRANT around the escaper (the map cut in four by the vertical and horizontal lines through it, moving with it;
// each chaser belongs to the one it starts in, taking its side on an axis once QBAND clear of the line) when the chaser
// did more of the moving across the line (the escaper cutting past it just moves it to the new quadrant). One miss isn't
// out (dodging slows the escaper and the teammate may get it); both chasers having missed is an escape.
// Both sides see each other REACT ticks late. Every tick is decided (as on the page).
const { KillGame, STARTS } = require('../league/killenv');
const { setKeys } = require('../sim');
const C = require('./contain');

const T_ = 0.4, TOUCH = 0.385, LIMIT = 8 * 60, REACT = 12, BALL = 0.475, BACK = 4, OUT = 4, MINFRONT = 2.5, SEP = 1.0, QBAND = 0.3; // tiles; SEP, QBAND in metres
const ESCAPERS = { kp: ['route', 'around', 'back', 'juke', 'deep', 'fake'], wall: ['straight', 'back', 'juke', 'deep', 'fake'] };
// route:    runs its route home (along the lane into the bump, unless the route turns off before it)       (kp)
// around:   goes for a spot just past the line on the open side, round the bump                            (kp)
// straight: keeps running into the wall, then slides along it away from the nearer chaser                  (wall)
// back:     turns round and runs out the back (kp: of the area on the open side; wall: past the chasers, on the
//           side with more room)
// juke:     looks ahead: tries each key for 1/3 s against where the chasers will be (they come straight at it) and
//           takes the one that gets nearest to escaping without being touched
// deep:     two moves ahead (a key for 8 ticks, then another for 16), against chasers that aim where it is going
//           (lead pursuit); gets out soonest without being touched
// fake:     heads for the exit furthest from the chasers; when a chaser closes in on it (within 1.3 m, coming at it),
//           cuts to the exit most opposite that chaser (at most 3 cuts, 0.5 s apart)

// ---------- kill-point starts ----------
function setupKp(seed) {
  const g = new KillGame(seed);
  for (let k = 0; k < 200; k++) { g.reset(); const l = g.lane.lane, fx = Math.sign(l.to[0] - l.from[0]), fy = Math.sign(l.to[1] - l.from[1]), fl = Math.hypot(fx, fy) || 1, q = g.ca.body.GetPosition();
    if (fx && fy) continue;
    if (0.5 * fl + BALL - ((q.x / T_ - l.to[0]) * fx + (q.y / T_ - l.to[1]) * fy) / fl >= MINFRONT) break; }
  const l = g.lane.lane, fx = Math.sign(l.to[0] - l.from[0]), fy = Math.sign(l.to[1] - l.from[1]), fl = Math.hypot(fx, fy) || 1, ux = fx / fl, uy = fy / fl;
  const side = [-uy, ux], wallSide = g.open((l.to[0] + side[0] * (l.off + 1)) * T_, (l.to[1] + side[1] * (l.off + 1)) * T_) ? -1 : 1;
  const ox = -side[0] * wallSide, oy = -side[1] * wallSide;
  const line = { x: l.to[0], y: l.to[1], ux, uy, ox, oy, face: 0.5 * fl + BALL };
  const q = g.ca.body.GetPosition(), a0 = (q.x / T_ - l.to[0]) * ux + (q.y / T_ - l.to[1]) * uy, c0 = (q.x / T_ - l.to[0]) * ox + (q.y / T_ - l.to[1]) * oy;
  const area = { back: a0 - BACK, face: line.face, out: c0 + OUT, inner: c0 - l.off - 1.5 };
  const P = (a, c) => ({ x: (l.to[0] + ux * a + ox * c) * T_, y: (l.to[1] + uy * a + oy * c) * T_ });
  const tgt = P(0.5 * fl + 1.5, l.off + 1.5), back = P(area.back - 1.5, c0 + 1.5), out = P((a0 + area.face) / 2, area.out + 2);
  const laneXY = (x, y) => { const dx = x / T_ - line.x, dy = y / T_ - line.y; return [dx * ux + dy * uy, dx * ox + dy * oy]; };
  return { kind: 'kp', g, key: g.key, team: g.team, sim: g.sim, ca: g.ca, ch: g.ch, W: g.W, open: (x, y) => g.open(x, y), line, area, tgt, back,
    exits: [tgt, back].concat(g.open(out.x, out.y) ? [out] : []),
    // how the escaper is out ('front' | 'back' | 'out') or null; tiles still to go
    out: (x, y) => { const [a, c] = laneXY(x, y); return a >= area.face ? 'front' : a <= area.back - BALL ? 'back' : c >= area.out + BALL ? 'out' : null; },
    edge: (x, y) => { const [a, c] = laneXY(x, y); return Math.max(0, Math.min(area.face - a, a - area.back + BALL, area.out + BALL - c)); },
    info: { line, area, tgt, back } };
}

// ---------- run-into-a-wall starts ----------
const WALL_MAPS = [...new Set(STARTS.map((s) => s.key))].sort();
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function setupWall(seed) {
  const g = new KillGame(seed), r = () => g.rnd();
  for (let tries = 0; tries < 5000; tries++) {
    const key = WALL_MAPS[Math.floor(r() * WALL_MAPS.length)], team = r() < 0.5 ? 1 : 2, W = g.world(key);
    g.key = key; g.sim = W.sim; g.W = W; g.team = team;
    const T = W.tiles0, open = (x, y) => x >= 0 && y >= 0 && x < T.length && y < T[0].length && !C.blocked(T[x][y]);
    const tx = Math.floor(r() * T.length), ty = Math.floor(r() * T[0].length), [ux, uy] = DIRS[Math.floor(r() * 4)], px = -uy, py = ux;
    if (!open(tx, ty)) continue;
    // ahead: L open tiles (with a tile of floor either side) and then a flat wall 5 tiles wide
    let L = 0; while (L < 12 && open(tx + ux * (L + 1), ty + uy * (L + 1)) && open(tx + ux * (L + 1) + px, ty + uy * (L + 1) + py) && open(tx + ux * (L + 1) - px, ty + uy * (L + 1) - py)) L++;
    if (L < 4 || L > 10) continue;
    const wx = tx + ux * (L + 1), wy = ty + uy * (L + 1); let flat = true;
    for (let s = -2; s <= 2 && flat; s++) flat = !open(wx + px * s, wy + py * s) && open(wx - ux + px * s, wy - uy + py * s);
    if (!flat) continue;
    // behind: room for the chasers (11 tiles back, a tile either side)
    let room = true; for (let b = 1; b <= 11 && room; b++) for (let s = -1; s <= 1 && room; s++) room = open(tx - ux * b + px * s, ty - uy * b + py * s);
    if (!room) continue;
    // a fresh map, every ball parked, then the escaper running at the wall and the chasers coming in behind it
    for (let x = 0; x < T.length; x++) for (let y = 0; y < T[0].length; y++) W.sim.tiles[x][y] = T[x][y];
    W.sim.queueT = []; W.sim.commit(); for (const t of [1, 2]) for (const b of W.balls[t]) W.sim.place(b, -10, -10, 0, 0);
    const ca = W.balls[team][0], ch = [W.balls[3 - team][0], W.balls[3 - team][1]], sp = 1.5 + r(), ex = tx * T_, ey = ty * T_;
    W.sim.place(ca, ex, ey, ux * sp, uy * sp);
    const cs = [0, 1].map(() => { const b = 1.5 + r() * 2.5, s = (r() - 0.5) * 1.2; return { x: ex - ux * b + px * s, y: ey - uy * b + py * s, v: sp }; });
    if (Math.hypot(cs[0].x - cs[1].x, cs[0].y - cs[1].y) < 0.6) continue;
    cs.forEach((c, i) => W.sim.place(ch[i], c.x, c.y, ux * c.v, uy * c.v));
    const along = (x, y) => x * ux + y * uy, rear = (chs) => Math.min(...chs.filter((c) => !c.dead).map((c) => along(c.x, c.y)));
    // exits: back past the chasers, on either side (where there is floor)
    const exits = [-1, 1].map((s) => ({ x: ex - ux * 5.5 + px * s * 0.8, y: ey - uy * 5.5 + py * s * 0.8 })).filter((p) => open(Math.round(p.x / T_), Math.round(p.y / T_)));
    if (!exits.length) continue;
    const ref = cs.map((c) => ({ x: c.x, y: c.y }));
    return { kind: 'wall', g, key, team, sim: W.sim, ca, ch, W, open: (x, y) => open(Math.round(x / T_), Math.round(y / T_)), line: null,
      exits, back: exits[0], wallAt: { x: wx * T_, y: wy * T_ },
      // out: behind the rearmost chaser (along the run) by a ball's width; chs = the chasers (as the caller sees them)
      out: (x, y, chs) => (along(x, y) <= rear(chs || ref) - 0.2 ? 'back' : null),
      edge: (x, y, chs) => Math.max(0, (along(x, y) - rear(chs || ref) + 0.2) / T_),
      info: { u: [ux, uy], wall: { x: wx * T_, y: wy * T_ } } };
  }
  throw new Error('no wall start found');
}

const setup = (seed, kind = 'kp') => (kind === 'wall' ? setupWall(seed) : setupKp(seed));

// play one game; returns { result: 'escape' | 'return' | 'hold' | 'bump', how, ticks, frames? }
function play(seed, escaper, params, record, kind = 'kp') {
  const R = setup(seed, kind), sim = R.sim, tiles = sim.tiles, ca = R.ca, ch = R.ch;
  // fields made once per map/team/target and kept (Dijkstra over the map is the slow part)
  const cache = play.cache || (play.cache = new Map());
  const fkey = (tag, tx, ty) => { const k = R.key + ':' + tag + ':' + tx + ':' + ty; if (!cache.has(k)) cache.set(k, C.field(tiles, tx, ty)); return cache.get(k); };
  const D = R.W.home[R.team]; let ht = [0, 0]; for (let x = 0; x < D.length; x++) for (let y = 0; y < D[0].length; y++) if (D[x][y] === 0) { ht = [x, y]; x = D.length; break; }
  const home = fkey('h' + R.team, ht[0], ht[1]);
  const fieldTo = (p) => fkey('t', Math.round(p.x / T_), Math.round(p.y / T_));
  const exits = R.exits.map((p) => ({ p, F: fieldTo(p) }));
  const fk = { ex: null, cuts: 0, at: -99 };
  const keys = C.makeContain({ tiles, home, spot: { x: ht[0] * T_, y: ht[1] * T_ }, react: REACT, line: R.line }, params), state = [];
  const st = (p) => { const q = p.body.GetPosition(), v = p.body.GetLinearVelocity(); return { x: q.x, y: q.y, vx: v.x, vy: v.y, dead: !!p.dead }; };
  const hist = [], frames = record ? [] : null, solos = [], missed = ch.map(() => false); let quadSwipes = 0, caKey = 0;
  const quad = ch.map((p) => { const c = p.body.GetPosition(), e = ca.body.GetPosition(); return [c.x - e.x, c.y - e.y].map((v) => (Math.abs(v) > QBAND ? Math.sign(v) : 0)); });
  const frame = (n) => [n.ca.x, n.ca.y, ...n.ch.flatMap((c) => [c.dead ? -9 : c.x, c.dead ? -9 : c.y])].map((v) => Math.round(v * 100) / 100).concat(ch.map((p, i) => (state[i] && state[i].solo ? 1 : 0)));
  for (let t = 0; t < LIMIT; t++) {
    const now = { ca: st(ca), ch: ch.map(st) }; hist.push(now); if (hist.length > REACT + 1) hist.shift();
    const late = hist[0];
    if (frames && t % 2 === 0) frames.push(frame(now));
    // escaper
    if (escaper === 'route') { const [hx, hy] = C.fieldDir(home, now.ca.x, now.ca.y); caKey = C.dirKey(hx * 2.5 - now.ca.vx, hy * 2.5 - now.ca.vy); }
    else if (escaper === 'around') caKey = steerTo(tiles, exits[0].F, now.ca, exits[0].p);
    else if (escaper === 'back') { const e = kind === 'wall' ? roomier(exits, late.ch) : exits[1]; caKey = steerTo(tiles, e.F, now.ca, e.p); }
    else if (escaper === 'straight') caKey = straight(tiles, R.info.u, now.ca, late.ch);
    else if (escaper === 'juke' && t % 4 === 0) caKey = juke(tiles, now.ca, late.ch, R);
    else if (escaper === 'deep' && t % 4 === 0) caKey = deep(tiles, now.ca, late.ch, R);
    else if (escaper === 'fake') caKey = fake(tiles, now.ca, late.ch, exits, fk, t);
    setKeys(ca, caKey);
    const k = keys(t, late.ca, now.ch, state); ch.forEach((p, i) => { if (!p.dead) setKeys(p, k[i]); });
    // quadrant swipes: a chaser more than QBAND into another quadrant (relative to the escaper)
    // (it is the chaser's swipe only when the chaser did more of the moving across the line; when the escaper cut past
    // it, its quadrant just changes)
    for (let i = 0; i < ch.length; i++) { if (ch[i].dead) continue; const c = ch[i].body.GetPosition(), e = ca.body.GetPosition(), d = [c.x - e.x, c.y - e.y];
      const cv = ch[i].body.GetLinearVelocity(), ev = ca.body.GetLinearVelocity(), vc = [cv.x, cv.y], ve = [ev.x, ev.y];
      for (let a = 0; a < 2; a++) { if (!quad[i][a]) { if (Math.abs(d[a]) > QBAND) quad[i][a] = Math.sign(d[a]); continue; }
        if (d[a] * quad[i][a] < -QBAND) { const dir = -quad[i][a]; if (vc[a] * dir > -ve[a] * dir) { missed[i] = true; quadSwipes++; } quad[i][a] = -quad[i][a]; } } }
    // committed tags that ended (or were replaced) without the touch
    for (let i = 0; i < ch.length; i++) { const s = state[i] && state[i].solo; if (solos[i] && s !== solos[i]) missed[i] = true; solos[i] = s || null; }
    if (ch.every((p, i) => p.dead || missed[i])) return done('escape', t, 'swipe');
    sim.tickOnce();
    const q = ca.body.GetPosition();
    if (ca.dead) return done('return', t + 1, 'pop');
    const hit = ch.findIndex((p) => !p.dead && Math.hypot(p.body.GetPosition().x - q.x, p.body.GetPosition().y - q.y) < TOUCH);
    if (hit >= 0) {
      if (state[hit] && state[hit].solo) return done('return', t + 1, 'kill');
      // who moved into whom: the chaser's speed towards the escaper against the escaper's towards the chaser
      const c = ch[hit].body.GetPosition(), cv = ch[hit].body.GetLinearVelocity(), ev = ca.body.GetLinearVelocity(), dx = q.x - c.x, dy = q.y - c.y, d = Math.hypot(dx, dy) || 1;
      const vc = (cv.x * dx + cv.y * dy) / d, ve = -(ev.x * dx + ev.y * dy) / d;
      return ve >= vc ? done('return', t + 1, 'blocked') : done('bump', t + 1);
    }
    for (const p of ch) if (p.dead) sim.place(p, -10, -10, 0, 0);
    const how = R.out(q.x, q.y, ch.map(st));
    if (how && ch.every((p) => p.dead || Math.hypot(p.body.GetPosition().x - q.x, p.body.GetPosition().y - q.y) >= SEP)) return done('escape', t + 1, how);
  }
  return done('hold', LIMIT);
  function done(result, ticks, how) {
    const r = { result, ticks, how: how || null, quadSwipes };
    if (frames) { frames.push(frame({ ca: st(ca), ch: ch.map(st) })); Object.assign(r, { frames, kind, key: R.key, team: R.team }, R.info); }
    return r;
  }
}
play.cache = null;

function steerTo(tiles, F, b, tgt) { // straight at the target when the way is clear, else down the route field
  let dx, dy;
  if (C.clear(tiles, b.x, b.y, tgt.x, tgt.y)) { dx = tgt.x - b.x; dy = tgt.y - b.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; }
  else [dx, dy] = C.fieldDir(F, b.x, b.y);
  return C.dirKey(dx * 2.5 - b.vx, dy * 2.5 - b.vy);
}
// the exit furthest (on average) from the chasers
const roomier = (exits, chs) => exits.reduce((a, e) => { const d = (p) => chs.filter((c) => !c.dead).reduce((s, c) => s + Math.hypot(c.x - p.x, c.y - p.y), 0); return d(e.p) > d(a.p) ? e : a; });
function straight(tiles, u, b, chs) { // into the wall; once against it, slide along it away from the nearer chaser
  const [ux, uy] = u;
  if (!C.wallAt(tiles, b.x + ux * 0.45, b.y + uy * 0.45)) return C.dirKey(ux * 2.5 - b.vx, uy * 2.5 - b.vy);
  const live = chs.filter((c) => !c.dead), n = live.reduce((a, c) => (Math.hypot(c.x - b.x, c.y - b.y) < Math.hypot(a.x - b.x, a.y - b.y) ? c : a), live[0]);
  const px = -uy, py = ux, s = n && (n.x - b.x) * px + (n.y - b.y) * py > 0 ? -1 : 1;
  return C.dirKey(px * s * 2.5 - b.vx, py * s * 2.5 - b.vy);
}
function juke(tiles, b, chs, R) {
  const H = 20; let best = 0, bs = -Infinity;
  for (let a = 0; a < 9; a++) {
    let x = b.x, y = b.y, vx = b.vx, vy = b.vy, minD = Infinity, past = false;
    const cs = chs.filter((c) => !c.dead).map((c) => ({ ...c }));
    for (let t = 0; t < H; t++) {
      const n = C.kin(x, y, vx, vy, a); if (C.wallAt(tiles, n[0], n[1])) { vx = 0; vy = 0; } else [x, y, vx, vy] = n;
      for (const c of cs) { const k = C.dirKey(x - c.x, y - c.y); [c.x, c.y, c.vx, c.vy] = C.kin(c.x, c.y, c.vx, c.vy, k); minD = Math.min(minD, Math.hypot(c.x - x, c.y - y)); }
      if (R.out(x, y, cs)) { past = true; break; }
    }
    const sc = (past ? 100 : 0) - 2 * R.edge(x, y, cs) - (minD < 0.6 ? 20 * (0.6 - minD) + 5 : 0) + 0.2 * Math.min(minD, 2);
    if (sc > bs) { bs = sc; best = a; }
  }
  return best;
}
function fake(tiles, b, chs, exits, fk, t) {
  const live = chs.filter((c) => !c.dead), dir = (e) => { const dx = e.p.x - b.x, dy = e.p.y - b.y, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  // how much an exit's direction points at a chaser (1 = straight at one, -1 = straight away)
  const toward = (e, cs) => { const [dx, dy] = dir(e); let w = -1; for (const c of cs) { const cx = c.x - b.x, cy = c.y - b.y, l = Math.hypot(cx, cy) || 1; w = Math.max(w, (dx * cx + dy * cy) / l / Math.max(1, l)); } return w; };
  if (!fk.ex) fk.ex = exits.reduce((a, e) => (toward(e, live) < toward(a, live) ? e : a));
  // a chaser closing in: within 1.3 m and coming at the escaper faster than 0.8 m/s
  const close = live.filter((c) => { const dx = b.x - c.x, dy = b.y - c.y, d = Math.hypot(dx, dy); return d < 1.3 && ((c.vx - b.vx) * dx + (c.vy - b.vy) * dy) / (d || 1) > 0.8; });
  if (close.length && fk.cuts < 3 && t - fk.at >= 30) { const alt = exits.filter((e) => e !== fk.ex); if (alt.length) { fk.ex = alt.reduce((a, e) => (toward(e, close) < toward(a, close) ? e : a)); fk.cuts++; fk.at = t; } }
  return steerTo(tiles, fk.ex.F, b, fk.ex.p);
}
function deep(tiles, b, chs, R) {
  const live = chs.filter((c) => !c.dead); let best = 0, bs = -Infinity;
  const step = (s, a) => { const n = C.kin(s.x, s.y, s.vx, s.vy, a); if (C.wallAt(tiles, n[0], n[1])) { s.vx *= -0.3; s.vy *= -0.3; } else [s.x, s.y, s.vx, s.vy] = n; };
  const chase = (c, e) => { const d = Math.hypot(e.x - c.x, e.y - c.y), tau = Math.min(0.6, d / 2.5), tx = e.x + e.vx * tau, ty = e.y + e.vy * tau;
    const k = C.dirKey((tx - c.x) * 3 - c.vx, (ty - c.y) * 3 - c.vy); const n = C.kin(c.x, c.y, c.vx, c.vy, k); if (!C.wallAt(tiles, n[0], n[1])) [c.x, c.y, c.vx, c.vy] = n; else { c.vx = 0; c.vy = 0; } };
  for (let a = 0; a < 9; a++) {
    // first key: 8 ticks, shared by every second key
    const e0 = { ...b }, c0 = live.map((c) => ({ ...c })); let min0 = Infinity, out0 = 0;
    for (let t = 0; t < 8 && !out0; t++) { step(e0, a); for (const c of c0) { chase(c, e0); min0 = Math.min(min0, Math.hypot(c.x - e0.x, c.y - e0.y)); } if (R.out(e0.x, e0.y, c0)) out0 = t + 1; }
    let sa = -Infinity;
    for (let b2 = 0; b2 < 9; b2++) {
      const e = { ...e0 }, cs = c0.map((c) => ({ ...c })); let minD = min0, out = out0;
      for (let t = 8; t < 24 && !out; t++) { step(e, b2); for (const c of cs) { chase(c, e); minD = Math.min(minD, Math.hypot(c.x - e.x, c.y - e.y)); } if (R.out(e.x, e.y, cs)) out = t + 1; }
      const sc = (minD < 0.5 ? -60 : 0) + (out ? 100 - out : -3 * R.edge(e.x, e.y, cs)) + 0.5 * Math.min(minD, 2);
      if (out0 && b2 > 0) break; if (sc > sa) sa = sc;
    }
    if (sa > bs) { bs = sa; best = a; }
  }
  return best;
}

const GROUPS = [...ESCAPERS.kp.map((e) => ({ id: e, kind: 'kp', escaper: e })), ...ESCAPERS.wall.map((e) => ({ id: 'wall:' + e, kind: 'wall', escaper: e }))];
module.exports = { play, setup, ESCAPERS, GROUPS, LIMIT, REACT, BACK, OUT, QBAND, SEP };
