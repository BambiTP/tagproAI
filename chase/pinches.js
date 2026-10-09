// chase/pinches.js - pinch points on every map in the rotation: places where the open floor is narrow across and
// opens up a lot just beyond (the carrier gets free space once it is through). Spikes count as walls.
//   node chase/pinches.js   -> chase/pinches.json { mapKey: { name, pinches: [{ a, b, width, open }], corners: [[x, y, dirs]] } }
// Corners: floor tiles where the free run is CORNER tiles or less in two directions at right angles (e.g. a wall just
// above and a wall just to the left), and also along both diagonals that run beside those walls (up-right and
// down-left for that example): a carrier there cannot keep going any of those ways. Beside a slanted (45 degree) wall
// one of those diagonals is a long free run, so slanted walls do not count. dirs names the two blocked directions.
// Dead-end lanes: a strip along a wall that ends where a wall juts in across it. A carrier running along the wall gets
// boxed in, so a chaser only has to hold one line parallel to the wall (depth tiles out from it) back from the jut.
// lanes: [{ from, to, depth, guard: [a, b] }] (tile coordinates; from -> to runs along the wall into the dead end).
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

function lanesOf(tiles, minLen = 3, maxLen = 15, maxDepth = 3) {
  const W = tiles.length, H = tiles[0].length, open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !blockedTile(tiles[x][y]);
  const out = [];
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    if (!open(x, y)) continue;
    for (const [nx, ny] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { // n: towards the wall being hugged
      if (open(x + nx, y + ny)) continue;
      for (const s of [1, -1]) {
        const fx = -ny * s, fy = nx * s; // forward, along the wall
        if (open(x + fx, y + fy)) continue; // the end of a lane: a wall straight ahead
        // how far the jut reaches out from the hugged wall (tiles from the wall, within the lane, blocked ahead)
        let depth = 1;
        while (depth < maxDepth && open(x - depth * nx, y - depth * ny) && !open(x - depth * nx + fx, y - depth * ny + fy)) depth++;
        // back along the wall while it stays unbroken (no way out on the wall side) and the floor continues
        let len = 0;
        while (len < maxLen && open(x - (len + 1) * fx, y - (len + 1) * fy) && !open(x - (len + 1) * fx + nx, y - (len + 1) * fy + ny)) len++;
        if (len < minLen) continue;
        // there must be open floor beyond the guard line (otherwise it is a corridor, not a lane off open space)
        const gx = x - depth * nx, gy = y - depth * ny;
        if (!open(gx, gy)) continue;
        out.push({ from: [x - len * fx, y - len * fy], to: [x, y], depth,
          guard: [[gx - nx * 0.5 - len * fx, gy - ny * 0.5 - len * fy], [gx - nx * 0.5, gy - ny * 0.5]] });
      }
    }
  }
  return out;
}

if (require.main === module) {
  const out = {};
  for (const key of mapKeys()) {
    const m = getMap(key);
    out[key] = { name: (m.info && m.info.name) || key, pinches: pinchesOf(m.tiles), corners: cornersOf(m.tiles), lanes: lanesOf(m.tiles) };
    console.log(out[key].name.padEnd(28), out[key].pinches.length, 'pinches,', out[key].lanes.length, 'dead-end lanes');
  }
  fs.writeFileSync(path.join(__dirname, 'pinches.json'), JSON.stringify(out));
}
module.exports = { pinchesOf, cornersOf, lanesOf, blockedTile };
