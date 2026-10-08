// chase/run.js - bots play the chase puzzles from chase/extract.js and are compared with the real chaser.
//   node chase/run.js <version> [first] [count]   -> chase/results/<version>.jsonl
// The carrier is a ghost on its recorded path (it does not react to the bot, and its teammates are not there to
// block), so a bot's return rate here is an upper bound on what it would manage in a real game. The bot
// returns the carrier when the two balls touch (centres within two ball radii), before the real window ends
// (the carrier capped, someone else returned it, or 8 s passed). Tile changes from the replay (boosts and bombs
// used, gates switched) are copied into the game as they happened.
// Versions:
//   pursue     search towards where the carrier is now
//   intercept  search towards the first point on the carrier's route home that the bot can reach before the
//              carrier does; if there is none, towards the carrier's capture spot (get in front of it there)
//   lead       search towards where the carrier will be, at its current velocity, by the time the bot gets there
//   mixed      lead when the carrier is in sight and within 3 tiles, intercept otherwise
const fs = require('fs'), path = require('path');
const N = require('../nav');
const F = require('../fastsearch');
const { Sim, getMap } = require('../sim');

const DIR = path.join(__dirname, 'scenarios'), RES = path.join(__dirname, 'results');
const TOUCH = 2 * N.BALL_R, TILE = N.TILE;
// replay positions update every ~40 ms, so the recorded carrier path is blurred around fast moves: real returns
// show the two balls 0.38-0.7 m apart. Each run also records the first tick within NEAR and its closest approach.
const NEAR = 0.5;
const VERSIONS = {
  pursue: { aim: 'now', prune: true, keep: 2 },
  intercept: { aim: 'route', prune: true, keep: 2 },
  lead: { aim: 'lead', prune: true, keep: 2 },
  mixed: { aim: 'mixed', prune: true, keep: 2 },
};
const tileOf = (v) => Math.round(v / TILE);
const kind = (v) => Math.floor(parseFloat(v));
const COPY = new Set([5, 9, 10, 14, 15]); // boosts, gates, bombs: the states the chase can depend on

// the capture spot of a team: its own flag tile (3 red, 4 blue)
function capSpot(tiles, team) {
  for (let x = 0; x < tiles.length; x++) for (let y = 0; y < tiles[0].length; y++) if (kind(tiles[x][y]) === (team === 1 ? 3 : 4)) return [x, y];
  return null;
}
// the carrier's route home from (x, y): tile centres along the field's downhill path, with distance so far
function routeHome(Fc, x, y, max = 60) {
  let cx = tileOf(x), cy = tileOf(y), dist = Math.hypot(cx * TILE - x, cy * TILE - y);
  const out = [[cx, cy, dist]];
  for (let i = 0; i < max; i++) {
    let best = Fc.d[cx * Fc.H + cy], nx = -1, ny = -1;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const a = cx + dx, b = cy + dy;
      if ((!dx && !dy) || a < 0 || b < 0 || a >= Fc.W || b >= Fc.H) continue;
      const v = Fc.d[a * Fc.H + b]; if (v < best) { best = v; nx = a; ny = b; }
    }
    if (nx < 0) break;
    dist += TILE * Math.hypot(nx - cx, ny - cy); cx = nx; cy = ny; out.push([cx, cy, dist]);
  }
  return out;
}
// where to aim: [x, y] in metres
// lead: the carrier's position after the time the bot needs to get there (a few rounds, at most 1.5 s ahead),
// pulled back along the line to the last open tile
function leadPoint(F0, me, c, cv) {
  let x = c[0], y = c[1];
  for (let i = 0; i < 3; i++) {
    const d = Math.hypot(x - me.x, y - me.y), ux = (x - me.x) / (d || 1), uy = (y - me.y) / (d || 1);
    const tau = Math.min(1.5, N.tReach(Math.max(0, d - TOUCH), me.vx * ux + me.vy * uy) / 60);
    x = c[0] + cv[0] * tau; y = c[1] + cv[1] * tau;
  }
  for (let f = 1; f > 0; f -= 0.1) {
    const px = c[0] + (x - c[0]) * f, py = c[1] + (y - c[1]) * f, k = tileOf(px) * F0.H + tileOf(py);
    if (tileOf(px) >= 0 && tileOf(py) >= 0 && tileOf(px) < F0.W && tileOf(py) < F0.H && F0.ok[k] && N.clearLine(F0, c[0], c[1], px, py)) return [px, py];
  }
  return [c[0], c[1]];
}
function aimPoint(v, tiles, Fc, spot, me, c, cv) {
  if (v.aim === 'now' || !Fc) return [c[0], c[1]];
  if (v.aim === 'lead') return leadPoint(Fc, me, c, cv);
  if (v.aim === 'mixed' && Math.hypot(c[0] - me.x, c[1] - me.y) < 3 * TILE && N.clearLine(Fc, me.x, me.y, c[0], c[1])) return leadPoint(Fc, me, c, cv);
  const Fb = N.field(tiles, tileOf(me.x), tileOf(me.y));
  const cs = Math.max(Math.hypot(cv[0], cv[1]), 1.5);
  for (const [x, y, d] of routeHome(Fc, c[0], c[1])) {
    const db = Fb.d[x * Fb.H + y]; if (db === Infinity) continue;
    const ux = x * TILE - me.x, uy = y * TILE - me.y, L = Math.hypot(ux, uy) || 1;
    const tb = N.tReach(Math.max(0, db - TOUCH), (me.vx * ux + me.vy * uy) / L), tc = N.tReach(d, cs);
    if (tb <= tc) return d < 0.5 ? [c[0], c[1]] : [x * TILE, y * TILE];
  }
  return [spot[0] * TILE, spot[1] * TILE];
}

function play(s, v) {
  const sim = new Sim(getMap(s.key)), p = sim.addBall(s.chaserTeam);
  for (let x = 0; x < s.tiles.length; x++) for (let y = 0; y < s.tiles[0].length; y++) {
    const r = s.tiles[x][y]; if (COPY.has(kind(r)) && String(r) !== String(sim.tiles[x][y])) sim.setTile(x, y, typeof r === 'string' ? r : +r, true);
  }
  sim.place(p, s.chaser.x, s.chaser.y, s.chaser.vx, s.chaser.vy);
  const search = F.makeSearch2(v), keep = v.keep || 1, spot = capSpot(s.tiles, s.carrier.team);
  const Fc = spot ? N.field(s.tiles, spot[0], spot[1]) : null;
  const ups = s.tileUps.filter((u) => COPY.has(kind(u[3])));
  let plan = [], a = 0, ui = 0, ms = 0, near = null, closest = Infinity;
  const end = s.ghost.length - 1, path_ = [];
  for (let t = 0; t < end; t++) {
    sim.commit();
    for (; ui < ups.length && ups[ui][0] <= t; ui++) sim.setTile(ups[ui][1], ups[ui][2], ups[ui][3], true);
    if (t % N.K === 0 && !plan.length) {
      const q = p.body.GetPosition(), w = p.body.GetLinearVelocity(), c = s.ghost[t], c0 = s.ghost[Math.max(0, t - 6)];
      const cv = [(c[0] - c0[0]) / (Math.min(t, 6) || 1) * 60, (c[1] - c0[1]) / (Math.min(t, 6) || 1) * 60];
      const t0 = performance.now();
      const [gx, gy] = aimPoint(v, sim.tiles, Fc, spot, { x: q.x, y: q.y, vx: w.x, vy: w.y }, c, cv);
      const task = { touch: true, key: s.key, goal: { x: gx, y: gy }, F: N.field(sim.tiles, tileOf(gx), tileOf(gy)) };
      plan = search(task, sim, p).line.slice(0, keep);
      ms += performance.now() - t0;
    }
    if (t % N.K === 0) a = plan.shift();
    N.setKeys(p, a); sim.tickOnce();
    const done = (result, ticks) => ({ id: s.id, result, ticks, near, closest: +closest.toFixed(3), ms: Math.round(ms), path: path_ });
    if (p.dead) return done('pop', t + 1);
    const q = p.body.GetPosition(), c = s.ghost[t + 1], dc = Math.hypot(q.x - c[0], q.y - c[1]);
    path_.push([+q.x.toFixed(3), +q.y.toFixed(3)]);
    closest = Math.min(closest, dc); if (near == null && dc < NEAR) near = t + 1;
    if (dc < TOUCH) return done('returned', t + 1);
  }
  return { id: s.id, result: 'missed', ticks: end, near, closest: +closest.toFixed(3), ms: Math.round(ms), path: path_ };
}

if (require.main === module) {
  const [name = 'intercept', first = '0', count = '100'] = process.argv.slice(2);
  const v = VERSIONS[name]; if (!v) throw new Error('versions: ' + Object.keys(VERSIONS).join(', '));
  fs.mkdirSync(RES, { recursive: true });
  const ids = (process.env.IDS ? process.env.IDS.split(',') : fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort())
    .slice(+first, +first + +count);
  const out = fs.openSync(path.join(RES, name + (process.env.TAG || '') + '.jsonl'), 'a');
  for (const id of ids) {
    const s = JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8'));
    const r = play(s, v);
    r.real = s.outcome; r.realTicks = s.realMs == null ? null : Math.round(s.realMs * 60 / 1000);
    fs.writeSync(out, JSON.stringify(r) + '\n');
    if (process.env.VERBOSE) console.log(id, r.result, r.ticks, 'real:', r.real, r.realTicks, r.ms + 'ms');
  }
}
module.exports = { play, VERSIONS, aimPoint, routeHome };
