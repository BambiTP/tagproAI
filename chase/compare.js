// chase/compare.js - two-against-two plans against a baseline on the same puzzles and nudges
// (results/team-<chasing>-<carrying>-<tag><nudge>.jsonl)
//   node chase/compare.js <tag: f for the fresh puzzles, j for the close ones> <plan> [plan...]
// A plan is a carrying plan (compared with both-alone, chasers unchanged) or <chasing>-<carrying> (BASE=<chasing>-<carrying>
// sets the baseline; default both-alone). "Better" is from the carrier's side: fewer returns.
const fs = require('fs'), path = require('path');
const RES = path.join(__dirname, 'results'), [tag, ...plans] = process.argv.slice(2);
const get = (b) => { const o = {};
  for (const f of fs.readdirSync(RES).filter((f) => new RegExp('^team-' + (b.includes('-') ? b : 'both-' + b) + '-' + tag + '-?0(\\.\\d+)?\\.jsonl$').test(f))) {
    const j = f.match(new RegExp('-' + tag + '(-?0(\\.\\d+)?)\\.jsonl'))[1];
    for (const r of fs.readFileSync(path.join(RES, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))) o[r.id + '|' + j] = r; }
  return o; };
const A = get(process.env.BASE || 'both-alone'), m = (x) => x.reduce((a, b) => a + b, 0) / x.length, ret = (r) => +(r.result === 'returned');
for (const b of plans) {
  const B = get(b), ks = Object.keys(B).filter((k) => A[k]); if (!ks.length) { console.log(b, 'no games yet'); continue; }
  let s = 0, c = 0; for (const k of ks) { if (ret(A[k]) && !ret(B[k])) s++; if (!ret(A[k]) && ret(B[k])) c++; }
  const ids = [...new Set(ks.map((k) => k.split('|')[0]))];
  const d = ids.map((id) => { const kk = ks.filter((k) => k.startsWith(id + '|')); return m(kk.map((k) => ret(B[k]))) - m(kk.map((k) => ret(A[k]))); });
  const mean = m(d), se = Math.sqrt(d.reduce((a, v) => a + (v - mean) ** 2, 0) / (d.length - 1) / d.length);
  console.log(`${b.padEnd(8)} ${ks.length} games: returned ${(100 * m(ks.map((k) => ret(B[k])))).toFixed(1)}% (${process.env.BASE || 'both-alone'} ${(100 * m(ks.map((k) => ret(A[k])))).toFixed(1)}%); saved the carrier ${s}, cost it ${c}; per puzzle ${(100 * mean).toFixed(1)} points (negative = better for the carrier), standard error ${(100 * se).toFixed(1)}`);
}
