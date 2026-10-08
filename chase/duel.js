// chase/duel.js - one against one in the engine, both sides played by bots: a chaser against a flag carrier,
// both starting where the real players were in a chase puzzle (chase/extract.js).
//   node chase/duel.js <chaser version> <carrier version> [first] [count]   -> chase/results/duel-<c>-<r>.jsonl
// Each side plans with the fast search on the same game every 4 ticks, carrying out 2 moves per plan; while one
// side plans, the other is assumed to keep pressing its current keys. The rest of the map is as it was at the
// start (boosts, bombs and gates from the replay); the other six players are not there.
// Ends: the chaser touches the carrier, or the carrier pops on a spike (returned); the carrier reaches its own
// flag tile (capped; its flag is assumed home); 8 s pass (held); the chaser pops (chaser popped).
const fs = require('fs'), path = require('path');
const N = require('../nav');
const F = require('../fastsearch');
const { Sim, getMap } = require('../sim');
const C = require('./run');

const DIR = path.join(__dirname, 'scenarios'), RES = path.join(__dirname, 'results');
const TOUCH = 2 * N.BALL_R + 0.005, CAP_R = 2 * N.BALL_R, TILE = N.TILE, LIMIT = 8 * 60;
const tileOf = (v) => Math.round(v / TILE);
const CHASERS = {
  pursue: { aim: 'now' },
  lead: { aim: 'lead' },
  intercept: { aim: 'route' },   // first point on the carrier's route home it can reach first, else the flag
  mixed: { aim: 'mixed' },       // lead when the carrier is in sight within 3 tiles, intercept otherwise
};
// danger: extra ticks for ending a line within `r` metres of the chaser (most when touching distance)
const CARRIERS = {
  run: { danger: 0, r: 1 },          // straight home, only avoiding being touched inside the plan
  escape: { danger: 30, r: 1.2 },    // also keeps away from the chaser
  wide: { danger: 60, r: 2.0 },      // keeps further away
};
const SEARCH = { prune: true, adaptive: false };

function duel(s, cv, rv) {
  const sim = new Sim(getMap(s.key));
  for (let x = 0; x < s.tiles.length; x++) for (let y = 0; y < s.tiles[0].length; y++) {
    const v = s.tiles[x][y]; if (C.COPY.has(C.kind(v)) && String(v) !== String(sim.tiles[x][y])) sim.setTile(x, y, typeof v === 'string' ? v : +v, true);
  }
  const ch = sim.addBall(s.chaserTeam), ca = sim.addBall(s.carrier.team);
  const g0 = s.ghost[0], g3 = s.ghost[Math.min(3, s.ghost.length - 1)], n3 = Math.min(3, s.ghost.length - 1) || 1;
  sim.place(ch, s.chaser.x, s.chaser.y, s.chaser.vx, s.chaser.vy);
  sim.place(ca, g0[0], g0[1], (g3[0] - g0[0]) * 60 / n3, (g3[1] - g0[1]) * 60 / n3);
  const spot = C.capSpot(s.tiles, s.carrier.team); if (!spot) return null;
  const goalC = { x: spot[0] * TILE, y: spot[1] * TILE }, Fc = N.field(sim.tiles, spot[0], spot[1]);
  const search = F.makeSearch2(SEARCH);
  const pos = (p) => p.body.GetPosition(), vel = (p) => p.body.GetLinearVelocity();
  const apart = () => { const a = pos(ch), b = pos(ca); return Math.hypot(a.x - b.x, a.y - b.y); };
  // the chaser: towards the carrier (or where it is heading), finished on touching it
  const chaserTask = () => {
    const q = pos(ch), w = vel(ch), r = pos(ca), rv_ = vel(ca);
    const [gx, gy] = C.aimPoint(cv, sim.tiles, Fc, spot, { x: q.x, y: q.y, vx: w.x, vy: w.y }, [r.x, r.y], [rv_.x, rv_.y]);
    return { touch: true, goal: { x: gx, y: gy }, F: N.field(sim.tiles, tileOf(gx), tileOf(gy)),
      doneAt: (x, y) => { const b = pos(ca); return Math.hypot(x - b.x, y - b.y) < TOUCH; } };
  };
  // the carrier: home to its flag, a line that gets touched is lost, and (by version) keep away from the chaser
  const carrierTask = {
    touch: true, goal: goalC, F: Fc,
    doneAt: (x, y) => Math.hypot(x - goalC.x, y - goalC.y) < CAP_R,
    lost: () => apart() < TOUCH,
    extra: rv.danger ? (x, y) => { const a = pos(ch), d = Math.hypot(x - a.x, y - a.y); return d < rv.r ? rv.danger * (1 - d / rv.r) : 0; } : null,
  };
  let pc = [], pr = [], ac = 0, ar = 0, ms = 0;
  const path = [];
  const done = (result, t) => ({ id: s.id, result, ticks: t, ms: Math.round(ms), path });
  for (let t = 0; t < LIMIT; t++) {
    if (t % N.K === 0) {
      sim.commit();
      const t0 = performance.now();
      if (!pc.length) pc = search(chaserTask(), sim, ch).line.slice(0, 2);
      if (!pr.length) pr = search(carrierTask, sim, ca).line.slice(0, 2);
      ms += performance.now() - t0;
      ac = pc.shift(); ar = pr.shift();
    }
    N.setKeys(ch, ac); N.setKeys(ca, ar); sim.tickOnce();
    const a = pos(ch), b = pos(ca);
    path.push([+a.x.toFixed(3), +a.y.toFixed(3), +b.x.toFixed(3), +b.y.toFixed(3)]);
    if (ca.dead) return done('returned', t + 1); // a spike pop is a return too
    if (ch.dead) return done('chaser popped', t + 1);
    if (apart() < TOUCH) return done('returned', t + 1);
    if (Math.hypot(b.x - goalC.x, b.y - goalC.y) < CAP_R) return done('capped', t + 1);
  }
  return done('held', LIMIT);
}

if (require.main === module) {
  const [cn = 'pursue', rn = 'escape', first = '0', count = '50'] = process.argv.slice(2);
  const cv = CHASERS[cn], rv = CARRIERS[rn];
  if (!cv || !rv) throw new Error('chasers: ' + Object.keys(CHASERS).join(', ') + '; carriers: ' + Object.keys(CARRIERS).join(', '));
  fs.mkdirSync(RES, { recursive: true });
  const ids = (process.env.IDS ? process.env.IDS.split(',') : fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort())
    .slice(+first, +first + +count);
  const out = fs.openSync(path.join(RES, `duel-${cn}-${rn}${process.env.TAG || ''}.jsonl`), 'a');
  for (const id of ids) {
    const s = JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8'));
    const r = duel(s, cv, rv); if (!r) continue;
    r.real = s.outcome; r.realTicks = s.realMs == null ? null : Math.round(s.realMs * 60 / 1000); r.startDist = s.startDist;
    fs.writeSync(out, JSON.stringify(r) + '\n');
    if (process.env.VERBOSE) console.log(id, r.result, (r.ticks / 60).toFixed(2) + 's', 'real:', r.real, r.ms + 'ms');
  }
}
module.exports = { duel, CHASERS, CARRIERS };
