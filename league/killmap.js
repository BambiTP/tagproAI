// league/killmap.js - kill area maps for one carrier against two chasers on open floor.
// The carrier sits in the middle heading right (towards its goal) at speed FS. Chaser A is fixed in front of it, heading
// at it. For every spot around the carrier, chaser B there (heading straight at the carrier at speed CS) is coloured:
//   green  = B alone has a certain kill (holding one key touches the carrier whatever it does)
//   yellow = neither alone, but together they do: at some tick everywhere the carrier could be is within touching
//            distance of A or of B (each holding its own key)
//   dark   = no certain kill
// "Whatever it does": the carrier may push any way every tick after REACT ticks (the same test as chase/killtest.js sure).
//   node league/killmap.js   -> recordings/killmap.png (a sheet of panels; served on the files page, port 8091)
const fs = require('fs'), path = require('path');
const { PNG } = require('pngjs');
const { ACTIONS } = require('../sim');

const DT = 1 / 60, DAMP = 1 - 0.5 / 60, ACC = 0.025, MS = 2.5, TOUCH = 0.375, MAX_T = 90, REACT = 6;
function kin(b, a) { let [x, y, vx, vy] = b; vx *= DAMP; vy *= DAMP; const [ax, ay] = ACTIONS[a];
  if (ax > 0 && vx < MS) vx += ACC; if (ax < 0 && vx > -MS) vx -= ACC; if (ay > 0 && vy < MS) vy += ACC; if (ay < 0 && vy > -MS) vy -= ACC;
  return [x + vx * DT, y + vy * DT, vx, vy]; }
// the chasers' paths holding keys, and whether the carrier's reachable square is ever inside their touch circles
function paths(c, k) { const out = []; let b = c; for (let t = 0; t < MAX_T; t++) { b = kin(b, k); out.push(b); } return out; }
function carrierSquares(f) { const out = []; let [x, y, vx, vy] = f, vs = 0, sp = 0;
  for (let t = 1; t <= MAX_T; t++) { vx *= DAMP; vy *= DAMP; x += vx * DT; y += vy * DT; vs = t > REACT ? vs * DAMP + ACC : vs * DAMP; sp += vs * DT; out.push([x, y, sp]); } return out; }
// is the square (centre x, y, half-side h) inside the union of circles around the given points? (checked on a 5x5 grid)
function covered(x, y, h, pts) {
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const px = x - h + h * i / 2, py = y - h + h * j / 2;
    if (!pts.some(([cx, cy]) => Math.hypot(px - cx, py - cy) < TOUCH)) return false; }
  return true;
}
function solo(sq, P) { for (let t = 0; t < MAX_T; t++) { const [x, y, h] = sq[t], c = P[t]; if (Math.hypot(Math.abs(x - c[0]) + h, Math.abs(y - c[1]) + h) < TOUCH) return true; } return false; }
function pair(sq, P, Q) { for (let t = 0; t < MAX_T; t++) { const [x, y, h] = sq[t]; if (covered(x, y, h, [P[t], Q[t]])) return true; } return false; }

function panel(FS, CS, A, onlyA = false) {
  const f = [0, 0, FS, 0], sq = carrierSquares(f), R = 3.2, S = 220, img = [];
  const aState = [A[0], A[1], ...(() => { const d = Math.hypot(A[0], A[1]) || 1; return [-A[0] / d * CS, -A[1] / d * CS]; })()];
  const aPaths = []; for (let k = 1; k <= 8; k++) aPaths.push(paths(aState, k));
  const aSolo = aPaths.some((P) => solo(sq, P)); if (onlyA) return aSolo;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = -R + 2 * R * (i + 0.5) / S, y = -R + 2 * R * (j + 0.5) / S, d = Math.hypot(x, y);
    if (d < 0.4) { img.push(3); continue; }
    const b = [x, y, -x / d * CS, -y / d * CS], bPaths = []; for (let k = 1; k <= 8; k++) bPaths.push(paths(b, k));
    if (bPaths.some((P) => solo(sq, P))) img.push(1);
    else if (!aSolo && aPaths.some((P) => bPaths.some((Q) => pair(sq, P, Q)))) img.push(2);
    else img.push(0);
  }
  return { img, S, R, aSolo };
}

if (require.main === module) {
  const cases = []; for (const FS of [0.5, 1.5, 2.5]) for (const CS of [1, 2, 3]) cases.push([FS, CS]);
  const P = 220, PAD = 8, cols = 3, rows = 3, W = cols * (P + PAD) + PAD, H = rows * (P + PAD) + PAD;
  const png = new PNG({ width: W, height: H }); png.data.fill(20);
  const COL = [[40, 40, 40], [60, 200, 90], [235, 200, 60], [255, 255, 255]];
  cases.forEach(([FS, CS], n) => {
    // chaser A: ahead of the carrier and off to one side, at the closest spot along that line where it can't kill alone
    let A = null; for (let r = 0.8; r < 3.2; r += 0.1) { const a = [r * 0.8, -r * 0.6]; if (!panel(FS, CS, a, true)) { A = a; break; } }
    const { img, S, R } = panel(FS, CS, A), ox = PAD + (n % cols) * (P + PAD), oy = PAD + Math.floor(n / cols) * (P + PAD);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const c = COL[img[j * S + i]], o = ((oy + j) * W + ox + i) * 4; png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]; png.data[o + 3] = 255; }
    // chaser A as a red dot, the carrier's heading as a white tick
    const dot = (x, y, c, r) => { for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) { const px = Math.round(ox + (x + R) / (2 * R) * S) + a, py = Math.round(oy + (y + R) / (2 * R) * S) + b, o = (py * W + px) * 4; png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]; png.data[o + 3] = 255; } };
    dot(A[0], A[1], [230, 60, 60], 2); for (let s = 0; s < 0.6; s += 0.05) dot(s, 0, [255, 255, 255], 0);
    console.log(`panel ${n}: carrier ${FS} m/s, chasers ${CS} m/s, chaser A at (${A.map((v) => v.toFixed(2)).join(', ')}) m, green ${img.filter((v) => v === 1).length} yellow ${img.filter((v) => v === 2).length} cells`);
  });
  const out = path.join(__dirname, '..', 'recordings', 'killmap.png');
  fs.writeFileSync(out, PNG.sync.write(png)); console.log(out);
}
module.exports = { panel };
