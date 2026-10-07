// dagger.js - corrections for the network at the places it actually drives to (DAgger: dataset aggregation).
//   node dagger.js <net.json> <first seed> <count> <out.bin>
// Copying the teacher's perfect runs leaves the network lost once it drifts off them (a slightly wrong
// approach to a boost and it never recovers). So: the network drives a puzzle; at up to 10 places along
// its own run (every 3rd decision) the teacher - the best of the four planning bots in gen2.js - plays on
// from that exact place, and its best result becomes a lesson: from here press this, and it takes this long.
// Only puzzles whose map has a usable boost are used (boost setups are the weakness), never the test ones.
// Rows use the boost-aware view (features2), same format as refeat.js output.
const fs = require('fs');
const N = require('./nav'), F = require('./fastsearch'), X = require('./features'), { Net } = require('./net');
const { getMap, PH } = require('./sim');

const ROW = X.SIZE2 + 4, KEEP = 2, EVERY = 3, MAX_Q = 10;
const TEACHERS = [
  { prune: true },
  { prune: true, boosts: { setup: 0.3, keep: 0.85 } },
  { prune: true, boosts: { setup: 0.8, keep: 0.85 } },
  { prune: true, boosts: { setup: 1.5, keep: 0.7 } },
];

function usable(task) {
  const T = getMap(task.key).tiles;
  let boost = false;
  for (let x = 0; x < T.length; x++) for (let y = 0; y < T[0].length; y++) {
    const v = parseFloat(T[x][y]);
    if (v === 5 || v === 14) boost = true;
    if (T[x][y] === 22) for (const p of [task.start, task.goal]) if (Math.hypot(p.x - x * N.TILE, p.y - y * N.TILE) <= PH.GRAVITY_WELL_RANGE) return false;
  }
  return boost;
}

// a fresh game with the network's first `ticks` key presses replayed: the exact place it got to
function replayTo(seed, keys, ticks) {
  const task = F.makeTask(seed, true), g = F.startSim(task);
  for (let t = 0; t < ticks; t++) { N.setKeys(g.p, keys[t]); g.sim.tickOnce(); }
  return { task, ...g };
}

// one teacher from tick `from` to the finish: its first move and the finish tick (or null)
function teach(seed, keys, from, opts) {
  const { task, sim, p } = replayTo(seed, keys, from), search = F.makeSearch2(opts);
  let plan = [], a = 0, first = null;
  for (let t = from; t < N.MAX_TICKS; t++) {
    if ((t - from) % N.K === 0) {
      if (!plan.length) { sim.commit(); plan = search(task, sim, p).line.slice(0, KEEP); }
      a = plan.shift(); if (first === null) first = a;
    }
    N.setKeys(p, a); sim.tickOnce();
    if (p.dead) return null;
    const q = p.body.GetPosition(); if (N.touched(task.goal, q.x, q.y)) return { first, end: t + 1 };
  }
  return null;
}

if (require.main === module) {
  const [netFile, firstSeed, count, out] = process.argv.slice(2);
  const net = new Net(netFile);
  for (let seed = +firstSeed; seed < +firstSeed + +count; seed++) {
    const task0 = F.makeTask(seed, true); if (!usable(task0)) continue;
    const t0 = Date.now();
    // 1. the network drives, every key and the ticks where it decided
    const { task, sim, p } = replayTo(seed, [], 0); net.tiles = sim.tiles;
    const keys = [], decisions = []; let a = 0, netEnd = null;
    for (let t = 0; t < N.MAX_TICKS; t++) {
      if (t % N.K === 0) { const q = p.body.GetPosition(), v = p.body.GetLinearVelocity(); a = net.move(task, q.x, q.y, v.x, v.y); decisions.push(t); }
      keys.push(a); N.setKeys(p, a); sim.tickOnce();
      if (p.dead) break;
      const q = p.body.GetPosition(); if (N.touched(task.goal, q.x, q.y)) { netEnd = t + 1; break; }
    }
    // 2. the teacher, from up to MAX_Q of the places the network reached
    const asks = decisions.filter((_, i) => i % EVERY === 0).slice(0, MAX_Q), rows = [];
    for (const from of asks) {
      let best = null;
      for (const opts of TEACHERS) { const r = teach(seed, keys, from, opts); if (r && (!best || r.end < best.end)) best = r; }
      if (!best) continue;
      const g = replayTo(seed, keys, from), q = g.p.body.GetPosition(), v = g.p.body.GetLinearVelocity();
      rows.push([X.features2(g.task, q.x, q.y, v.x, v.y, g.sim.tiles), best.first, (best.end - from) / 60, seed, from]);
    }
    const buf = new Float32Array(rows.length * ROW);
    rows.forEach((r, i) => { buf.set(r[0], i * ROW); buf.set([r[1], r[2], r[3], r[4]], i * ROW + X.SIZE2); });
    fs.appendFileSync(out, Buffer.from(buf.buffer));
    console.log(JSON.stringify({ seed, network: netEnd, corrections: rows.length, ms: Date.now() - t0 }));
  }
}
