// gen.js - record the planning bot's decisions as training data for the network.
//   node gen.js <first seed> <count> <out.bin>
// Each row (Float32): features, then the move made, seconds left until the ball touched the goal,
// the puzzle seed and the tick. Only puzzles the bot finished are kept (seconds left is known).
const fs = require('fs');
const N = require('./nav'), F = require('./fastsearch'), X = require('./features');
const { getMap, PH } = require('./sim');

const ROW = X.SIZE + 4;
const search = F.makeSearch2({ prune: true }), KEEP = 2; // the "keep2" teacher from speed.js

// a gravity well out-pulls the keys almost everywhere in its range (see watch.js)
function inWell(task) {
  const T = getMap(task.key).tiles;
  for (let x = 0; x < T.length; x++) for (let y = 0; y < T[0].length; y++) {
    if (T[x][y] !== 22) continue;
    for (const p of [task.start, task.goal]) if (Math.hypot(p.x - x * N.TILE, p.y - y * N.TILE) <= PH.GRAVITY_WELL_RANGE) return true;
  }
  return false;
}

const [first, count, out] = process.argv.slice(2);
for (let seed = +first; seed < +first + +count; seed++) {
  const task = F.makeTask(seed, true);
  if (inWell(task)) continue;
  const { sim, p } = F.startSim(task);
  const rows = [];
  let plan = [], a = 0, end = -1;
  const t0 = Date.now();
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
  if (end < 0) { console.log(JSON.stringify({ seed, result: p.dead ? 'pop' : 'timeout' })); continue; }
  const buf = new Float32Array(rows.length * ROW);
  rows.forEach((r, i) => { buf.set(r.f, i * ROW); buf.set([r.a, (end - r.t) / 60, seed, r.t], i * ROW + X.SIZE); });
  fs.appendFileSync(out, Buffer.from(buf.buffer));
  console.log(JSON.stringify({ seed, ticks: end, rows: rows.length, ms: Date.now() - t0 }));
}
