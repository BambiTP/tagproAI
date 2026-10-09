// chase/killtest.js - how sure is a "certain kill"? A chaser holds one key (a straight or diagonal line) and never
// lets go; the carrier keeps pressing its current direction for its reaction time, then may press any of the 9 key
// choices (any direction, or nothing) for the rest. The kill is certain only if every choice ends in a touch.
// Ground truth: the real engine. Fast check: plain motion maths (drag, push up to top speed, no collisions), which is
// what a chaser can afford every few ticks. This samples random distances, speeds and directions on open floor and
// records both answers, so the fast check can be tuned until it never claims a kill that isn't one.
//   node chase/killtest.js <samples> [seed]   -> appends to chase/results/killtest.jsonl (random setups)
//   node chase/killtest.js grid [part] [parts] -> chase/results/killgrid[-part].csv: for every combination of carrier
//     and chaser speed (0-3 m/s by 0.25), each one's direction of travel (16 directions, 22.5 degrees apart, relative
//     to the line between them) and carrier reaction (0, 6, 12 ticks): the furthest distance (to 2 cm) at which some
//     chaser key pointing roughly at the carrier is a certain kill, by the engine and by the fast check (1 cm margin).
//     Columns: cs, ca (chaser direction, degrees from straight at the carrier), fs, fa (carrier direction, degrees from
//     straight away from the chaser), react, engine, fast (0 = no kill even touching distance away).
const fs = require('fs'), path = require('path');
const { Sim, getMap, setKeys, ACTIONS } = require('../sim');

const TOUCH = 0.38 + 0.005, MAX_T = 90, DT = 1 / 60, DAMP = 1 - 0.5 / 60, ACC = 0.025, MS = 2.5;
const REACTS = [0, 6, 12]; // carrier reaction times tested (ticks): instant, 100 ms, 200 ms

// an open arena: 40 x 40 tiles of floor inside a wall, built from a real map object so the engine accepts it
function arena() {
  const m = JSON.parse(JSON.stringify(getMap('74724')));
  const W = 40, H = 40; m.tiles = Array.from({ length: W }, (_, x) => Array.from({ length: H }, (_, y) => (x === 0 || y === 0 || x === W - 1 || y === H - 1 ? 1 : 2)));
  m.portals = {}; m.fields = {}; m.switches = {}; m.marsballs = []; m.key = 'arena';
  return m;
}
const keyOf = (vx, vy) => { const s = Math.hypot(vx, vy); if (s < 0.05) return 0;
  const ax = Math.abs(vx) < 0.38 * s ? 0 : Math.sign(vx), ay = Math.abs(vy) < 0.38 * s ? 0 : Math.sign(vy); return ACTIONS.findIndex(([a, b]) => a === ax && b === ay); };

// the real engine: does chaser key k touch the carrier for every carrier choice (after react ticks)?
// returns the worst (latest) touch tick, or Infinity if some choice escapes
function exact(sim, ch, ca, s, k, react) {
  sim.place(ch, s.cx, s.cy, s.cvx, s.cvy); sim.place(ca, s.fx, s.fy, s.fvx, s.fvy);
  const root = sim.save(), first = keyOf(s.fvx, s.fvy); let worst = 0;
  for (let r = 0; r < 9 && worst < Infinity; r++) {
    sim.restore(root); let hit = Infinity;
    for (let t = 1; t <= MAX_T; t++) {
      setKeys(ch, k); setKeys(ca, t <= react ? first : r); sim.tickOnce();
      const a = ch.body.GetPosition(), b = ca.body.GetPosition();
      if (Math.hypot(a.x - b.x, a.y - b.y) < TOUCH) { hit = t; break; }
    }
    worst = Math.max(worst, hit);
  }
  sim.restore(root); sim.commit();
  return worst;
}
// the fast check: the same question with plain motion maths; also the closest approach of the worst choice
function kin(x, y, vx, vy, a) { vx *= DAMP; vy *= DAMP; const [ax, ay] = ACTIONS[a];
  if (ax > 0 && vx < MS) vx += ACC; if (ax < 0 && vx > -MS) vx -= ACC; if (ay > 0 && vy < MS) vy += ACC; if (ay < 0 && vy > -MS) vy -= ACC;
  return [x + vx * DT, y + vy * DT, vx, vy]; }
function fast(s, k, react, touch = TOUCH) {
  const first = keyOf(s.fvx, s.fvy); let worst = 0, worstMiss = 0;
  for (let r = 0; r < 9; r++) {
    let [cx, cy, cvx, cvy] = [s.cx, s.cy, s.cvx, s.cvy], [fx, fy, fvx, fvy] = [s.fx, s.fy, s.fvx, s.fvy], hit = Infinity, close = Infinity;
    for (let t = 1; t <= MAX_T; t++) {
      [cx, cy, cvx, cvy] = kin(cx, cy, cvx, cvy, k); [fx, fy, fvx, fvy] = kin(fx, fy, fvx, fvy, t <= react ? first : r);
      const d = Math.hypot(cx - fx, cy - fy); close = Math.min(close, d);
      if (d < touch) { hit = t; break; }
    }
    worst = Math.max(worst, hit); if (hit === Infinity) worstMiss = Math.max(worstMiss, close);
  }
  return { worst, worstMiss };
}

// the furthest distance at which some chaser key (straight at the carrier, or 45 degrees either side) is a certain
// kill, found by halving (closer is never harder to kill), to within 2 cm; check = (d) => is it a kill at distance d
function edge(check, lo = 0.38, hi = 6) {
  if (!check(lo)) return 0;
  if (check(hi)) return hi;
  while (hi - lo > 0.02) { const m = (lo + hi) / 2; if (check(m)) lo = m; else hi = m; }
  return +lo.toFixed(2);
}
function grid(part = 0, parts = 1) {
  const sim = new Sim(arena()), ch = sim.addBall(1), cb = sim.addBall(2);
  const out = fs.openSync(path.join(__dirname, 'results', 'killgrid' + (parts > 1 ? '-' + part : '') + '.csv'), 'w');
  fs.writeSync(out, 'cs,ca,fs,fa,react,engine,fast\n');
  const KEYS = [3, 4, 2]; // right (straight at the carrier), down-right, up-right
  let n = 0, i = 0;
  for (let cs = 0; cs <= 3.001; cs += 0.25) for (let ca = 0; ca < 360; ca += 22.5) {
    if (cs === 0 && ca) continue; // a still chaser has no direction
    if (i++ % parts !== part) continue;
    for (let fs_ = 0; fs_ <= 3.001; fs_ += 0.25) for (let fa = 0; fa < 360; fa += 22.5) {
      if (fs_ === 0 && fa) continue;
      const cr = ca * Math.PI / 180, fr = fa * Math.PI / 180;
      // the carrier at (8, 8), the chaser d metres to its left; ca = chaser's direction (0 = straight at the carrier),
      // fa = carrier's direction (0 = straight away from the chaser), both counted clockwise on screen
      const at = (d) => ({ cx: 8 - d, cy: 8, cvx: Math.cos(cr) * cs, cvy: Math.sin(cr) * cs, fx: 8, fy: 8, fvx: Math.cos(fr) * fs_, fvy: Math.sin(fr) * fs_ });
      for (const react of REACTS) {
        const e = edge((d) => KEYS.some((k) => exact(sim, ch, cb, at(d), k, react) < Infinity));
        const f = edge((d) => KEYS.some((k) => fast(at(d), k, react, TOUCH - 0.01).worst < Infinity));
        fs.writeSync(out, [cs, ca, fs_, fa, react, e, f].join(',') + '\n'); n++;
      }
    }
  }
  return n;
}

if (require.main === module && process.argv[2] === 'grid') {
  console.log(grid(+(process.argv[3] || 0), +(process.argv[4] || 1)), 'cases');
} else if (require.main === module) {
  const n = +(process.argv[2] || 100); let seed = +(process.argv[3] || Date.now() % 1e9);
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const sim = new Sim(arena()), ch = sim.addBall(1), ca = sim.addBall(2);
  const counts = {}; // 'react:EF' -> cases, E = engine says kill, F = fast check says kill
  const out = fs.openSync(path.join(__dirname, 'results', 'killtest' + (process.env.TAG || '') + '.jsonl'), 'a');
  for (let i = 0; i < n; i++) {
    // carrier in the middle of the arena; chaser 0.5-4 m away; speeds 0-3 m/s in any direction
    // weighted towards close range and chasers already heading roughly at the carrier, where kills are possible
    const d = 0.4 + rnd() ** 1.5 * 3.1, ang = rnd() * 2 * Math.PI, cs = rnd() * 3, fs_ = rnd() * 3, fa = rnd() * 2 * Math.PI;
    const ca_ = rnd() < 0.7 ? ang + Math.PI + (rnd() - 0.5) * 1.6 : rnd() * 2 * Math.PI;
    const s = { fx: 8, fy: 8, fvx: Math.cos(fa) * fs_, fvy: Math.sin(fa) * fs_, cx: 8 + Math.cos(ang) * d, cy: 8 + Math.sin(ang) * d, cvx: Math.cos(ca_) * cs, cvy: Math.sin(ca_) * cs };
    for (const react of REACTS) for (let k = 1; k <= 8; k++) {
      const f = fast(s, k, react), e = exact(sim, ch, ca, s, k, react);
      const key = react + ':' + (e < Infinity ? 1 : 0) + (f.worst < Infinity ? 1 : 0); counts[key] = (counts[key] || 0) + 1;
      // only cases that either side calls a kill are kept (the rest are just counted)
      if (e < Infinity || f.worst < Infinity || f.worstMiss < 0.6)
        fs.writeSync(out, JSON.stringify({ d: +d.toFixed(3), cs: +cs.toFixed(3), fsp: +fs_.toFixed(3), s, k, react, exact: e === Infinity ? null : e, fast: f.worst === Infinity ? null : f.worst, miss: +f.worstMiss.toFixed(3) }) + '\n');
    }
    if ((i + 1) % 1000 === 0) fs.writeFileSync(path.join(__dirname, 'results', 'killtest' + (process.env.TAG || '') + '-counts.json'), JSON.stringify({ samples: i + 1, counts }));
  }
}
module.exports = { exact, fast, arena, keyOf, grid };
