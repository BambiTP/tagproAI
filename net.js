// net.js - run a network trained by train.js, one position at a time.
const fs = require('fs');
const X = require('./features');

class Net {
  constructor(file = 'net.json') {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    Object.assign(this, { IN: j.IN, H: j.H, OUT: j.OUT });
    for (const k of ['W1', 'b1', 'W2', 'b2', 'W3', 'b3']) this[k] = Float32Array.from(j[k]);
    // a network trained on the boost-aware view (version 2) needs the live tiles: set net.tiles = sim.tiles
    this.v2 = j.IN === X.SIZE2; this.tiles = null; this.est = this.v2 ? X.LAYOUT[2].est : X.LAYOUT[1].est;
    this.f = new Float32Array(j.IN); this.a1 = new Float32Array(j.H); this.a2 = new Float32Array(j.H); this.out = new Float32Array(j.OUT);
  }
  // out[0..8]: a score per move; out[9]: seconds left (hand-written estimate + learned correction)
  run(task, x, y, vx, vy) {
    const { IN, H, OUT, f, a1, a2, out } = this;
    if (this.v2) { if (!this.tiles) throw new Error('this network needs net.tiles'); X.features2(task, x, y, vx, vy, this.tiles, f); }
    else X.features(task, x, y, vx, vy, f);
    layer(f, this.W1, this.b1, a1, IN, H, true); layer(a1, this.W2, this.b2, a2, H, H, true); layer(a2, this.W3, this.b3, out, H, OUT, false);
    out[9] += f[this.est] * 4;
    return out;
  }
  move(task, x, y, vx, vy) { const o = this.run(task, x, y, vx, vy); let b = 0; for (let j = 1; j < 9; j++) if (o[j] > o[b]) b = j; return b; }
  ticksLeft(task, x, y, vx, vy) { return Math.max(0, this.run(task, x, y, vx, vy)[9] * 60); }
}
function layer(x, W, b, y, n, m, relu) {
  y.set(b);
  for (let p = 0; p < n; p++) { const a = x[p]; if (a === 0) continue; const o = p * m; for (let j = 0; j < m; j++) y[j] += a * W[o + j]; }
  if (relu) for (let j = 0; j < m; j++) if (y[j] < 0) y[j] = 0;
}
module.exports = { Net };
