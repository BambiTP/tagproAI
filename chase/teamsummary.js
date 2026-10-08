// chase/teamsummary.js - results of chase/team.js: how each chasing plan does against each carrying plan
//   node chase/teamsummary.js   (every chase/results/team-<chasing>-<carrying>.jsonl)
const fs = require('fs'), path = require('path');
const RES = path.join(__dirname, 'results');
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '-');
const files = fs.readdirSync(RES).filter((f) => /^team-[a-z]+-[a-z]+\.jsonl$/.test(f)).sort();
console.log('chasing    carrying | games | returned | capped | held | returned when it started 2-5 / 5-8 / 8-10 tiles away | real chaser returned (same puzzles)');
for (const f of files) {
  const [, c, r] = f.slice(0, -6).split('-');
  const rows = fs.readFileSync(path.join(RES, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const n = (k) => rows.filter((x) => x.result === k).length;
  const band = (a, b) => { const rs = rows.filter((x) => x.startDist >= a && x.startDist < b); return pct(rs.filter((x) => x.result === 'returned').length, rs.length) + ` of ${rs.length}`; };
  console.log(`${c.padEnd(10)} ${r.padEnd(8)} | ${String(rows.length).padStart(5)} | ${pct(n('returned'), rows.length).padStart(8)} | ${pct(n('capped'), rows.length).padStart(6)} | ${pct(n('held'), rows.length).padStart(4)} | ${band(2, 5)} / ${band(5, 8)} / ${band(8, 11)} | ${pct(rows.filter((x) => x.real === 'returned').length, rows.length)}`);
}
