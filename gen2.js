// gen2.js - record training lessons from the best of several planning bots on each puzzle.
//   node gen2.js <first seed> <count> <out.bin>
// Each puzzle is played by the planning bot (pruned, 2 moves per plan) without boost shortcuts and with
// three boost settings; only the fastest finish becomes lessons. No single boost setting is best
// everywhere, but the best of the four beat plain planning by ~15% on the boost test, and those boost
// routes are what the network couldn't learn from a few human runs. Same row format as gen.js.
const fs = require('fs');
const N = require('./nav'), F = require('./fastsearch'), X = require('./features');
const { getMap, PH } = require('./sim');

const ROW = X.SIZE + 4, KEEP = 2;
const VARIANTS = [
  { name: 'no boosts', opts: { prune: true } },
  { name: 'boosts 0.3/0.85', opts: { prune: true, boosts: { setup: 0.3, keep: 0.85 } } },
  { name: 'boosts 0.8/0.85', opts: { prune: true, boosts: { setup: 0.8, keep: 0.85 } } },
  { name: 'boosts 1.5/0.7', opts: { prune: true, boosts: { setup: 1.5, keep: 0.7 } } },
];

function inWell(task) {
  const T = getMap(task.key).tiles;
  for (let x = 0; x < T.length; x++) for (let y = 0; y < T[0].length; y++) {
    if (T[x][y] !== 22) continue;
    for (const p of [task.start, task.goal]) if (Math.hypot(p.x - x * N.TILE, p.y - y * N.TILE) <= PH.GRAVITY_WELL_RANGE) return true;
  }
  return false;
}

// one variant's run: its lessons and when it finished (-1 if it didn't)
function play(seed, opts) {
  const task = F.makeTask(seed, true), { sim, p } = F.startSim(task), search = F.makeSearch2(opts), rows = [];
  let plan = [], a = 0, end = -1;
  for (let t = 0; t < N.MAX_TICKS && end < 0; t++) {
    if (t % N.K === 0) {
      const q = p.body.GetPosition(), v = p.body.GetLinearVelocity();
      const f = X.features(task, q.x, q.y, v.x, v.y);
      if (!plan.length) { sim.commit(); plan = search(task, sim, p).line.slice(0, KEEP); }
      a = plan.shift();
      rows.push({ f, a, t });
    }
    N.setKeys(p, a); sim.tickOnce();
    if (p.dead) break;
    const q = p.body.GetPosition();
    if (N.touched(task.goal, q.x, q.y)) end = t + 1;
  }
  return { rows, end };
}

if (require.main === module) {
  const [first, count, out] = process.argv.slice(2);
  for (let seed = +first; seed < +first + +count; seed++) {
    if (inWell(F.makeTask(seed, true))) continue;
    const t0 = Date.now(), runs = VARIANTS.map((v) => ({ name: v.name, ...play(seed, v.opts) }));
    const done = runs.filter((r) => r.end > 0).sort((a, b) => a.end - b.end);
    const times = Object.fromEntries(runs.map((r) => [r.name, r.end > 0 ? r.end : null]));
    if (!done.length) { console.log(JSON.stringify({ seed, result: 'none finished', times })); continue; }
    const best = done[0], buf = new Float32Array(best.rows.length * ROW);
    best.rows.forEach((r, i) => { buf.set(r.f, i * ROW); buf.set([r.a, (best.end - r.t) / 60, seed, r.t], i * ROW + X.SIZE); });
    fs.appendFileSync(out, Buffer.from(buf.buffer));
    console.log(JSON.stringify({ seed, ticks: best.end, rows: best.rows.length, by: best.name, times, ms: Date.now() - t0 }));
  }
}
