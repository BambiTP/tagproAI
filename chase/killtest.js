// chase/killtest.js - how sure is a "certain kill"? A chaser holds one key (a straight or diagonal line) and never
// lets go; the carrier keeps pressing its current direction for its reaction time, then may press any of the 9 key
// choices (any direction, or nothing) for the rest. The kill is certain only if every choice ends in a touch.
// Ground truth: the real engine. Fast check: plain motion maths (drag, push up to top speed, no collisions), which is
// what a chaser can afford every few ticks. This samples random distances, speeds and directions on open floor and
// records both answers, so the fast check can be tuned until it never claims a kill that isn't one.
//   node chase/killtest.js <samples> [seed]   -> appends to chase/results/killtest.jsonl
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

if (require.main === module) {
  const n = +(process.argv[2] || 100); let seed = +(process.argv[3] || Date.now() % 1e9);
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const sim = new Sim(arena()), ch = sim.addBall(1), ca = sim.addBall(2);
  const out = fs.openSync(path.join(__dirname, 'results', 'killtest' + (process.env.TAG || '') + '.jsonl'), 'a');
  for (let i = 0; i < n; i++) {
    // carrier in the middle of the arena; chaser 0.5-4 m away; speeds 0-3 m/s in any direction
    // weighted towards close range and chasers already heading roughly at the carrier, where kills are possible
    const d = 0.4 + rnd() ** 1.5 * 3.1, ang = rnd() * 2 * Math.PI, cs = rnd() * 3, fs_ = rnd() * 3, fa = rnd() * 2 * Math.PI;
    const ca_ = rnd() < 0.7 ? ang + Math.PI + (rnd() - 0.5) * 1.6 : rnd() * 2 * Math.PI;
    const s = { fx: 8, fy: 8, fvx: Math.cos(fa) * fs_, fvy: Math.sin(fa) * fs_, cx: 8 + Math.cos(ang) * d, cy: 8 + Math.sin(ang) * d, cvx: Math.cos(ca_) * cs, cvy: Math.sin(ca_) * cs };
    for (const react of REACTS) for (let k = 1; k <= 8; k++) {
      const f = fast(s, k, react), e = exact(sim, ch, ca, s, k, react);
      fs.writeSync(out, JSON.stringify({ d: +d.toFixed(3), cs: +cs.toFixed(3), fsp: +fs_.toFixed(3), s, k, react, exact: e === Infinity ? null : e, fast: f.worst === Infinity ? null : f.worst, miss: +f.worstMiss.toFixed(3) }) + '\n');
    }
  }
}
module.exports = { exact, fast, arena, keyOf };
