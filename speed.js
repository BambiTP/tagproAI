// speed.js - time versions of the planning bot on the same touch puzzles.
//   node speed.js <version> [first=101] [n=40]   (one JSON line per puzzle, then a summary line)
//   SEEDS=a,b,c node speed.js <version>         (those puzzles only)
// Live play needs each decision done before its moves run out: keep x 4 ticks = keep x 66.7 ms.
const { performance } = require('perf_hooks');
const F = require('./fastsearch'), N = require('./nav');
const NET = process.env.NET || 'net.json'; // the network for the versions that use one
let net = null; const getNet = () => (net = net || new (require('./net').Net)(NET));

const VERSIONS = {
  current: { old: true },                                  // nav.js search, width 16 depth 8 (as in watch.js)
  calm: {},                                                // shallower and narrower away from hazards
  prune: { prune: true },                                  // + only nearby keys after the first move
  keep2: { prune: true, keep: 2 },                         // + carry out 2 moves per plan
  multi: { prune: true, keep: 2, threads: 3 },             // + 3 threads
  multi1: { prune: true, threads: 3 },                     // 3 threads, replan every move
  live: { prune: true, keep: 2, threads: 3, budgetMs: 110 }, // multi with a time limit (leaves 23 ms spare)
  net: { net: true },                                      // the network alone: its top move, no search
  guided: { prune: true, keep: 2, guided: true },          // keep2 with the network's time-left estimate
};

async function run(seed, v) {
  const task = F.makeTask(seed, true), { sim, p } = F.startSim(task), keep = v.keep || 1;
  let search, pool;
  if (v.net) { const n = getNet(); search = () => { const q = p.body.GetPosition(), w = p.body.GetLinearVelocity(); return { line: [n.move(task, q.x, q.y, w.x, w.y)] }; }; }
  else if (v.guided) { const n = getNet(), s = F.makeSearch2({ ...v, est: (t, x, y, vx, vy) => n.ticksLeft(t, x, y, vx, vy) }); search = () => s(task, sim, p); }
  else if (v.old) { const s = N.makeSearch({ width: 16, depth: 8 }); search = () => ({ line: [s(task, sim, p)] }); }
  else if (v.threads) { pool = new F.Pool(v.threads); await pool.start(seed, true, v); }
  else { const s = F.makeSearch2(v); search = () => s(task, sim, p); }
  let plan = [], a = 0, ms = 0, worst = 0, decisions = 0, result = 'timeout', ticks = N.MAX_TICKS;
  for (let t = 0; t < N.MAX_TICKS; t++) {
    if (t % N.K === 0) {
      if (!plan.length) {
        const t0 = performance.now();
        sim.commit();
        const r = pool ? await pool.search() : search();
        const d = performance.now() - t0;
        ms += d; worst = Math.max(worst, d); decisions++;
        plan = r.line.slice(0, keep);
        if (pool) pool.advance(plan);
      }
      a = plan.shift();
    }
    N.setKeys(p, a); sim.tickOnce();
    if (p.dead) { result = 'pop'; ticks = t + 1; break; }
    const q = p.body.GetPosition();
    if (N.touched(task.goal, q.x, q.y)) { result = 'arrived'; ticks = t + 1; break; }
  }
  if (pool) await pool.close();
  return { seed, result, ticks, ms: Math.round(ms), worst: Math.round(worst), decisions };
}

(async () => {
  const [name = 'current', first = '101', n = '40'] = process.argv.slice(2);
  const v = VERSIONS[name];
  if (!v) throw new Error('versions: ' + Object.keys(VERSIONS).join(', '));
  const out = [];
  // SEEDS=1,2,3 runs exactly those puzzles instead of a range (e.g. the boost test)
  const list = process.env.SEEDS ? process.env.SEEDS.split(',').map(Number) : Array.from({ length: +n }, (_, i) => +first + i);
  for (const s of list) {
    if (s === 124) continue; // starts inside a gravity well's pull
    const r = await run(s, v); out.push(r); console.log(JSON.stringify(r));
  }
  const ok = out.filter((r) => r.result === 'arrived'), game = out.reduce((x, r) => x + r.ticks, 0) / 60;
  const ms = out.reduce((x, r) => x + r.ms, 0);
  console.log(JSON.stringify({ summary: name, puzzles: out.length, finished: ok.length,
    meanSecs: +(ok.reduce((x, r) => x + r.ticks, 0) / 60 / ok.length).toFixed(3),
    thinkPerGameSec: +(ms / 1000 / game).toFixed(2), worstDecisionMs: Math.max(...out.map((r) => r.worst)),
    budgetMs: Math.round((v.keep || 1) * 4000 / 60) }));
})();
