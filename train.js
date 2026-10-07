// train.js - train the network on gen.js recordings in runs/train/*.bin.
//   node train.js [epochs=20] [out=net.json]
// Two outputs from one small network: which move the planning bot made (9-way), and the seconds the
// ball still needed to touch the goal, learned as a correction to the hand-written estimate (so it starts
// out as good as that). Puzzles whose seed ends in 0 are held out to check on.
const fs = require('fs'), path = require('path');
const X = require('./features');
const ROW = X.SIZE + 4, IN = X.SIZE, H = 128, OUT = 10, LAMBDA = 1, BATCH = 256;
const HUBER = 0.05;  // seconds: time-left error counts linearly past this, like the average-error score
const DECAY = 1e-4;  // weight decay, against memorising

// ---------- the 8 mirror/rotation copies of a lesson: same physics, mirrored keys ----------
const ACTIONS = [[0, 0], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
const SYMS = [];
for (const swap of [false, true]) for (const sx of [1, -1]) for (const sy of [1, -1]) SYMS.push({ swap, sx, sy });
const vec = (S, x, y) => { if (S.swap) [x, y] = [y, x]; return [x * S.sx, y * S.sy]; };
const symAction = SYMS.map((S) => ACTIONS.map(([x, y]) => { const [a, b] = vec(S, x, y); return ACTIONS.findIndex(([p, q]) => p === a && q === b); }));
const symCell = SYMS.map((S) => { // where each window cell lands
  const m = new Int32Array(X.S * X.S);
  for (let dx = -X.R; dx <= X.R; dx++) for (let dy = -X.R; dy <= X.R; dy++) {
    const [a, b] = vec(S, dx, dy); m[(dx + X.R) * X.S + (dy + X.R)] = (a + X.R) * X.S + (b + X.R);
  }
  return m;
});
function symmetric(src, dst, k) {
  const S = SYMS[k], cells = X.S * X.S, m = symCell[k], o = X.CH * cells;
  for (let ch = 0; ch < X.CH; ch++) for (let c = 0; c < cells; c++) dst[ch * cells + m[c]] = src[ch * cells + c];
  for (let i = o; i < IN; i++) dst[i] = src[i];
  for (const j of [0, 2, 4, 7]) { const [a, b] = vec(S, src[o + j], src[o + j + 1]); dst[o + j] = a; dst[o + j + 1] = b; } // velocity, spot in tile, goal and route directions
}

function load() {
  const dir = path.join(__dirname, 'runs', 'train');
  const parts = fs.readdirSync(dir).filter((f) => f.endsWith('.bin')).map((f) => fs.readFileSync(path.join(dir, f)));
  const chunks = parts.map((b) => {
    const k = Math.floor(b.length / 4 / ROW) * ROW; // whole rows only: a recorder may be mid-write
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + k * 4));
  });
  const all = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  return all;
}

// ---------- the network: IN -> H -> H -> OUT, ReLU ----------
function init() {
  const he = (n, fan) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = gauss() * Math.sqrt(2 / fan); return a; };
  return { W1: he(IN * H, IN), b1: new Float32Array(H), W2: he(H * H, H), b2: new Float32Array(H),
    W3: he(H * OUT, H).map((v) => v * 0.5), b3: new Float32Array(OUT) };
}
let spare = null;
function gauss() {
  if (spare !== null) { const s = spare; spare = null; return s; }
  const u = Math.random() || 1e-9, v = Math.random(), r = Math.sqrt(-2 * Math.log(u));
  spare = r * Math.sin(2 * Math.PI * v); return r * Math.cos(2 * Math.PI * v);
}
// C[n x m] = A[n x k] B[k x m] + bias
function mm(A, B, bias, C, n, k, m) {
  for (let i = 0; i < n; i++) {
    const ci = i * m; for (let j = 0; j < m; j++) C[ci + j] = bias[j];
    for (let p = 0; p < k; p++) { const a = A[i * k + p]; if (a === 0) continue; const bp = p * m; for (let j = 0; j < m; j++) C[ci + j] += a * B[bp + j]; }
  }
}
// G[k x m] += A[n x k]^T D[n x m]
function mmTA(A, D, G, n, k, m) {
  for (let i = 0; i < n; i++) for (let p = 0; p < k; p++) {
    const a = A[i * k + p]; if (a === 0) continue; const gp = p * m, di = i * m;
    for (let j = 0; j < m; j++) G[gp + j] += a * D[di + j];
  }
}
// E[n x k] = D[n x m] B[k x m]^T
function mmTB(D, B, E, n, m, k) {
  for (let i = 0; i < n; i++) for (let p = 0; p < k; p++) {
    let s = 0; const di = i * m, bp = p * m; for (let j = 0; j < m; j++) s += D[di + j] * B[bp + j]; E[i * k + p] = s;
  }
}

function forward(net, Xb, n, keep) {
  const Z1 = new Float32Array(n * H), Z2 = new Float32Array(n * H), Z3 = new Float32Array(n * OUT);
  mm(Xb, net.W1, net.b1, Z1, n, IN, H); const A1 = Z1.map((v) => (v > 0 ? v : 0));
  mm(A1, net.W2, net.b2, Z2, n, H, H); const A2 = Z2.map((v) => (v > 0 ? v : 0));
  mm(A2, net.W3, net.b3, Z3, n, H, OUT);
  return keep ? { Z1, A1, Z2, A2, Z3 } : Z3;
}

function step(net, opt, Xb, act, left, n, lr) {
  const { Z1, A1, Z2, A2, Z3 } = forward(net, Xb, n, true);
  const D3 = new Float32Array(n * OUT); let loss = 0;
  for (let i = 0; i < n; i++) {
    const z = Z3.subarray(i * OUT, i * OUT + 9); let mx = -Infinity; for (const v of z) mx = Math.max(mx, v);
    let s = 0; for (let j = 0; j < 9; j++) s += Math.exp(z[j] - mx);
    for (let j = 0; j < 9; j++) D3[i * OUT + j] = (Math.exp(z[j] - mx) / s - (j === act[i] ? 1 : 0)) / n;
    loss += -(z[act[i]] - mx - Math.log(s));
    const e = Z3[i * OUT + 9] - left[i], ae = Math.abs(e);
    D3[i * OUT + 9] = LAMBDA * (ae <= HUBER ? e / HUBER : Math.sign(e)) / n; loss += LAMBDA * (ae <= HUBER ? e * e / (2 * HUBER) : ae - HUBER / 2);
  }
  const g = { W1: new Float32Array(IN * H), b1: new Float32Array(H), W2: new Float32Array(H * H), b2: new Float32Array(H), W3: new Float32Array(H * OUT), b3: new Float32Array(OUT) };
  mmTA(A2, D3, g.W3, n, H, OUT); for (let i = 0; i < n; i++) for (let j = 0; j < OUT; j++) g.b3[j] += D3[i * OUT + j];
  const D2 = new Float32Array(n * H); mmTB(D3, net.W3, D2, n, OUT, H); for (let i = 0; i < D2.length; i++) if (Z2[i] <= 0) D2[i] = 0;
  mmTA(A1, D2, g.W2, n, H, H); for (let i = 0; i < n; i++) for (let j = 0; j < H; j++) g.b2[j] += D2[i * H + j];
  const D1 = new Float32Array(n * H); mmTB(D2, net.W2, D1, n, H, H); for (let i = 0; i < D1.length; i++) if (Z1[i] <= 0) D1[i] = 0;
  mmTA(Xb, D1, g.W1, n, IN, H); for (let i = 0; i < n; i++) for (let j = 0; j < H; j++) g.b1[j] += D1[i * H + j];
  // Adam
  opt.t++; const b1 = 0.9, b2 = 0.999, c1 = 1 - b1 ** opt.t, c2 = 1 - b2 ** opt.t;
  for (const k in g) {
    const w = net[k], gk = g[k], m = opt.m[k], v = opt.v[k];
    for (let i = 0; i < w.length; i++) {
      m[i] = b1 * m[i] + (1 - b1) * gk[i]; v[i] = b2 * v[i] + (1 - b2) * gk[i] * gk[i];
      w[i] -= lr * ((m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8) + (k[0] === 'W' ? DECAY * w[i] : 0));
    }
  }
  return loss / n;
}

// the hand-written estimate in seconds, from its slot in the features
const handSecs = (a, r) => a[r + IN - 2] * 4;

function gather(all, idx, from, n, augment) {
  const Xb = new Float32Array(n * IN), act = new Int32Array(n), left = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = idx[from + i] * ROW, k = augment ? Math.floor(Math.random() * 8) : 0;
    if (k) symmetric(all.subarray(r, r + IN), Xb.subarray(i * IN, (i + 1) * IN), k); else Xb.set(all.subarray(r, r + IN), i * IN);
    act[i] = symAction[k][all[r + IN]]; left[i] = all[r + IN + 1] - handSecs(all, r); // learn the correction
  }
  return { Xb, act, left };
}

function evaluate(net, all, idx) {
  let right = 0, mae = 0, estMae = 0;
  for (let from = 0; from < idx.length; from += 1024) {
    const n = Math.min(1024, idx.length - from), { Xb, act, left } = gather(all, idx, from, n), Z = forward(net, Xb, n);
    for (let i = 0; i < n; i++) {
      let best = 0; for (let j = 1; j < 9; j++) if (Z[i * OUT + j] > Z[i * OUT + best]) best = j;
      if (best === act[i]) right++;
      mae += Math.abs(Z[i * OUT + 9] - left[i]); // both measured as corrections: the hand estimate's is 0
      estMae += Math.abs(left[i]);
    }
  }
  return { moveMatch: right / idx.length, timeErr: mae / idx.length, handErr: estMae / idx.length };
}

if (require.main === module) {
  const [epochs = '20', out = 'net.json'] = process.argv.slice(2);
  const all = load(), rows = all.length / ROW, train = [], val = [];
  const seeds = new Set();
  for (let i = 0; i < rows; i++) { const s = all[i * ROW + IN + 2]; seeds.add(s); (s % 10 === 0 ? val : train).push(i); }
  console.log(`${rows} decisions from ${seeds.size} puzzles: ${train.length} to train on, ${val.length} held out`);
  const LOG = path.join(__dirname, 'runs', 'train', 'train-log.jsonl'), run = new Date().toISOString();
  const net = init(), opt = { t: 0, m: {}, v: {} };
  for (const k in net) { opt.m[k] = new Float32Array(net[k].length); opt.v[k] = new Float32Array(net[k].length); }
  let lr = 1e-3, best = Infinity;
  for (let e = 1; e <= +epochs; e++) {
    for (let i = train.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [train[i], train[j]] = [train[j], train[i]]; }
    const t0 = Date.now(); let loss = 0, nb = 0;
    for (let from = 0; from + BATCH <= train.length; from += BATCH) {
      const { Xb, act, left } = gather(all, train, from, BATCH, true); loss += step(net, opt, Xb, act, left, BATCH, lr); nb++;
    }
    const r = evaluate(net, all, val);
    console.log(`epoch ${e}: loss ${(loss / nb).toFixed(3)}, held-out: same move as the bot ${(r.moveMatch * 100).toFixed(1)}%, ` +
      `time-left error ${r.timeErr.toFixed(3)} s (hand-written estimate ${r.handErr.toFixed(3)} s), ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    fs.appendFileSync(LOG, JSON.stringify({ run, at: Date.now(), epoch: e, epochs: +epochs, puzzles: seeds.size, decisions: rows,
      loss: loss / nb, moveMatch: r.moveMatch, timeErr: r.timeErr, handErr: r.handErr, out }) + '\n');
    lr *= 0.9;
    // keep the pass that predicts time left best on held-out puzzles (later passes may memorise)
    if (r.timeErr < best) {
      best = r.timeErr;
      fs.writeFileSync(out, JSON.stringify({ IN, H, OUT, epoch: e, ...r, ...Object.fromEntries(Object.entries(net).map(([k, v]) => [k, Array.from(v)])) }));
    }
  }
}
module.exports = { forward, handSecs, symmetric, symAction };
