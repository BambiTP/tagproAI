// chase/extract.js - chase puzzles from ranked replays: a real moment where a player is chasing the enemy flag
// carrier, with what really happened (did that player return the carrier, and how fast).
//   node chase/extract.js <list of replay files> <first> <count>   -> chase/scenarios/<id>.json
// A puzzle: the chaser's position and velocity at the start, the carrier's recorded path from then on (it is
// replayed as a ghost that does not react to the bot), the map's tile changes during the window, and the
// real outcome. One puzzle per (grab, chaser): the first moment, at least 0.3 s after the grab, that the chaser
// is alive and 2-10 tiles from the carrier along the route. The window ends when the carrier is returned or
// caps, or after 8 s.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const N = require('../nav');
const { getMap } = require('../sim');

const OUT = path.join(__dirname, 'scenarios'), TILE = N.TILE;
const WINDOW = 8000, NEAR = 10, FAR_MIN = 2, AFTER_GRAB = 300;
fs.mkdirSync(OUT, { recursive: true });

// replay map name -> tagproAI map key (maps/<key>.json info.name)
const byName = {};
for (const f of fs.readdirSync(path.join(__dirname, '..', 'maps'))) if (f.endsWith('.json') && f !== 'rotation.json') {
  try { const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'maps', f), 'utf8')); if (j.info && j.info.name) byName[j.info.name] = f.slice(0, -5); } catch (e) {}
}

function load(file) {
  const L = zlib.gunzipSync(fs.readFileSync(file)).toString().trim().split('\n').map((l) => JSON.parse(l));
  const meta = L[0][2], base = L.find((l) => l[1] === 'map')[2].tiles;
  let start = null; for (const l of L) if (l[1] === 'time' && l[2].state === 1) { start = l[0]; break; }
  return { meta, L, base, start };
}

// every player's full track (one row per position update) and every counter change
function tracks(L, start) {
  const st = {}, tr = {}, events = [], ups = [];
  for (const [t, type, d] of L) {
    if (type === 'mapupdate') { for (const u of Array.isArray(d) ? d : [d]) ups.push([t, u.x, u.y, u.v]); continue; }
    if (type !== 'p') continue;
    for (const u of (d.u || d)) {
      const s = (st[u.id] = st[u.id] || {});
      for (const k of ['s-returns', 's-captures', 's-grabs']) if (k in u && s[k] != null && u[k] > s[k]) events.push({ t, id: u.id, k });
      Object.assign(s, u);
      if (t < start || s.rx == null || !(s.team === 1 || s.team === 2)) continue;
      (tr[u.id] = tr[u.id] || []).push([t, s.rx, s.ry, s.lx || 0, s.ly || 0, s.flag ? 1 : 0, s.dead ? 1 : 0, s.team]);
    }
  }
  return { tr, events, ups };
}
// a player's state at time t (linear between updates)
function at(track, t) {
  let lo = 0, hi = track.length - 1;
  if (!track.length || t < track[0][0]) return null;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (track[m][0] <= t) lo = m; else hi = m - 1; }
  const a = track[lo], b = track[lo + 1];
  if (!b || b[6] || a[6] || b[0] - a[0] > 500) return a.slice();
  const f = (t - a[0]) / (b[0] - a[0]);
  return [t, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f, a[4] + (b[4] - a[4]) * f, a[5], a[6], a[7]];
}
function tilesAt(base, ups, t) {
  const T = base.map((c) => c.slice());
  for (const [ut, x, y, v] of ups) { if (ut > t) break; T[x][y] = v; }
  return T;
}
const tileOf = (v) => Math.round(v / TILE);

function scenarios(file) {
  const g = load(file), m = g.meta;
  if (m.mapType !== 'ctf' || g.start == null) return [];
  const key = byName[m.mapName]; if (!key) return [];
  const map = getMap(key);
  if (map.tiles.length !== g.base.length || map.tiles[0].length !== g.base[0].length) return []; // older local map file
  const { tr, events, ups } = tracks(g.L, g.start);
  const names = Object.fromEntries(m.players.map((p) => [p.id, p.displayName]));
  const out = [];
  for (const [cid, track] of Object.entries(tr)) {
    for (let i = 1; i < track.length; i++) {
      if (!(track[i][5] && !track[i - 1][5])) continue; // a grab
      const tg = track[i][0], team = track[i][7];
      let j = i; while (j < track.length && track[j][5] && !track[j][6]) j++;
      const te = j < track.length ? track[j][0] : track[track.length - 1][0];
      const ended = events.filter((e) => Math.abs(e.t - te) <= 100);
      const cap = ended.some((e) => e.k === 's-captures' && +e.id === +cid);
      const returner = (ended.find((e) => e.k === 's-returns') || {}).id;
      // the carrier's route field is built per sample below; the chasers are the other team's players
      for (const [did, dtr] of Object.entries(tr)) {
        if (!dtr.length || dtr[0][7] === team) continue;
        for (let t = tg + AFTER_GRAB; t < te - 500; t += 100) {
          const c = at(track, t), d = at(dtr, t);
          if (!c || !d || d[6] || d[7] === team) continue;
          const tiles = tilesAt(g.base, ups, t);
          const F = N.field(tiles, tileOf(c[1]), tileOf(c[2]));
          const dist = N.fieldAt(F, d[1], d[2]) / TILE;
          if (!(dist >= FAR_MIN && dist <= NEAR)) continue;
          const end = Math.min(te, t + WINDOW);
          const ghost = [], human = [];
          for (let s = t; s <= end + 1; s += 1000 / 60) {
            const q = at(track, s), h = at(dtr, s);
            ghost.push([+q[1].toFixed(4), +q[2].toFixed(4)]); human.push(h && !h[6] ? [+h[1].toFixed(4), +h[2].toFixed(4)] : null);
          }
          const real = +returner === +did && te <= t + WINDOW ? te - t : null;
          out.push({ id: m.uuid.slice(0, 8) + '-' + cid + '-' + did + '-' + Math.round(t - g.start),
            replay: m.uuid, map: m.mapName, key, t0: t - g.start, chaserTeam: d[7],
            chaser: { id: +did, name: names[did] || '', x: d[1], y: d[2], vx: d[3], vy: d[4] },
            carrier: { id: +cid, name: names[cid] || '', team },
            startDist: +dist.toFixed(2), ms: end - t, ghost, human,
            tiles, tileUps: ups.filter(([ut]) => ut > t && ut <= end).map(([ut, x, y, v]) => [Math.round((ut - t) * 60 / 1000), x, y, v]),
            // everyone else at the start, for games with more players (chase/team.js)
            others: Object.entries(tr).filter(([id]) => id !== did && id !== cid).map(([id, ot]) => { const o = at(ot, t);
              return o && !o[6] ? { id: +id, name: names[id] || '', team: o[7], x: o[1], y: o[2], vx: o[3], vy: o[4] } : null; }).filter(Boolean),
            outcome: cap && te <= t + WINDOW ? 'cap' : real != null ? 'returned' : returner && te <= t + WINDOW ? 'returned by someone else' : 'still held',
            realMs: real });
          break;
        }
      }
    }
  }
  return out;
}

if (require.main === module) {
  const [list, first = '0', count = '50'] = process.argv.slice(2);
  const files = fs.readFileSync(list, 'utf8').split('\n').filter(Boolean).slice(+first, +first + +count);
  let n = 0;
  for (const f of files) {
    try {
      for (const s of scenarios(f)) { fs.writeFileSync(path.join(OUT, s.id + '.json'), JSON.stringify(s)); n++; }
    } catch (e) { console.error(f, e.message); }
  }
  console.log(n, 'puzzles from', files.length, 'games');
}
module.exports = { scenarios, load, tracks, at };
