// chase/blocks.js - real blocks in ranked replays: a flag carrier's teammate touching an enemy who was closing in
// on the carrier. What happened to that enemy's chase, what happened to the carrier, and where the blocker was.
//   node chase/blocks.js <list of replay files> <first> <count>   -> chase/results/blocks.jsonl
// Sampled 20 times a second. A "threat" moment: an alive enemy within 6 tiles (straight line) of the carrier and
// closing faster than 0.5 m/s over the last half second, with a carrier's teammate within 4 tiles of that enemy.
// It is a block when the teammate and the enemy touch (centres within 0.5 m: replay positions are blurred around
// contact) within the next half second; otherwise it is a "no contact" moment, for comparison. One record per
// (carrier, enemy, teammate) per second at most. Outcomes: the enemy's closing speed in the next second, whether
// that enemy returned the carrier within 3 s, and whether the carrier was returned / capped within 10 s.
const fs = require('fs'), path = require('path');
const X = require('./extract');

const HZ = 20, STEP = 1000 / HZ, TILE = 0.4, CONTACT = 0.5;
const dist = (a, b) => Math.hypot(a[1] - b[1], a[2] - b[2]);

function blocks(file) {
  const g = X.load(file), m = g.meta;
  if (m.mapType !== 'ctf' || g.start == null) return [];
  const { tr, events } = X.tracks(g.L, g.start);
  const ids = Object.keys(tr), end = Math.max(...ids.map((i) => tr[i][tr[i].length - 1][0]));
  const st = (id, t) => { const s = X.at(tr[id], t); return s && !s[6] ? s : null; };
  const out = [], last = {};
  for (let t = g.start + 1000; t < end - 10000; t += STEP) {
    for (const c of ids) {
      const C = st(c, t); if (!C || !C[5]) continue; // a carrier
      const C0 = st(c, t - 500); if (!C0 || !C0[5]) continue; // held for half a second already
      for (const e of ids) {
        const E = st(e, t), E0 = st(e, t - 500); if (!E || !E0 || E[7] === C[7]) continue;
        const d = dist(E, C), close = (dist(E0, C0) - d) / 0.5; // closing speed, m/s
        if (d > 6 * TILE || close < 0.5) continue;
        for (const b of ids) {
          if (b === c) continue;
          const B = st(b, t); if (!B || B[7] !== C[7] || dist(B, E) > 4 * TILE) continue;
          const key = c + '-' + e + '-' + b; if (last[key] && t - last[key] < 1000) continue;
          // contact within the next half second?
          let tc = null; for (let u = t; u <= t + 500; u += STEP) { const Bu = st(b, u), Eu = st(e, u); if (Bu && Eu && dist(Bu, Eu) < CONTACT) { tc = u; break; } }
          const at0 = tc || t, Ct = st(c, at0), Et = st(e, at0), Bt = st(b, at0); if (!Ct || !Et || !Bt) continue;
          last[key] = t;
          // the enemy's closing speed over the next second (from the moment of contact, or now)
          const C1 = st(c, at0 + 1000), E1 = st(e, at0 + 1000);
          const after = C1 && E1 ? (dist(Et, Ct) - dist(E1, C1)) / 1 : null;
          // outcomes: the carrier's flag gone within 3 s / 10 s, and who returned it
          let lost = null; for (let u = at0; u <= at0 + 10000; u += STEP) { const Cu = X.at(tr[c], u); if (!Cu || !Cu[5] || Cu[6]) { lost = u; break; } }
          const ev = lost ? events.filter((x) => Math.abs(x.t - lost) <= 150) : [];
          const capped = ev.some((x) => x.k === 's-captures' && x.id == c), returner = (ev.find((x) => x.k === 's-returns') || {}).id;
          // geometry at that moment: blocker relative to the carrier and the enemy
          const vCE = [Et[1] - Ct[1], Et[2] - Ct[2]], vCB = [Bt[1] - Ct[1], Bt[2] - Ct[2]];
          const ang = Math.abs(Math.atan2(vCE[0] * vCB[1] - vCE[1] * vCB[0], vCE[0] * vCB[0] + vCE[1] * vCB[1])) * 180 / Math.PI;
          // half a second earlier: where the teammate was relative to the carrier-enemy line (u: 0 at the carrier,
          // 1 at the enemy; off: tiles to the side) and how fast it was heading at the enemy (m/s)
          const Cp = st(c, at0 - 500), Ep = st(e, at0 - 500), Bp = st(b, at0 - 500);
          let pre = null;
          if (Cp && Ep && Bp) {
            const lx = Ep[1] - Cp[1], ly = Ep[2] - Cp[2], L2 = lx * lx + ly * ly || 1e-9, bx = Bp[1] - Cp[1], by = Bp[2] - Cp[2];
            const dBE0 = Math.hypot(Ep[1] - Bp[1], Ep[2] - Bp[2]) || 1e-9;
            pre = { u: +((bx * lx + by * ly) / L2).toFixed(2), off: +(Math.abs(bx * ly - by * lx) / Math.sqrt(L2) / TILE).toFixed(2),
              toward: +((Bp[3] * (Ep[1] - Bp[1]) + Bp[4] * (Ep[2] - Bp[2])) / dBE0).toFixed(2), dEC: +(Math.sqrt(L2) / TILE).toFixed(2) };
          }
          out.push({ pre, game: m.uuid.slice(0, 8), map: m.mapName, t: Math.round(at0 - g.start), carrier: +c, enemy: +e, mate: +b, contact: !!tc,
            dEC: +(dist(Et, Ct) / TILE).toFixed(2), dBC: +(dist(Bt, Ct) / TILE).toFixed(2), dBE: +(dist(Bt, Et) / TILE).toFixed(2), angle: Math.round(ang),
            closeBefore: +close.toFixed(2), closeAfter: after == null ? null : +after.toFixed(2),
            enemyReturned3: !!(lost && lost - at0 <= 3000 && returner == e), returned10: !!(lost && !capped), capped10: capped });
        }
      }
    }
  }
  return out;
}

if (require.main === module) {
  const [list, first = '0', count = '20'] = process.argv.slice(2);
  const files = fs.readFileSync(list, 'utf8').split('\n').filter(Boolean).slice(+first, +first + +count);
  const res = path.join(__dirname, 'results'); fs.mkdirSync(res, { recursive: true });
  const fd = fs.openSync(path.join(res, 'blocks' + (process.env.TAG || '') + '.jsonl'), 'a');
  let n = 0, k = 0;
  for (const f of files) {
    try { for (const r of blocks(f)) { fs.writeSync(fd, JSON.stringify(r) + '\n'); n++; if (r.contact) k++; } } catch (e) { console.error(f, e.message); }
  }
  console.log(n, 'threat moments,', k, 'with contact, from', files.length, 'games');
}
module.exports = { blocks };
