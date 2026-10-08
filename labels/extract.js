// labels/extract.js - turn ranked replays into labelled clips for people to check on the puzzle site.
//   node labels/extract.js <list of replay files> <first> <count>
// For each capture-the-flag game: rebuild every player 10 times a second, give each moment a first-guess
// label from simple rules (the TagPro roles below), then cut up to PER_GAME clips of 8 seconds, each centred
// on one player at one moment, spread across the labels so rare ones (anti regrab, regrab) get enough.
// Route distances are travel along the map (plain route, boosts not counted), from nav.js.
// Output: labels/clips/<id>.json and labels/maps/<map>.json (tiles at clip time are stored per clip).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const N = require('../nav');

const OUT = path.join(__dirname, 'clips'), TILE = N.TILE, HZ = 10, STEP = 1000 / HZ;
const BEFORE = 5000, AFTER = 3000, PER_GAME = 24, PER_LABEL = 4;
const LABELS = ['carrying', 'regrab', 'anti regrab', 'chasing', 'OD', 'escort', 'home defence', 'grab attempt', 'pup fight', 'moving'];
fs.mkdirSync(OUT, { recursive: true });

// the rules: first match wins. Distances in tiles along the route. `s` describes one player at one moment.
function label(s) {
  if (s.dead) return null;
  if (s.carrying) return 'carrying';
  if (s.pupSoon && s.dPup <= 4) return 'pup fight';
  if (s.ownOut) {
    if (s.dEnemyCarrier <= 8 && s.closing) return 'chasing';
    if (s.dOwnSpot <= 3 && s.enemyOnOwnSpot) return 'anti regrab';
    if (s.dEnemySpot <= 5) return 'OD';
  }
  if (s.teamCarrying) {
    if (s.dEnemySpot <= 2.5) return 'regrab';
    if (s.dTeamCarrier <= 5) return 'escort';
  }
  if (!s.ownOut && s.dOwnSpot <= 6) return 'home defence';
  if (!s.enemyOut && s.dEnemySpot <= 7) return 'grab attempt';
  return 'moving';
}

function parse(file) {
  const L = zlib.gunzipSync(fs.readFileSync(file)).toString().trim().split('\n').map((l) => JSON.parse(l));
  const meta = L[0][2];
  const base = L.find((l) => l[1] === 'map')[2].tiles.map((c) => c.slice());
  let start = null;
  for (const l of L) if (l[1] === 'time' && l[2].state === 1) { start = l[0]; break; }
  return { meta, L, base, start, end: L[L.length - 1][0] };
}

// the game sampled 10 times a second: every player's x, y (metres), speed, team, flag held, dead; tiles
function sample({ L, base, start, end }) {
  const st = {}, tiles = base.map((c) => c.slice()), frames = [];
  const ups = []; // tile changes with their time, to rebuild tiles at any moment
  let i = 0;
  for (let t = start; t <= end; t += STEP) {
    for (; i < L.length && L[i][0] <= t; i++) {
      const [, type, d] = L[i];
      if (type === 'p') for (const u of d) Object.assign(st[u.id] = st[u.id] || {}, u);
      else if (type === 'mapupdate') for (const u of Array.isArray(d) ? d : [d]) { tiles[u.x][u.y] = u.v; ups.push([L[i][0], u.x, u.y, u.v]); }
    }
    frames.push({ t, p: Object.entries(st).filter(([, s]) => s.rx != null && (s.team === 1 || s.team === 2))
      .map(([id, s]) => ({ id: +id, team: s.team, x: s.rx, y: s.ry, vx: s.lx || 0, vy: s.ly || 0, flag: s.flag || null, dead: !!s.dead })) });
  }
  return { frames, ups };
}

function tilesAt(base, ups, t) {
  const T = base.map((c) => c.slice());
  for (const [ut, x, y, v] of ups) { if (ut > t) break; T[x][y] = v; }
  return T;
}

function describe(game) {
  const { base } = game, { frames, ups } = sample(game);
  const spot = {};
  for (let x = 0; x < base.length; x++) for (let y = 0; y < base[0].length; y++) {
    const v = String(base[x][y]).split('.')[0];
    if (v === '3') spot[1] = [x, y]; if (v === '4') spot[2] = [x, y];
  }
  if (!spot[1] || !spot[2]) return null;
  const F = { 1: N.field(base, ...spot[1]), 2: N.field(base, ...spot[2]) };
  const route = (team, x, y) => N.fieldAt(F[team], x, y) / TILE;            // tiles from (x,y) to that team's flag spot
  const pups = []; for (let x = 0; x < base.length; x++) for (let y = 0; y < base[0].length; y++) if (Math.floor(parseFloat(base[x][y])) === 6) pups.push([x, y]);
  // when each powerup comes back (tile becomes 6.x again), to tell a pup fight
  const pupBack = ups.filter(([, x, y, v]) => Math.floor(parseFloat(v)) === 6 && String(v) !== '6').map(([t, x, y]) => [t, x, y]);
  const out = [];
  for (const fr of frames) {
    const carrierOf = { 1: null, 2: null }; // carrierOf[k]: who holds team k's flag (flag 1 = red's, 2 = blue's)
    for (const q of fr.p) if (q.flag === 1 || q.flag === 2) carrierOf[q.flag] = q;
    const row = [];
    for (const q of fr.p) {
      const own = q.team, enemy = 3 - own, eSpot = spot[enemy], oSpot = spot[own];
      const enemyCarrier = carrierOf[own], teamCarrier = carrierOf[enemy];
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / TILE;
      const near = (pt, r) => Math.hypot(q.x / TILE - pt[0], q.y / TILE - pt[1]) <= r;
      let dPup = Infinity, pupSoon = false;
      for (const [px, py] of pups) {
        const d = Math.hypot(q.x / TILE - px, q.y / TILE - py); if (d < dPup) dPup = d;
        if (d <= 4 && pupBack.some(([t, x, y]) => x === px && y === py && t >= fr.t - 3000 && t <= fr.t + 5000)) pupSoon = true;
      }
      const s = {
        dead: q.dead, carrying: q.flag === enemy, ownOut: !!enemyCarrier, enemyOut: !!teamCarrier,
        teamCarrying: !!teamCarrier && teamCarrier.id !== q.id,
        dEnemyCarrier: enemyCarrier ? dist(q, enemyCarrier) : Infinity,
        closing: enemyCarrier ? ((enemyCarrier.x - q.x) * (q.vx - enemyCarrier.vx) + (enemyCarrier.y - q.y) * (q.vy - enemyCarrier.vy)) > 0 : false,
        dTeamCarrier: teamCarrier && teamCarrier.id !== q.id ? dist(q, teamCarrier) : Infinity,
        dOwnSpot: route(own, q.x, q.y), dEnemySpot: route(enemy, q.x, q.y),
        enemyOnOwnSpot: fr.p.some((o) => o.team === enemy && !o.dead && o !== enemyCarrier && Math.hypot(o.x / TILE - oSpot[0], o.y / TILE - oSpot[1]) <= 3),
        dPup, pupSoon,
      };
      let lab = label(s);
      // past N for a carrier: enemies who'd reach the carrier's capture spot (their own flag spot) later than them
      let past = null;
      if (lab === 'carrying') {
        const mine = route(own, q.x, q.y);
        past = fr.p.filter((o) => o.team === enemy && (o.dead || route(own, o.x, o.y) > mine)).length;
      }
      row.push({ id: q.id, lab, past });
    }
    out.push(row);
  }
  return { frames, ups, out, spot };
}

if (require.main === module) {
  const [list, first = '0', count = '50'] = process.argv.slice(2);
  const files = fs.readFileSync(list, 'utf8').trim().split('\n').slice(+first, +first + +count);
  let clips = 0;
  for (const file of files) {
    let game; try { game = parse(file); } catch (e) { continue; }
    if (!game.start) continue;
    const d = describe(game); if (!d) continue;
    const { frames, ups, out, spot } = d, names = Object.fromEntries(game.meta.players.map((p) => [p.id, p.displayName]));
    // candidate moments once a second per player, then up to PER_LABEL per label, PER_GAME per game
    const byLabel = {};
    for (let f = BEFORE / STEP; f < frames.length - AFTER / STEP; f += HZ) for (const r of out[f]) if (r.lab) (byLabel[r.lab] = byLabel[r.lab] || []).push([f, r]);
    // one per label in turns, so every label gets clips before any gets many
    const picks = [];
    for (let round = 0; round < PER_LABEL && picks.length < PER_GAME; round++)
      for (const lab of LABELS) { const c = byLabel[lab] || []; if (c.length && picks.length < PER_GAME) picks.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]); }
    for (const [f, r] of picks.slice(0, PER_GAME)) {
      const a = f - BEFORE / STEP, b = f + AFTER / STEP, uuid = game.meta.uuid;
      const players = frames[f].p.map((q) => ({ id: q.id, team: q.team, name: names[q.id] || '' }));
      const clip = {
        id: uuid.slice(0, 8) + '-' + r.id + '-' + f, replay: uuid, map: game.meta.mapName, at: BEFORE / STEP, hz: HZ, target: r.id,
        rule: r.lab, past: r.past, spots: spot, players,
        tiles: tilesAt(game.base, ups, frames[a].t),
        // each frame: for each player in `players` order: [x, y, flag, dead] (x, y in tiles)
        frames: frames.slice(a, b + 1).map((fr) => players.map((pl) => { const q = fr.p.find((o) => o.id === pl.id);
          return q ? [+(q.x / TILE).toFixed(2), +(q.y / TILE).toFixed(2), q.flag, q.dead ? 1 : 0] : null; })),
        // the rule's label for the target player through the clip
        timeline: out.slice(a, b + 1).map((row) => { const t = row.find((x) => x.id === r.id); return t ? t.lab : null; }),
      };
      fs.writeFileSync(path.join(OUT, clip.id + '.json'), JSON.stringify(clip)); clips++;
    }
  }
  console.log(JSON.stringify({ games: files.length, clips }));
}
module.exports = { LABELS, label, parse, describe };
