// chase/team.js - two against two in the engine: the chaser and its nearest teammate against the flag carrier
// and its nearest teammate, all four played by the fast search, starting where the real players were in a chase
// puzzle (chase/extract.js). Balls really collide, so blocking happens through the physics.
//   node chase/team.js <chasing plan> <carrying plan> [first] [count]   -> chase/results/team-<a>-<b>.jsonl
// Chasing plans (the puzzle's chaser always intercepts):
//   both    the teammate intercepts too (cut the carrier off from two sides)
//   guard   the teammate goes to the carrier's flag and waits in front of it
//   rollout the teammate picks, every plan, among 9 targets (intercept, straight at the carrier, the carrier's flag,
//           points 2/4/6/8/11 tiles ahead on the carrier's route home) by simulating each 1.5 s ahead with everyone on
//           simple steering: the soonest touch wins, else the carrier furthest from capping and from its flag
// Carrying plans (the carrier always escapes: home, keeping away from both chasers):
//   alone   the teammate also heads for the carrier's flag (no blocking on purpose)
//   block   the teammate stays between the carrier and the nearer chaser, about a tile from the carrier
//   bump    the teammate goes at the chaser nearest the carrier, aiming where that chaser will be (like a chase
//           of its own), and touching it counts as done: the collision knocks it off its line
//   mark    the teammate stays just in front of the chaser nearest the carrier (half a metre towards the carrier,
//           where that chaser will be in 0.2 s), moving with it, so the chaser has to go round it
//   smart   mark, and the teammate's search also scores each line by how close the nearest chaser ends up to the
//           carrier (the other balls move in its lookahead, so a collision that throws a chaser off counts)
//   lever   the user's way: get between the chaser nearest the carrier and the carrier, right in front of the
//           chaser (the "leverage" spot, 0.42 m from it on its line to the carrier); once there, stop planning and
//           just mirror the chaser's movement (its velocity, plus a small pull back onto the spot). The spot moves
//           at the chaser's speed, so to get there the teammate heads for where the chaser will be by the time it
//           arrives (offset the same way), coming in ahead of the chaser rather than chasing it
//   lever2  lever, but only when it is on offer: the teammate is already between the chaser and the carrier (ahead
//           of the chaser along its line to the carrier, within 3 tiles of that line); otherwise it heads for the
//           flag like 'alone' instead of chasing a spot it cannot reach
//   lever3  lever2, and when leverage is not on offer but the teammate is not behind the chaser, it moves to get
//           between them (60% of the way from the chaser to the carrier) instead of heading home
//   rollout no rule about where to stand: every plan, try 12 ways of moving (11 spots fixed relative to the chaser
//           nearest the carrier, on and beside its line to the carrier at 0.42-1.5 m, plus heading home), simulate
//           each 1.5 s ahead with everyone on simple steering, and go for the one that turns out best for the carrier
//   pair    smart, and the carrier uses it: a chaser with the teammate between it and the carrier (within half a
//           metre of the line between them) does not count as a danger, so the carrier steers behind its blocker
// Each ball plans every 4 ticks and carries out 2 moves per plan; while one plans, the others keep their keys.
// Ends: a chaser touches the carrier or it pops (returned), the carrier reaches its flag (capped; flag assumed
// home), 8 s (held). A popped chaser or teammate just stays out.
const fs = require('fs'), path = require('path');
const N = require('../nav');
const F = require('../fastsearch');
const { Sim, getMap } = require('../sim');
const C = require('./run');

const DIR = path.join(__dirname, 'scenarios'), RES = path.join(__dirname, 'results');
const TOUCH = 2 * N.BALL_R + 0.005, CAP_R = 2 * N.BALL_R, TILE = N.TILE, LIMIT = 8 * 60;
const PLANS_A = ['both', 'guard', 'rollout'], PLANS_B = ['alone', 'block', 'bump', 'mark', 'smart', 'pair', 'lever', 'lever2', 'lever3', 'rollout'];
const tileOf = (v) => Math.round(v / TILE);
// four balls each search, so narrower and shallower than one ball's search (TEAM_W, TEAM_D to change)
// REACT=1: inside each ball's lookahead the other three steer by simple rules (chasers straight at the carrier, the
// carrier along its route home, its teammate at its marking spot) instead of keeping their keys
const REACT = !!+(process.env.REACT || 0);
// DELAY=<ticks>: every ball's keys take effect that many ticks after it decides them (human reaction time is about
// 12 ticks, 200 ms); a ball's first decision fills the gap at the start
const DELAY = +(process.env.DELAY || 0);
const SEARCH = { prune: true, adaptive: false, width: +(process.env.TEAM_W || 10), depth: +(process.env.TEAM_D || 6) };

function nearest(list, x, y) { let b = null, bd = Infinity; for (const o of list) { const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; b = o; } } return b; }

function game(s, planA, planB) {
  const g0 = s.ghost[0], g3 = s.ghost[Math.min(3, s.ghost.length - 1)], n3 = Math.min(3, s.ghost.length - 1) || 1;
  const mate = nearest(s.others.filter((o) => o.team === s.chaserTeam), g0[0], g0[1]);
  const escort = nearest(s.others.filter((o) => o.team === s.carrier.team), g0[0], g0[1]);
  if (!mate || !escort) return null;
  const spot = C.capSpot(s.tiles, s.carrier.team); if (!spot) return null;
  const sim = new Sim(getMap(s.key));
  for (let x = 0; x < s.tiles.length; x++) for (let y = 0; y < s.tiles[0].length; y++) {
    const v = s.tiles[x][y]; if (C.COPY.has(C.kind(v)) && String(v) !== String(sim.tiles[x][y])) sim.setTile(x, y, typeof v === 'string' ? v : +v, true);
  }
  const ch = sim.addBall(s.chaserTeam), m2 = sim.addBall(s.chaserTeam), ca = sim.addBall(s.carrier.team), es = sim.addBall(s.carrier.team);
  // JITTER=<metres>: nudge every start by that much (a fixed direction per ball), to measure how much chance alone changes
  const J = +(process.env.JITTER || 0);
  const cvx = (g3[0] - g0[0]) * 60 / n3, cvy = (g3[1] - g0[1]) * 60 / n3, cx0 = g0[0] - J;
  if (J) { s.chaser.x += J; mate.y += J; escort.y -= J; }
  sim.place(ch, s.chaser.x, s.chaser.y, s.chaser.vx, s.chaser.vy);
  sim.place(m2, mate.x, mate.y, mate.vx, mate.vy);
  sim.place(ca, cx0, g0[1], cvx, cvy);
  sim.place(es, escort.x, escort.y, escort.vx, escort.vy);
  const goalC = { x: spot[0] * TILE, y: spot[1] * TILE }, Fc = N.field(sim.tiles, spot[0], spot[1]);
  const search = F.makeSearch2(SEARCH);
  const pos = (p) => p.body.GetPosition(), vel = (p) => p.body.GetLinearVelocity();
  const chasers = [ch, m2], alive = (p) => !p.dead;
  const touching = () => chasers.some((c) => alive(c) && Math.hypot(pos(c).x - pos(ca).x, pos(c).y - pos(ca).y) < TOUCH);
  const ballTask = (gx, gy, extra) => ({ touch: true, goal: { x: gx, y: gy }, F: N.field(sim.tiles, tileOf(gx), tileOf(gy)), ...extra });
  // a chaser intercepting: finished on touching the carrier
  const intercept = (p) => {
    const q = pos(p), w = vel(p), r = pos(ca), rv = vel(ca);
    const [gx, gy] = C.aimPoint({ aim: 'route' }, sim.tiles, Fc, spot, { x: q.x, y: q.y, vx: w.x, vy: w.y }, [r.x, r.y], [rv.x, rv.y]);
    return ballTask(gx, gy, { doneAt: (x, y) => { const b = pos(ca); return Math.hypot(x - b.x, y - b.y) < TOUCH; } });
  };
  // a guard: to a tile in front of the carrier's flag (one tile towards the carrier), touching the carrier also counts
  const guard = () => {
    const r = pos(ca), dx = r.x - goalC.x, dy = r.y - goalC.y, L = Math.hypot(dx, dy) || 1;
    let gx = goalC.x + dx / L * TILE, gy = goalC.y + dy / L * TILE;
    if (!Fc.ok[tileOf(gx) * Fc.H + tileOf(gy)]) { gx = goalC.x; gy = goalC.y; }
    const t = ballTask(gx, gy, { doneAt: (x, y) => { const b = pos(ca); return Math.hypot(x - b.x, y - b.y) < TOUCH; } });
    if (Math.hypot(pos(m2).x - gx, pos(m2).y - gy) < 0.2) { t.goal = { x: r.x, y: r.y }; t.F = N.field(sim.tiles, tileOf(r.x), tileOf(r.y)); } // there: go at the carrier
    return t;
  };
  // the carrier's teammate is between chaser a and the point (x, y): within half a metre of the segment, not at its ends
  const shielded = (a, x, y) => { if (es.dead) return false; const b = pos(es), dx = x - a.x, dy = y - a.y, L2 = dx * dx + dy * dy || 1;
    const u = ((b.x - a.x) * dx + (b.y - a.y) * dy) / L2; if (u <= 0.1 || u >= 0.9) return false;
    return Math.hypot(a.x + u * dx - b.x, a.y + u * dy - b.y) < 0.5; };
  // the carrier: home, a touched line is lost, keep away from both chasers
  const carrierTask = { touch: true, goal: goalC, F: Fc, doneAt: (x, y) => Math.hypot(x - goalC.x, y - goalC.y) < CAP_R, lost: touching,
    extra: (x, y) => { let e = 0; for (const c of chasers) if (alive(c)) { const a = pos(c), d = Math.hypot(x - a.x, y - a.y);
      if (d < 1.2 && !(planB === 'pair' && shielded(a, x, y))) e += 30 * (1 - d / 1.2); } return e; } };
  // the escort: between the carrier and the nearer chaser, a tile from the carrier; or just towards the flag
  // rollout: candidate ways for the teammate to move, each a target recomputed from the current positions
  const H = 90, CANDS = [];
  for (const d of [0.42, 0.8, 1.5]) for (const side of [-0.6, 0, 0.6]) CANDS.push({ d, side });
  CANDS.push({ mid: true }, { nearCarrier: true }, { home: true });
  const nearestChaser = () => { const r = pos(ca), live = chasers.filter(alive); if (!live.length) return null;
    return live.reduce((a, b) => (Math.hypot(pos(a).x - r.x, pos(a).y - r.y) <= Math.hypot(pos(b).x - r.x, pos(b).y - r.y) ? a : b)); };
  const candTarget = (cd) => {
    const r = pos(ca), c = nearestChaser(); if (cd.home || !c) return [goalC.x, goalC.y];
    const cp = pos(c), dx = r.x - cp.x, dy = r.y - cp.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    if (cd.mid) return [cp.x + dx / 2, cp.y + dy / 2];
    if (cd.nearCarrier) return [r.x - ux * Math.min(0.6, L / 2), r.y - uy * Math.min(0.6, L / 2)];
    const d = Math.min(cd.d, L * 0.8); return [cp.x + ux * d - uy * cd.side, cp.y + uy * d + ux * cd.side];
  };
  const rolloutPick = () => {
    const root = sim.save(); let best = null, bestS = -Infinity;
    for (const cd of CANDS) {
      sim.restore(root); let score = null; const d0 = N.fieldAt(Fc, pos(ca).x, pos(ca).y);
      for (let t = 0; t < H && score == null; t++) {
        const r = pos(ca);
        for (const c of chasers) if (alive(c)) steer(c, r.x, r.y, null);
        if (alive(ca)) steer(ca, goalC.x, goalC.y, Fc);
        if (alive(es)) { const [x, y] = candTarget(cd); steer(es, x, y, null); }
        sim.tickOnce();
        if (ca.dead || touching()) score = -1000 + t;
        else if (Math.hypot(pos(ca).x - goalC.x, pos(ca).y - goalC.y) < CAP_R) score = 1000 - t;
      }
      if (score == null) { const r = pos(ca); let md = Infinity; for (const c of chasers) if (alive(c)) md = Math.min(md, Math.hypot(pos(c).x - r.x, pos(c).y - r.y));
        score = 10 * Math.min(md, 4) + 5 * (d0 - N.fieldAt(Fc, r.x, r.y)); }
      if (score > bestS) { bestS = score; best = cd; }
    }
    sim.restore(root); return best;
  };
  const escortTask = () => {
    if (planB === 'rollout') { const [x, y] = candTarget(rolloutPick()); return ballTask(x, y, { doneAt: () => false }); }
    if (planB === 'lever' || planB === 'lever2' || planB === 'lever3') {
      const r = pos(ca), live = chasers.filter(alive);
      if (!live.length) return ballTask(goalC.x, goalC.y, { doneAt: () => false });
      const c = live.reduce((a, b) => (Math.hypot(pos(a).x - r.x, pos(a).y - r.y) <= Math.hypot(pos(b).x - r.x, pos(b).y - r.y) ? a : b));
      const cp = pos(c), cv = vel(c), dx = r.x - cp.x, dy = r.y - cp.y, L = Math.hypot(dx, dy) || 1, k = Math.min(0.42, L / 2);
      const sx = cp.x + dx / L * k, sy = cp.y + dy / L * k, q = pos(es), w = vel(es);
      if (planB === 'lever2' || planB === 'lever3') { // on offer only from between the chaser and the carrier
        const along = ((q.x - cp.x) * dx + (q.y - cp.y) * dy) / L, side = Math.abs((q.x - cp.x) * dy - (q.y - cp.y) * dx) / L;
        if (!(along > 0 && along < L && side < 3 * TILE) && Math.hypot(q.x - sx, q.y - sy) >= 0.5) {
          if (planB === 'lever3' && along > 0) { // not behind the chaser: get between the two
            let gx = cp.x + dx * 0.6, gy = cp.y + dy * 0.6;
            if (!Fc.ok[tileOf(gx) * Fc.H + tileOf(gy)]) { gx = r.x; gy = r.y; }
            return ballTask(gx, gy, { doneAt: () => false });
          }
          return ballTask(goalC.x, goalC.y, { doneAt: () => false });
        }
      }
      if (Math.hypot(q.x - sx, q.y - sy) < 0.5) { // leverage: mirror the chaser, pulled back onto the spot
        let vx = cv.x + 4 * (sx - q.x), vy = cv.y + 4 * (sy - q.y); const V = Math.hypot(vx, vy); if (V > 3) { vx *= 3 / V; vy *= 3 / V; }
        const ex = vx - w.x, ey = vy - w.y, ax = Math.abs(ex) < 0.1 ? 0 : Math.sign(ex), ay = Math.abs(ey) < 0.1 ? 0 : Math.sign(ey);
        return { direct: N.ACTIONS.findIndex(([a, b]) => a === ax && b === ay) };
      }
      const [lx, ly] = C.leadPoint(Fc, { x: q.x, y: q.y, vx: w.x, vy: w.y }, [cp.x, cp.y], [cv.x, cv.y]);
      const ldx = r.x - lx, ldy = r.y - ly, LL = Math.hypot(ldx, ldy) || 1, kk = Math.min(0.42, LL / 2);
      let gx = lx + ldx / LL * kk, gy = ly + ldy / LL * kk;
      if (!Fc.ok[tileOf(gx) * Fc.H + tileOf(gy)]) { gx = sx; gy = sy; }
      return ballTask(gx, gy, { doneAt: () => false });
    }
    if (planB === 'alone') return ballTask(goalC.x, goalC.y, { doneAt: () => false });
    if (planB === 'mark' || planB === 'smart' || planB === 'pair') {
      const r = pos(ca), live = chasers.filter(alive);
      if (!live.length) return ballTask(goalC.x, goalC.y, { doneAt: () => false });
      const c = live.reduce((a, b) => (Math.hypot(pos(a).x - r.x, pos(a).y - r.y) <= Math.hypot(pos(b).x - r.x, pos(b).y - r.y) ? a : b));
      const cp = pos(c), cv = vel(c), dx = r.x - cp.x, dy = r.y - cp.y, L = Math.hypot(dx, dy) || 1, k = Math.min(0.5, L / 2);
      let gx = cp.x + cv.x * 0.2 + dx / L * k, gy = cp.y + cv.y * 0.2 + dy / L * k;
      if (!Fc.ok[tileOf(gx) * Fc.H + tileOf(gy)]) { gx = cp.x + dx / L * k; gy = cp.y + dy / L * k; }
      // smart: up to 40 extra ticks when a chaser ends the line on top of the carrier, none from 3 m away
      const danger = () => { const b = pos(ca); let d = Infinity; for (const h of chasers) if (alive(h)) d = Math.min(d, Math.hypot(pos(h).x - b.x, pos(h).y - b.y)); return d < 3 ? 40 * (1 - d / 3) : 0; };
      return ballTask(gx, gy, { doneAt: () => false, ...(planB === 'smart' || planB === 'pair' ? { extra: danger } : {}) });
    }
    if (planB === 'bump') {
      const r = pos(ca), live = chasers.filter(alive);
      if (!live.length) return ballTask(goalC.x, goalC.y, { doneAt: () => false });
      const c = live.reduce((a, b) => (Math.hypot(pos(a).x - r.x, pos(a).y - r.y) <= Math.hypot(pos(b).x - r.x, pos(b).y - r.y) ? a : b));
      const q = pos(es), w = vel(es), cp = pos(c), cv = vel(c);
      const [gx, gy] = C.leadPoint(Fc, { x: q.x, y: q.y, vx: w.x, vy: w.y }, [cp.x, cp.y], [cv.x, cv.y]);
      return ballTask(gx, gy, { doneAt: (x, y) => { const b = pos(c); return Math.hypot(x - b.x, y - b.y) < TOUCH; } });
    }
    const r = pos(ca), c = nearest(chasers.filter(alive).map((p) => ({ x: pos(p).x, y: pos(p).y })), r.x, r.y) || goalC;
    const dx = c.x - r.x, dy = c.y - r.y, L = Math.hypot(dx, dy) || 1, k = Math.min(L * 0.6, 1.2);
    let gx = r.x + dx / L * k, gy = r.y + dy / L * k;
    if (!Fc.ok[tileOf(gx) * Fc.H + tileOf(gy)]) { gx = r.x; gy = r.y; }
    return ballTask(gx, gy, { doneAt: () => false });
  };
  // simple steering: full speed towards (tx, ty), or along the route field F when the line is blocked
  const steer = (p, tx, ty, F) => {
    const q = pos(p), w = vel(p); let ux = tx - q.x, uy = ty - q.y;
    if (F && !N.clearLine(F, q.x, q.y, tx, ty)) [ux, uy] = N.pathDir(F, q.x, q.y);
    const L = Math.hypot(ux, uy) || 1, ex = ux / L * 2.5 - w.x, ey = uy / L * 2.5 - w.y;
    N.setKeys(p, N.ACTIONS.findIndex(([a, b]) => a === (Math.abs(ex) < 0.1 ? 0 : Math.sign(ex)) && b === (Math.abs(ey) < 0.1 ? 0 : Math.sign(ey))));
  };
  const markSpot = () => {
    const r = pos(ca), live = chasers.filter(alive); if (!live.length) return [goalC.x, goalC.y];
    const c = live.reduce((a, b) => (Math.hypot(pos(a).x - r.x, pos(a).y - r.y) <= Math.hypot(pos(b).x - r.x, pos(b).y - r.y) ? a : b)), cp = pos(c);
    const dx = r.x - cp.x, dy = r.y - cp.y, L = Math.hypot(dx, dy) || 1, k = Math.min(0.5, L / 2); return [cp.x + dx / L * k, cp.y + dy / L * k];
  };
  const react = (me) => {
    const r = pos(ca);
    for (const c of chasers) if (c !== me && alive(c)) steer(c, r.x, r.y, null);
    if (ca !== me && alive(ca)) steer(ca, goalC.x, goalC.y, Fc);
    if (es !== me && alive(es)) { if (planB === 'alone') steer(es, goalC.x, goalC.y, Fc); else { const [x, y] = markSpot(); steer(es, x, y, null); } }
  };
  const withReact = (task) => (REACT ? { ...task, react } : task);
  const plans = new Map(), keys = new Map(), lag = new Map();
  // rollout for the chaser's teammate: targets as functions of the current positions
  const MATE = [
    () => { const q = pos(m2), w = vel(m2), r = pos(ca), rv = vel(ca); return C.aimPoint({ aim: 'route' }, sim.tiles, Fc, spot, { x: q.x, y: q.y, vx: w.x, vy: w.y }, [r.x, r.y], [rv.x, rv.y]); },
    () => { const r = pos(ca); return [r.x, r.y]; },
    () => [goalC.x, goalC.y],
    ...[2, 4, 6, 8, 11].map((n) => () => { const r = pos(ca), rt = C.routeHome(Fc, r.x, r.y, n); const e = rt[rt.length - 1]; return [e[0] * TILE, e[1] * TILE]; }),
  ];
  const escortSteer = () => { if (!alive(es)) return; if (planB === 'alone' || planB === 'rollout') steer(es, goalC.x, goalC.y, Fc); else { const [x, y] = markSpot(); steer(es, x, y, null); } };
  const matePick = () => {
    const root = sim.save(); let best = 0, bestS = -Infinity;
    MATE.forEach((target, i) => {
      sim.restore(root); let score = null; const d0 = N.fieldAt(Fc, pos(ca).x, pos(ca).y);
      for (let t = 0; t < H && score == null; t++) {
        const r = pos(ca);
        if (alive(ch)) steer(ch, r.x, r.y, null);
        if (alive(m2)) { const [x, y] = target(); steer(m2, x, y, Fc); }
        if (alive(ca)) steer(ca, goalC.x, goalC.y, Fc);
        escortSteer();
        sim.tickOnce();
        if (ca.dead || touching()) score = 1000 - t;
        else if (Math.hypot(pos(ca).x - goalC.x, pos(ca).y - goalC.y) < CAP_R) score = -1000 + t;
      }
      if (score == null) { const r = pos(ca); let md = Infinity; for (const c of chasers) if (alive(c)) md = Math.min(md, Math.hypot(pos(c).x - r.x, pos(c).y - r.y));
        score = -10 * Math.min(md, 4) - 5 * (d0 - N.fieldAt(Fc, r.x, r.y)); }
      if (score > bestS) { bestS = score; best = i; }
    });
    sim.restore(root);
    const [gx, gy] = MATE[best]();
    return ballTask(gx, gy, { doneAt: (x, y) => { const b = pos(ca); return Math.hypot(x - b.x, y - b.y) < TOUCH; } });
  };
  const roles = [[ch, () => intercept(ch)], [m2, () => (planA === 'guard' ? guard() : planA === 'rollout' ? matePick() : intercept(m2))], [ca, () => carrierTask], [es, escortTask]];
  let ms = 0;
  const trace = [];
  const done = (result, t) => ({ id: s.id, result, ticks: t, ms: Math.round(ms), mate: mate.id, escort: escort.id, path: trace });
  for (let t = 0; t < LIMIT; t++) {
    if (t % N.K === 0) {
      sim.commit();
      const t0 = performance.now();
      for (const [p, task] of roles) {
        if (p.dead) { keys.set(p, 0); continue; }
        let pl = plans.get(p) || [];
        if (!pl.length) { const tk = task(); pl = tk.direct != null ? [tk.direct] : search(withReact(tk), sim, p).line.slice(0, 2); }
        const k = pl.shift(); plans.set(p, pl);
        if (!DELAY) keys.set(p, k);
        else { // a queue of decisions, one per 4 ticks, applied DELAY ticks late
          const q = lag.get(p) || Array(Math.ceil(DELAY / N.K)).fill(k); q.push(k); keys.set(p, q.shift()); lag.set(p, q); }
      }
      ms += performance.now() - t0;
    }
    for (const [p] of roles) if (!p.dead) N.setKeys(p, keys.get(p));
    sim.tickOnce();
    trace.push(roles.map(([p]) => { const q = pos(p); return p.dead ? null : [+q.x.toFixed(3), +q.y.toFixed(3)]; }));
    if (ca.dead) return done('returned', t + 1);
    if (touching()) return done('returned', t + 1);
    const b = pos(ca); if (Math.hypot(b.x - goalC.x, b.y - goalC.y) < CAP_R) return done('capped', t + 1);
  }
  return done('held', LIMIT);
}

if (require.main === module) {
  const [a = 'both', b = 'block', first = '0', count = '50'] = process.argv.slice(2);
  if (!PLANS_A.includes(a) || !PLANS_B.includes(b)) throw new Error('chasing plans: ' + PLANS_A.join(', ') + '; carrying plans: ' + PLANS_B.join(', '));
  fs.mkdirSync(RES, { recursive: true });
  const ids = (process.env.IDS ? process.env.IDS.split(',') : fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort())
    .slice(+first, +first + +count);
  const out = fs.openSync(path.join(RES, `team-${a}-${b}${process.env.TAG || ''}.jsonl`), 'a');
  for (const id of ids) {
    const s = JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8'));
    const r = game(s, a, b); if (!r) continue;
    r.real = s.outcome; r.startDist = s.startDist;
    fs.writeSync(out, JSON.stringify(r) + '\n');
    if (process.env.VERBOSE) console.log(id, r.result, (r.ticks / 60).toFixed(2) + 's', 'real:', r.real, r.ms + 'ms');
  }
}
module.exports = { game, PLANS_A, PLANS_B };
