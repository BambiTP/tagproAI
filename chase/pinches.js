// chase/pinches.js - pinch points on every map in the rotation: places where the open floor is narrow across and
// opens up a lot just beyond (the carrier gets free space once it is through). Spikes count as walls.
//   node chase/pinches.js   -> chase/pinches.json { mapKey: { name, pinches: [{ a, b, width, open }], corners: [[x, y, dirs]] } }
// Corners: floor tiles where the free run is CORNER tiles or less in two directions at right angles (e.g. a wall just
// above and a wall just to the left), and also along both diagonals that run beside those walls (up-right and
// down-left for that example): a carrier there cannot keep going any of those ways. Beside a slanted (45 degree) wall
// one of those diagonals is a long free run, so slanted walls do not count. dirs names the two blocked directions.
// Names (the user's): pinches are "safety nets" (chasers fall back to them); flat walls into a bump are "kill points".
// For every floor tile, in 4 directions (across, up-down, both diagonals): the chord = the straight run of open floor
// through it. A chord is a pinch when it is at most MAX_WIDTH tiles long, no longer than the parallel chords one tile to
// either side, the floor continues on both sides (not a dead end), and 2-4 tiles to one side the parallel chords are
// much longer (at least 3 tiles and half as long again). Nearby pinches (middles within 2 tiles) keep the narrowest.
const fs = require('fs'), path = require('path');
const { getMap, mapKeys } = require('../sim');

const MAX_WIDTH = 8, CORNER = 2;
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

function blockedTile(v) {
  const t = parseFloat(v), f = Math.floor(t);
  return t === 0 || f === 1 || t === 7 || t === 9.1 || t === 9.3;
}

function pinchesOf(tiles) {
  const W = tiles.length, H = tiles[0].length;
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !blockedTile(tiles[x][y]);
  // the open run through (x, y) along (dx, dy): its two end tiles and its length in tiles
  const chord = (x, y, dx, dy) => {
    if (!open(x, y)) return null;
    let a = 0, b = 0;
    // a diagonal step needs both side tiles open too (no squeezing between two walls touching at a corner)
    const step = (cx, cy, s) => open(cx + s * dx, cy + s * dy) && (!dx || !dy || (open(cx + s * dx, cy) && open(cx, cy + s * dy)));
    while (step(x - a * dx, y - a * dy, -1)) a++;
    while (step(x + b * dx, y + b * dy, 1)) b++;
    return { a: [x - a * dx, y - a * dy], b: [x + b * dx, y + b * dy], len: (a + b + 1) * (dx && dy ? Math.SQRT2 : 1) };
  };
  const found = [];
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) for (const [dx, dy] of DIRS) {
    const c = chord(x, y, dx, dy); if (!c || c.len > MAX_WIDTH) continue;
    const px = -dy, py = dx; // perpendicular
    const side = (s) => { // longest parallel chord 2-4 tiles to side s; null if the floor stops right there
      if (!open(x + s * px, y + s * py)) return null;
      let best = 0; for (let k = 2; k <= 4; k++) { const o = chord(x + s * k * px, y + s * k * py, dx, dy); if (o) best = Math.max(best, o.len); }
      return best;
    };
    const n1 = chord(x + px, y + py, dx, dy), n2 = chord(x - px, y - py, dx, dy);
    if (!n1 || !n2 || n1.len < c.len || n2.len < c.len) continue; // not the narrowest here, or a dead end
    const A = side(1), B = side(-1); if (A == null || B == null) continue;
    const opens = Math.max(A, B);
    if (opens >= Math.max(c.len + 3, 1.5 * c.len)) found.push({ ...c, width: +c.len.toFixed(1), open: +opens.toFixed(1) });
  }
  // keep the narrowest of pinches whose middles are within 2 tiles
  found.sort((p, q) => p.width - q.width || q.open - p.open);
  const kept = [];
  for (const p of found) {
    const mx = (p.a[0] + p.b[0]) / 2, my = (p.a[1] + p.b[1]) / 2;
    if (kept.some((k) => Math.hypot((k.a[0] + k.b[0]) / 2 - mx, (k.a[1] + k.b[1]) / 2 - my) < 2)) continue;
    kept.push({ a: p.a, b: p.b, width: p.width, open: p.open });
  }
  return kept;
}

function cornersOf(tiles) {
  const W = tiles.length, H = tiles[0].length, open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !blockedTile(tiles[x][y]);
  const run = (x, y, dx, dy) => { let n = 0; // a diagonal step needs both side tiles open (no slipping between corners)
    while (n <= CORNER) { const cx = x + n * dx, cy = y + n * dy; if (!open(cx + dx, cy + dy) || (dx && dy && (!open(cx + dx, cy) || !open(cx, cy + dy)))) break; n++; }
    return n; };
  const out = [];
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    if (!open(x, y)) continue;
    const u = run(x, y, 0, -1) <= CORNER, d = run(x, y, 0, 1) <= CORNER, l = run(x, y, -1, 0) <= CORNER, r = run(x, y, 1, 0) <= CORNER;
    const dirs = (u ? 'u' : '') + (d ? 'd' : '') + (l ? 'l' : '') + (r ? 'r' : '');
    // a corner pair (vertical side v, horizontal side h) also needs both diagonals along its walls short
    const pairs = [[u, l, -1, -1], [u, r, -1, 1], [d, l, 1, -1], [d, r, 1, 1]]; // [vertical side blocked, horizontal side blocked, vy, hx]
    // the walls doing the blocking must be square (full wall or spike), not the slanted half-tiles (1.1-1.4) that make
    // smooth 45 degree walls: a staircase of those is a slope the ball slides along, not a corner
    const square = (dx, dy) => { const n = run(x, y, dx, dy), tx = x + (n + 1) * dx, ty = y + (n + 1) * dy;
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true; const v = parseFloat(tiles[tx][ty]); return !(v > 1 && v < 2); };
    if (pairs.some(([v, h, vy, hx]) => v && h && square(0, vy) && square(hx, 0) && run(x, y, hx, -vy) <= CORNER && run(x, y, -hx, vy) <= CORNER)) out.push([x, y, dirs]);
  }
  return out;
}

// Kill points: places where a chaser can stop containing and just let the carrier run into a wall (the user's
// principle). A flat stretch of wall running straight into an inward bump, for a carrier running along it either
// touching the wall (off = 0) or 1-2 tiles out from it (off = 1, 2), as long as the floor between carrier and wall is
// open, the wall stays flat at that distance, and the bump ahead covers the whole strip between the carrier and the
// wall (otherwise the carrier slips past along the wall). From the bump back to where the flat wall starts (the wall
// steps away, or a corner; a one-tile notch in the wall doesn't end it); more than MAX_FLAT tiles without a bump is
// not a kill point. Straight and 45 degree walls.
// lanes: [{ from, to, off, fwd }] = the run, into the bump. fwd[team] (1 red, 2 blue): true when running this way takes
// that team's carrier closer to its own flag along the route (a forward kill point, where it wants to go anyway);
// false = backward (it would only run in while retreating).
const MAX_FLAT = 10, MIN_FLAT = 2, MAX_OFF = 2;
function lanesOf(tiles) {
  const W = tiles.length, H = tiles[0].length, open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !blockedTile(tiles[x][y]);
  const step = (x, y, dx, dy) => open(x + dx, y + dy) && (!dx || !dy || (open(x + dx, y) && open(x, y + dy)));
  const lanes = [];
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    if (!open(x, y)) continue;
    for (const [nx, ny] of [[0, -1], [0, 1], [-1, 0], [1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { // n: towards the flat wall
      for (let off = 0; off <= MAX_OFF; off++) {
        // the strip: open floor for `off` tiles towards the wall, then the wall
        let strip = true; for (let k = 1; k <= off; k++) if (!open(x + k * nx, y + k * ny)) { strip = false; break; }
        if (!strip || open(x + (off + 1) * nx, y + (off + 1) * ny)) continue;
        for (const s of [1, -1]) {
          const fx = -ny * s, fy = nx * s; // forward, along the wall
          // the bump ahead covers the carrier's row and every row between it and the wall
          let bump = true; for (let k = 0; k <= off; k++) if (step(x + k * nx, y + k * ny, fx, fy)) { bump = false; break; }
          if (!bump) continue;
          // back along the wall while it stays flat at this distance and the strip stays open
          let len = 0, ended = false;
          for (;;) {
            const bx = x - (len + 1) * fx, by = y - (len + 1) * fy;
            let ok = step(x - len * fx, y - len * fy, -fx, -fy);
            for (let k = 1; ok && k <= off; k++) ok = open(bx + k * nx, by + k * ny);
            // the wall stepping away ends the flat, except a one-tile notch (one tile deep, then wall again)
            const notch = open(bx + (off + 1) * nx, by + (off + 1) * ny) && !open(bx + (off + 2) * nx, by + (off + 2) * ny) && !open(bx - fx + (off + 1) * nx, by - fy + (off + 1) * ny);
            if (!ok || (open(bx + (off + 1) * nx, by + (off + 1) * ny) && !notch)) { ended = true; break; }
            len++; if (len > MAX_FLAT) break;
          }
          if (!ended || len < MIN_FLAT) continue;
          lanes.push({ from: [x - len * fx, y - len * fy], to: [x, y], off });
        }
      }
    }
  }
  return lanes;
}

// route distance (tiles, 8 directions) from every floor tile to the nearest of the goal tiles
function distTo(tiles, goals) {
  const W = tiles.length, H = tiles[0].length, d = tiles.map((c) => c.map(() => Infinity)), q = [];
  for (const [x, y] of goals) { d[x][y] = 0; q.push([x, y]); }
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !blockedTile(tiles[x][y]);
  for (let i = 0; i < q.length; i++) { const [x, y] = q[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const u = x + dx, v = y + dy; if (!open(u, v) || (dx && dy && (!open(u, y) || !open(x, v)))) continue;
      const nd = d[x][y] + (dx && dy ? 1.414 : 1); if (nd < d[u][v] - 1e-9) { d[u][v] = nd; q.push([u, v]); } } }
  return d;
}

if (require.main === module) {
  const out = {};
  for (const key of mapKeys()) {
    const m = getMap(key);
    // forward or backward for each team: does the run take that team's carrier closer to where it scores? Its own flag
    // on capture-the-flag maps; on neutral-flag maps its end zone (red 17, blue 18, as tagpro-local's bots score)
    const goals = { 1: [], 2: [] };
    for (let x = 0; x < m.tiles.length; x++) for (let y = 0; y < m.tiles[0].length; y++) {
      const v = parseFloat(m.tiles[x][y]), f = Math.floor(v);
      if (f === 3) goals[1].push([x, y]); if (f === 4) goals[2].push([x, y]);
    }
    if (!goals[1].length || !goals[2].length) for (let x = 0; x < m.tiles.length; x++) for (let y = 0; y < m.tiles[0].length; y++) {
      const v = parseFloat(m.tiles[x][y]); if (v === 17) goals[1].push([x, y]); if (v === 18) goals[2].push([x, y]);
    }
    const F = {}; for (const t of [1, 2]) if (goals[t].length) F[t] = distTo(m.tiles, goals[t]);
    const lanes = lanesOf(m.tiles).map((l) => ({ ...l, fwd: F[1] && F[2] ? { 1: F[1][l.to[0]][l.to[1]] < F[1][l.from[0]][l.from[1]],
      2: F[2][l.to[0]][l.to[1]] < F[2][l.from[0]][l.from[1]] } : null }));
    out[key] = { name: (m.info && m.info.name) || key, pinches: pinchesOf(m.tiles), lanes };
    console.log(out[key].name.padEnd(28), out[key].pinches.length, 'safety nets,', out[key].lanes.length, 'kill points');
  }
  fs.writeFileSync(path.join(__dirname, 'pinches.json'), JSON.stringify(out));
}
module.exports = { pinchesOf, cornersOf, lanesOf, blockedTile };
