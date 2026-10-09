// chase/blocksummary.js - does a real block help the carrier? Compares threat moments with contact (a block) and
// without, within groups of similar moments (enemy's distance to the carrier, how fast it was closing), and shows
// where blockers were at the moment of contact.   node chase/blocksummary.js
const fs = require('fs'), path = require('path');
const rows = fs.readFileSync(path.join(__dirname, 'results', 'blocks.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const pct = (x) => (100 * x).toFixed(1) + '%';
const groupOf = (r) => Math.min(2, Math.floor(r.dEC / 2)) + '-' + (r.closeBefore < 1.5 ? 0 : r.closeBefore < 3 ? 1 : 2);
const groups = {};
for (const r of rows) (groups[groupOf(r)] = groups[groupOf(r)] || { yes: [], no: [] })[r.contact ? 'yes' : 'no'].push(r);
// weighted by the number of blocks in each group: what blocks did, against similar moments without one
const outcomes = { enemyReturned3: 'that enemy returned the carrier within 3 s', returned10: 'carrier returned within 10 s', capped10: 'carrier capped within 10 s' };
console.log(`${rows.length} threat moments, ${rows.filter((r) => r.contact).length} with a block (contact)\n`);
for (const [k, label] of Object.entries(outcomes)) {
  let wy = 0, wn = 0, W = 0;
  for (const g of Object.values(groups)) { if (!g.yes.length || !g.no.length) continue;
    const w = g.yes.length; W += w; wy += w * g.yes.filter((r) => r[k]).length / g.yes.length; wn += w * g.no.filter((r) => r[k]).length / g.no.length; }
  console.log(`${label.padEnd(45)} block ${pct(wy / W)}   similar moments without ${pct(wn / W)}`);
}
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
let cy = 0, cn = 0, W = 0;
for (const g of Object.values(groups)) { const y = g.yes.filter((r) => r.closeAfter != null), n = g.no.filter((r) => r.closeAfter != null); if (!y.length || !n.length) continue;
  W += y.length; cy += y.length * avg(y.map((r) => r.closeAfter)); cn += y.length * avg(n.map((r) => r.closeAfter)); }
console.log(`${'enemy closing speed over the next second'.padEnd(45)} block ${(cy / W).toFixed(2)} m/s   without ${(cn / W).toFixed(2)} m/s`);
// geometry of blocks: angle at the carrier between the enemy and the blocker, and the blocker's distance
console.log('\nwhere the blocker was at contact (angle at the carrier between enemy and blocker; 0 = right on the line):');
const blocks = rows.filter((r) => r.contact);
for (const [a, b] of [[0, 20], [20, 45], [45, 90], [90, 181]]) {
  const rs = blocks.filter((r) => r.angle >= a && r.angle < b);
  console.log(`  ${String(a).padStart(3)}-${String(b === 181 ? 180 : b).padEnd(3)} degrees: ${pct(rs.length / blocks.length).padStart(6)} of blocks; that enemy returned it within 3 s ${pct(avg(rs.map((r) => +r.enemyReturned3)))}; enemy closing after ${avg(rs.filter((r) => r.closeAfter != null).map((r) => r.closeAfter)).toFixed(2)} m/s; blocker ${avg(rs.map((r) => r.dBC)).toFixed(1)} tiles from the carrier`);
}
