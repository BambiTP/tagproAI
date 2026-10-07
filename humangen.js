// humangen.js - turn people's best runs into training lessons, in the same format as gen.js.
//   node humangen.js <out.bin>
// Sources: the private page's best runs (runs/touch/human.json) and the puzzle site's (runs/arena/best/*).
// A run is replayed in the engine (its frames hold the key pressed each tick) and gives a lesson every
// 4 ticks: the situation, the key held next, and the seconds it still took. Kept out:
//  - runs slower than the planning bot (they'd teach worse driving)
//  - the test puzzles (101-140), so test results stay fair
//  - the "boost test": puzzles where a person beat every bot by 4%+ and the seed is a multiple of 3, to
//    check whether the network learns boost routes it never saw
// Runs that beat every bot by 4%+ (mostly boost routes) count 3 times. Human rows are marked by a seed
// ending in .5, which train.js never holds out (it holds out seeds ending in 0).
const fs = require('fs'), path = require('path');
const N = require('./nav'), F = require('./fastsearch'), X = require('./features');

const V2 = process.env.FEAT === '2'; // FEAT=2: the boost-aware view (features2)
const SIZE = V2 ? X.SIZE2 : X.SIZE, ROW = SIZE + 4, WEIGHT = 3, BEAT = 1.04;
const BOTS = 'runs/touch/bots', EXTRA = 'runs/touch/extra';
const isTest = (s) => s >= 101 && s <= 140;

function bestBot(seed) {
  const f = path.join(BOTS, seed + '.json'); if (!fs.existsSync(f)) return null;
  const b = JSON.parse(fs.readFileSync(f, 'utf8')), xf = path.join(EXTRA, seed + '.json');
  const x = fs.existsSync(xf) ? JSON.parse(fs.readFileSync(xf, 'utf8')) : {};
  const ok = [b.search, b.baseline, x.fast, x.net, x.guided].filter((r) => r && r.result === 'arrived').map((r) => r.ticks);
  return { planning: b.search.result === 'arrived' ? b.search.ticks : null, best: ok.length ? Math.min(...ok) : null };
}
const boostTest = (seed, ticks) => { const b = bestBot(seed); return !!b && b.best && b.best / ticks >= BEAT && seed % 3 === 0; };

// every source run: { seed, frames, who }
function sources() {
  const out = [], h = JSON.parse(fs.readFileSync('runs/touch/human.json', 'utf8'));
  for (const [s, b] of Object.entries(h.best)) out.push({ seed: +s, frames: b.frames, who: 'private page' });
  const dir = 'runs/arena/best';
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) {
    for (const [s, frames] of Object.entries(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))) out.push({ seed: +s, frames, who: 'site:' + f.replace('.json', '') });
  }
  return out;
}

if (require.main === module) {
  const out = process.argv[2]; if (!out) throw new Error('usage: node humangen.js <out.bin>');
  const rows = [], why = {}, count = (k) => { why[k] = (why[k] || 0) + 1; };
  for (const src of sources()) {
    const { seed, frames } = src, ticks = frames.length, b = bestBot(seed);
    if (isTest(seed)) { count('test puzzle'); continue; }
    if (!b) { count('no bot runs'); continue; }
    if (b.planning && ticks > b.planning) { count('slower than the planning bot'); continue; }
    if (boostTest(seed, ticks)) { count('held back for the boost test'); continue; }
    // replay the keys, checking the run still ends at the same tick
    const task = F.makeTask(seed, true), { sim, p } = F.startSim(task), lessons = [];
    let end = -1;
    for (let t = 0; t < ticks; t++) {
      const k = frames[t][2];
      if (t % N.K === 0) { const q = p.body.GetPosition(), v = p.body.GetLinearVelocity(); lessons.push({ f: V2 ? X.features2(task, q.x, q.y, v.x, v.y, sim.tiles) : X.features(task, q.x, q.y, v.x, v.y), a: k, t }); }
      N.setKeys(p, k); sim.tickOnce();
      if (p.dead) break;
      const q = p.body.GetPosition(); if (N.touched(task.goal, q.x, q.y)) { end = t + 1; break; }
    }
    if (end !== ticks) { count('replay did not match'); continue; }
    const w = b.best && b.best / ticks >= BEAT ? WEIGHT : 1;
    count(w > 1 ? 'used, beats every bot (x3)' : 'used');
    for (let i = 0; i < w; i++) for (const l of lessons) rows.push([l.f, l.a, (end - l.t) / 60, seed + 0.5, l.t]);
  }
  const buf = new Float32Array(rows.length * ROW);
  rows.forEach((r, i) => { buf.set(r[0], i * ROW); buf.set([r[1], r[2], r[3], r[4]], i * ROW + SIZE); });
  fs.writeFileSync(out, Buffer.from(buf.buffer));
  console.log(JSON.stringify({ rows: rows.length, ...why }));
}
module.exports = { boostTest, bestBot };
