// fastsearch.js - cheaper and multi-core versions of nav.js's search, aiming at live play.
// The same beam search, with savings that can each be switched on or off:
//  - calm: away from hazards (spikes, boosts, gates, bombs, portals, wells) search shallower and narrower
//  - prune: past the first move, only try keys close to the line's previous key
//  - keep: carry out the first `keep` moves of a plan before searching again (one ball, no opponents:
//    the plan plays out exactly as simulated)
//  - Pool: split the first moves across worker threads, each with its own copy of the game in lockstep
//  - budgetMs: a time limit per decision; when it runs out, go with the best line found so far
//  - est: a different time-left estimate, est(task, x, y, vx, vy) in ticks (e.g. a trained network)
const { isMainThread, parentPort, Worker, workerData } = require('worker_threads');
const N = require('./nav');
const { Sim, getMap, setKeys } = require('./sim');

const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8];
// keys close to a: none, the same, the two neighbours on the ring of 8 directions, and the reverse
const ring = (a) => ((a - 1 + 8) % 8) + 1;
const NEAR = ALL.map((a) => (a === 0 ? ALL : [0, a, ring(a - 1), ring(a + 1), ring(a + 4)]));

function isHazard(v) {
  const f = Math.floor(v);
  return v === 7 || f === 5 || f === 14 || f === 15 || f === 9 || f === 10 || f === 13 || v === 22 || f === 24 || f === 25;
}
const hzCache = new WeakMap();
function hazards(tiles) {
  if (!hzCache.has(tiles)) {
    const out = [];
    for (let x = 0; x < tiles.length; x++) for (let y = 0; y < tiles[0].length; y++)
      if (isHazard(parseFloat(tiles[x][y]))) out.push([x * N.TILE, y * N.TILE]);
    hzCache.set(tiles, out);
  }
  return hzCache.get(tiles);
}
// calm: no hazard within 2.5 tiles plus 0.8 s of travel at the current speed
function calmAt(hz, x, y, vx, vy) {
  const R = 1.0 + Math.hypot(vx, vy) * 0.8;
  for (const [hx, hy] of hz) if (Math.abs(hx - x) < R && Math.abs(hy - y) < R && Math.hypot(hx - x, hy - y) < R) return false;
  return true;
}

// returns { line, f }: the best line of keys found and its estimated total ticks
function makeSearch2({ width = 16, depth = 8, calmWidth = 8, calmDepth = 4, adaptive = true, prune = false, budgetMs = Infinity, est: estOverride = null } = {}) {
  return function search(task, sim, p, firsts = ALL) {
    const deadline = performance.now() + budgetMs;
    let out = false;
    const done_ = N.goalCheck(task), hand = task.touch ? N.heuristicTouch : N.heuristic;
    const est = estOverride ? (F_, g_, x, y, vx, vy) => estOverride(task, x, y, vx, vy) : hand;
    const q0 = p.body.GetPosition(), v0 = p.body.GetLinearVelocity();
    const calm = adaptive && calmAt(hazards(task.F.tiles), q0.x, q0.y, v0.x, v0.y);
    const W = calm ? calmWidth : width, D = calm ? calmDepth : depth;
    const root = sim.save();
    let beam = [{ s: root, g: 0, line: [] }], bestDone = null, bestLeaf = null;
    for (let lvl = 0; lvl < D && beam.length; lvl++) {
      const kids = [];
      for (const n of beam) {
        // the beam is best-first, so stopping part-way still keeps the most promising lines
        if (performance.now() > deadline) { out = true; break; }
        const acts = lvl === 0 ? firsts : prune ? NEAR[n.line[n.line.length - 1]] : ALL;
        for (const a of acts) {
          sim.restore(n.s);
          setKeys(p, a);
          let done = false, t = 0;
          for (; t < N.K; t++) {
            sim.tickOnce();
            if (p.dead) break;
            const q = p.body.GetPosition(), v = p.body.GetLinearVelocity();
            if (done_(task.goal, q.x, q.y, v.x, v.y)) { done = true; t++; break; }
          }
          if (p.dead) continue;
          const g = n.g + t, line = n.line.concat(a);
          if (done) { if (!bestDone || g < bestDone.g) bestDone = { g, line }; continue; }
          const q = p.body.GetPosition(), v = p.body.GetLinearVelocity();
          const f = g + est(task.F, task.goal, q.x, q.y, v.x, v.y);
          if (bestDone && f >= bestDone.g) continue;
          const cell = Math.round(q.x / 0.04) + ',' + Math.round(q.y / 0.04) + ',' + Math.round(v.x / 0.1) + ',' + Math.round(v.y / 0.1);
          const st = sim.save();
          sim.tickOnce(); // a state already overlapping a spike pops next tick whatever the keys
          if (p.dead) continue;
          kids.push({ f, g, line, cell, s: st });
        }
      }
      kids.sort((u, w) => u.f - w.f);
      const seen = new Set(), next = [], firstsSeen = new Set();
      for (const k of kids) if (!firstsSeen.has(k.line[0])) { firstsSeen.add(k.line[0]); seen.add(k.cell); next.push(k); }
      for (const k of kids) {
        if (next.length >= W) break;
        if (seen.has(k.cell)) continue;
        seen.add(k.cell); next.push(k);
      }
      next.sort((u, w) => u.f - w.f);
      beam = next;
      if (beam.length) bestLeaf = beam[0];
      if (out) break;
    }
    sim.restore(root);
    if (bestDone && (!bestLeaf || bestDone.g <= bestLeaf.f)) return { line: bestDone.line, f: bestDone.g };
    return bestLeaf ? { line: bestLeaf.line, f: bestLeaf.f } : { line: [0], f: Infinity };
  };
}

// a puzzle as the bots see it
function makeTask(seed, touch) { const t = N.makeTask(seed, N.mapKeys()); t.touch = touch; return t; }
function startSim(task) {
  const sim = new Sim(getMap(task.key)), p = sim.addBall(1);
  sim.place(p, task.start.x, task.start.y, task.start.vx, task.start.vy);
  return { sim, p };
}
function advance(sim, p, a) { setKeys(p, a); for (let t = 0; t < N.K; t++) sim.tickOnce(); }

// ---------- multi-core: each worker searches lines starting with its share of the first moves ----------
if (!isMainThread && workerData && workerData.fastsearch) {
  let task, sim, p, search;
  parentPort.on('message', (m) => {
    if (m.type === 'start') {
      task = makeTask(m.seed, m.touch); ({ sim, p } = startSim(task));
      search = makeSearch2(m.opts);
      parentPort.postMessage('ready');
    } else if (m.type === 'advance') {
      for (const a of m.actions) advance(sim, p, a);
    } else if (m.type === 'search') {
      sim.commit();
      parentPort.postMessage(search(task, sim, p, m.firsts));
    }
  });
}

class Pool {
  constructor(n = 3) {
    this.ws = [];
    for (let i = 0; i < n; i++) this.ws.push(new Worker(__filename, { workerData: { fastsearch: true } }));
    // first moves dealt round robin; each worker's beam width scaled to its share
    this.firsts = this.ws.map((_, i) => ALL.filter((a) => a % n === i));
  }
  // resolves once every worker has loaded the engine and the map
  start(seed, touch, opts) {
    return Promise.all(this.ws.map((w, i) => new Promise((res) => {
      const share = this.firsts[i].length / 9, sc = (x) => Math.max(2, Math.ceil(x * share));
      w.once('message', res);
      w.postMessage({ type: 'start', seed, touch, opts: { ...opts, width: sc(opts.width || 16), calmWidth: sc(opts.calmWidth || 8) } });
    })));
  }
  advance(actions) { for (const w of this.ws) w.postMessage({ type: 'advance', actions }); }
  search() {
    return Promise.all(this.ws.map((w, i) => new Promise((res) => {
      w.once('message', res); w.postMessage({ type: 'search', firsts: this.firsts[i] });
    }))).then((rs) => rs.reduce((a, b) => (b.f < a.f ? b : a)));
  }
  close() { return Promise.all(this.ws.map((w) => w.terminate())); }
}

module.exports = { makeSearch2, Pool, makeTask, startSim, advance, hazards, calmAt, ALL };
