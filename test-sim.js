// checks: determinism, save/restore fidelity (incl. wall contacts and boosts), speed
const { Sim, getMap, mapKeys, setKeys, PH } = require('./sim');

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

function run(map, seed, ticks, snapAt) {
  const sim = new Sim(map);
  const p = sim.addBall(1);
  const sp = sim.spawnTiles[1][0];
  sim.place(p, sp.x * PH.TILE, sp.y * PH.TILE);
  const r = rng(seed);
  let a = 0, snap = null, trace = [];
  for (let t = 0; t < ticks; t++) {
    if (t % 6 === 0) a = Math.floor(r() * 9);
    if (t === snapAt) snap = sim.save();
    setKeys(p, a); sim.tickOnce();
    const q = p.body.GetPosition();
    trace.push([q.x, q.y, p.dead ? 1 : 0]);
  }
  return { sim, p, snap, trace };
}

const keys = mapKeys().slice(0, 6);
let worst = 0, worstDet = 0;
for (const k of keys) {
  const map = getMap(k);
  for (let seed = 1; seed <= 5; seed++) {
    const A = run(map, seed, 600, -1), B = run(map, seed, 600, -1);
    for (let i = 0; i < 600; i++) worstDet = Math.max(worstDet, Math.hypot(A.trace[i][0] - B.trace[i][0], A.trace[i][1] - B.trace[i][1]));
    // fidelity: run 600, snapshot at 300, play 300 more with junk, restore, replay the same inputs
    const C = run(map, seed, 300, 299);
    // reference continuation
    const ref = A.trace;
    const { sim, p, snap } = C;
    const r2 = rng(999);
    for (let t = 0; t < 120; t++) { setKeys(p, Math.floor(r2() * 9)); sim.tickOnce(); }
    sim.restore(snap);
    // replay ticks 299..599 with seed's actions
    const r = rng(seed); let a = 0; const acts = [];
    for (let t = 0; t < 600; t++) { if (t % 6 === 0) a = Math.floor(r() * 9); acts.push(a); }
    for (let t = 299; t < 600; t++) {
      setKeys(p, acts[t]); sim.tickOnce();
      const q = p.body.GetPosition();
      if (ref[t][2] || p.dead) break;
      worst = Math.max(worst, Math.hypot(q.x - ref[t][0], q.y - ref[t][1]));
    }
  }
}
console.log('determinism max diff (m):', worstDet);
console.log('restore fidelity max diff over 5 s (px):', (worst * 100).toFixed(3));

// speed
const map = getMap(keys[0]);
const sim = new Sim(map); const p = sim.addBall(1);
const sp = sim.spawnTiles[1][0]; sim.place(p, sp.x * PH.TILE, sp.y * PH.TILE);
let t0 = Date.now(), n = 0;
while (Date.now() - t0 < 2000) { setKeys(p, n % 9); sim.tickOnce(); n++; }
console.log('ticks/s (1 ball):', Math.round(n / 2));
const s = sim.save(); t0 = Date.now(); n = 0;
while (Date.now() - t0 < 2000) { sim.restore(s); for (let i = 0; i < 6; i++) { setKeys(p, 3); sim.tickOnce(); } n++; }
console.log('restore+6 ticks per s:', Math.round(n / 2));
