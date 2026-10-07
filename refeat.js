// refeat.js - rebuild recorded lessons with the version-2 (boost-aware) view by replaying the runs.
//   node refeat.js <in.bin> <out.bin> [copies=1]
// gen.js and gen2.js lessons hold the move made every 4 ticks, and the engine is deterministic, so each
// recorded run replays exactly: hold each move for 4 ticks and the ball retraces its path. Every replay is
// checked to finish on the recorded tick; any that doesn't is left out. `copies` repeats every lesson
// (to weight a set more heavily in training).
const fs = require('fs');
const N = require('./nav'), F = require('./fastsearch'), X = require('./features');

const ROW1 = X.SIZE + 4, ROW2 = X.SIZE2 + 4;
const [inp, out, copies = '1'] = process.argv.slice(2);
const b = fs.readFileSync(inp), rows = Math.floor(b.length / 4 / ROW1);
const all = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + rows * ROW1 * 4));
const at = (i, k) => all[i * ROW1 + X.SIZE + k]; // 0 move, 1 seconds left, 2 seed, 3 tick

let i = 0, kept = 0, bad = 0, written = 0;
const fd = fs.openSync(out, 'w');
while (i < rows) {
  const seed = at(i, 2); let j = i;
  while (j < rows && at(j, 2) === seed && (j === i || at(j, 3) > at(j - 1, 3))) j++;
  // replay this run [i, j)
  const task = F.makeTask(seed, true), { sim, p } = F.startSim(task), end = Math.round(at(i, 1) * 60 + at(i, 3));
  const outRows = []; let tick = 0, finished = -1;
  for (let r = i; r < j && finished < 0; r++) {
    if (at(r, 3) !== tick) break;
    const q = p.body.GetPosition(), v = p.body.GetLinearVelocity();
    outRows.push([X.features2(task, q.x, q.y, v.x, v.y, sim.tiles), at(r, 0), at(r, 1), seed, tick]);
    N.setKeys(p, at(r, 0));
    for (let k = 0; k < N.K && finished < 0; k++) {
      sim.tickOnce(); tick++;
      if (p.dead) { finished = 0; break; }
      const qq = p.body.GetPosition(); if (N.touched(task.goal, qq.x, qq.y)) finished = tick;
    }
  }
  if (finished === end && outRows.length === j - i) {
    const buf = new Float32Array(outRows.length * ROW2);
    outRows.forEach((r, n) => { buf.set(r[0], n * ROW2); buf.set([r[1], r[2], r[3], r[4]], n * ROW2 + X.SIZE2); });
    for (let c = 0; c < +copies; c++) fs.writeSync(fd, Buffer.from(buf.buffer));
    kept++; written += outRows.length * +copies;
  } else bad++;
  i = j;
}
fs.closeSync(fd);
console.log(JSON.stringify({ in: inp, runs: kept, mismatched: bad, lessons: written }));
