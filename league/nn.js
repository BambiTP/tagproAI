// league/nn.js - a small network for trial-and-error learning (PPO), plain JavaScript, no graphics card.
// Two hidden layers (tanh); a policy head (9 keys: none + 8 directions) and a value head (expected result, -1..1).
// act() picks keys for one view; update() learns from a batch of recorded decisions.
const H = 64, A = 9;

function rnd(seedObj) { seedObj.s = (seedObj.s * 1664525 + 1013904223) >>> 0; return seedObj.s / 2 ** 32; }
function gauss(r) { let u = 0; while (!u) u = rnd(r); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd(r)); }

class Net {
  constructor(IN, seed = 1) {
    this.IN = IN; const r = { s: seed >>> 0 || 1 };
    const mat = (n, m, sc) => Float32Array.from({ length: n * m }, () => gauss(r) * sc);
    // layer sizes: IN -> H -> H -> (A policy, 1 value)
    this.p = { W1: mat(IN, H, Math.sqrt(1 / IN)), b1: new Float32Array(H), W2: mat(H, H, Math.sqrt(1 / H)), b2: new Float32Array(H),
      Wp: mat(H, A, 0.01), bp: new Float32Array(A), Wv: mat(H, 1, Math.sqrt(1 / H)), bv: new Float32Array(1) };
    this.m = {}; this.v = {}; for (const k in this.p) { this.m[k] = new Float32Array(this.p[k].length); this.v[k] = new Float32Array(this.p[k].length); }
    this.t = 0;
  }
  // forward pass for one view x: hidden activations, key probabilities, value
  forward(x) {
    const { W1, b1, W2, b2, Wp, bp, Wv, bv } = this.p, IN = this.IN;
    const h1 = new Float32Array(H), h2 = new Float32Array(H), lg = new Float32Array(A);
    for (let j = 0; j < H; j++) { let s = b1[j]; for (let i = 0; i < IN; i++) s += x[i] * W1[i * H + j]; h1[j] = Math.tanh(s); }
    for (let j = 0; j < H; j++) { let s = b2[j]; for (let i = 0; i < H; i++) s += h1[i] * W2[i * H + j]; h2[j] = Math.tanh(s); }
    let mx = -Infinity; for (let a = 0; a < A; a++) { let s = bp[a]; for (let i = 0; i < H; i++) s += h2[i] * Wp[i * A + a]; lg[a] = s; if (s > mx) mx = s; }
    let z = 0; const pr = new Float32Array(A); for (let a = 0; a < A; a++) { pr[a] = Math.exp(lg[a] - mx); z += pr[a]; } for (let a = 0; a < A; a++) pr[a] /= z;
    let v = bv[0]; for (let i = 0; i < H; i++) v += h2[i] * Wv[i];
    return { h1, h2, pr, v: Math.tanh(v) };
  }
  // pick keys: sampled (training) or the most likely (greedy)
  act(x, rng, greedy = false) {
    const f = this.forward(x);
    if (greedy) { let b = 0; for (let a = 1; a < A; a++) if (f.pr[a] > f.pr[b]) b = a; return { a: b, logp: Math.log(f.pr[b] + 1e-8), v: f.v }; }
    let u = rng(), a = 0; while (a < A - 1 && (u -= f.pr[a]) > 0) a++;
    return { a, logp: Math.log(f.pr[a] + 1e-8), v: f.v };
  }
  // PPO: batch of { x, a, logp (when chosen), adv (advantage), ret (target value) }
  update(batch, { epochs = 4, mb = 256, lr = 3e-4, clip = 0.2, vcoef = 0.5, ent = 0.01 } = {}) {
    const keys = Object.keys(this.p), g = {}; for (const k of keys) g[k] = new Float32Array(this.p[k].length);
    const IN = this.IN, { W1, W2, Wp, Wv } = this.p; let stats = { pl: 0, vl: 0, en: 0, n: 0, clipped: 0 };
    const idx = batch.map((_, i) => i);
    for (let ep = 0; ep < epochs; ep++) {
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      for (let s = 0; s < idx.length; s += mb) {
        for (const k of keys) g[k].fill(0);
        const part = idx.slice(s, s + mb);
        for (const bi of part) {
          const d = batch[bi], f = this.forward(d.x), { h1, h2, pr } = f;
          const ratio = Math.exp(Math.log(pr[d.a] + 1e-8) - d.logp), clipped = (d.adv > 0 && ratio > 1 + clip) || (d.adv < 0 && ratio < 1 - clip);
          // gradient of the loss with respect to the logits: policy (clipped surrogate) and entropy bonus
          const dl = new Float32Array(A); let H_ = 0; for (let a = 0; a < A; a++) H_ -= pr[a] * Math.log(pr[a] + 1e-8);
          if (!clipped) for (let a = 0; a < A; a++) dl[a] += -d.adv * ratio * ((a === d.a ? 1 : 0) - pr[a]);
          for (let a = 0; a < A; a++) dl[a] += ent * pr[a] * (Math.log(pr[a] + 1e-8) + H_); // d(-entropy)/dlogit
          // value: squared error on tanh(output)
          const vErr = f.v - d.ret, dv = vcoef * 2 * vErr * (1 - f.v * f.v);
          stats.pl += -Math.min(ratio * d.adv, Math.max(Math.min(ratio, 1 + clip), 1 - clip) * d.adv); stats.vl += vErr * vErr; stats.en += H_; stats.n++; if (clipped) stats.clipped++;
          // back through the heads to the second hidden layer
          const dh2 = new Float32Array(H);
          for (let i = 0; i < H; i++) { let s2 = dv * Wv[i]; for (let a = 0; a < A; a++) { s2 += dl[a] * Wp[i * A + a]; g.Wp[i * A + a] += h2[i] * dl[a]; } g.Wv[i] += h2[i] * dv; dh2[i] = s2 * (1 - h2[i] * h2[i]); }
          for (let a = 0; a < A; a++) g.bp[a] += dl[a]; g.bv[0] += dv;
          const dh1 = new Float32Array(H);
          for (let i = 0; i < H; i++) { let s1 = 0; for (let j = 0; j < H; j++) { s1 += dh2[j] * W2[i * H + j]; g.W2[i * H + j] += h1[i] * dh2[j]; } dh1[i] = s1 * (1 - h1[i] * h1[i]); }
          for (let j = 0; j < H; j++) { g.b2[j] += dh2[j]; g.b1[j] += dh1[j]; }
          for (let i = 0; i < IN; i++) { const xi = d.x[i]; if (xi) for (let j = 0; j < H; j++) g.W1[i * H + j] += xi * dh1[j]; }
        }
        this.adam(g, part.length, lr);
      }
    }
    return { policyLoss: stats.pl / stats.n, valueLoss: stats.vl / stats.n, entropy: stats.en / stats.n, clipped: stats.clipped / stats.n };
  }
  adam(g, n, lr, b1 = 0.9, b2 = 0.999) {
    this.t++; const c1 = 1 - b1 ** this.t, c2 = 1 - b2 ** this.t;
    for (const k in this.p) { const P = this.p[k], M = this.m[k], V = this.v[k], G = g[k];
      for (let i = 0; i < P.length; i++) { const gi = Math.max(-5, Math.min(5, G[i] / n)); M[i] = b1 * M[i] + (1 - b1) * gi; V[i] = b2 * V[i] + (1 - b2) * gi * gi; P[i] -= lr * (M[i] / c1) / (Math.sqrt(V[i] / c2) + 1e-8); } }
  }
  toJSON() { const o = { IN: this.IN, t: this.t, p: {} }; for (const k in this.p) o.p[k] = Array.from(this.p[k]); return o; }
  static fromJSON(o) { const n = new Net(o.IN); for (const k in o.p) n.p[k] = Float32Array.from(o.p[k]); n.t = o.t || 0; return n; }
  clone() { return Net.fromJSON(JSON.parse(JSON.stringify(this.toJSON()))); }
}
module.exports = { Net, A };
