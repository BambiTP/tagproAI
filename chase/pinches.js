// chase/pinches.js - pinch points on every map in the rotation: places where the open floor is narrow across and
// opens up a lot just beyond (the carrier gets free space once it is through). Spikes count as walls.
//   node chase/pinches.js   -> chase/pinches.json { mapKey: { name, pinches: [{ a, b, width, open }] } }
// For every floor tile, in 4 directions (across, up-down, both diagonals): the chord = the straight run of open floor
// through it. A chord is a pinch when it is at most MAX_WIDTH tiles long, no longer than the parallel chords one tile to
// either side, the floor continues on both sides (not a dead end), and 2-4 tiles to one side the parallel chords are
// much longer (at least 3 tiles and half as long again). Nearby pinches (middles within 2 tiles) keep the narrowest.
const fs = require('fs'), path = require('path');
const { getMap, mapKeys } = require('../sim');

const MAX_WIDTH = 8;
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

if (require.main === module) {
  const out = {};
  for (const key of mapKeys()) {
    const m = getMap(key);
    out[key] = { name: (m.info && m.info.name) || key, pinches: pinchesOf(m.tiles) };
    console.log(out[key].name.padEnd(28), out[key].pinches.length, 'pinches');
  }
  fs.writeFileSync(path.join(__dirname, 'pinches.json'), JSON.stringify(out));
}
module.exports = { pinchesOf, blockedTile };
