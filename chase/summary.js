// chase/summary.js - compare the chase bots with the real chasers (results from chase/run.js)
//   node chase/summary.js [versions...]
const fs = require('fs'), path = require('path');
const RES = path.join(__dirname, 'results');
const versions = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync(RES).filter((f) => /^[a-z0-9]+\.jsonl$/.test(f)).map((f) => f.slice(0, -6));
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
const med = (xs) => { if (!xs.length) return '-'; const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };

for (const v of versions) {
  const rows = fs.readFileSync(path.join(RES, v + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  console.log(`\n=== ${v}: ${rows.length} puzzles ===`);
  console.log('real outcome                | puzzles | real chaser returned | bot returned | bot popped');
  const groups = {};
  for (const r of rows) (groups[r.real] = groups[r.real] || []).push(r);
  groups.all = rows;
  for (const [g, rs] of Object.entries(groups)) {
    const human = rs.filter((r) => r.real === 'returned').length, bot = rs.filter((r) => r.result === 'returned').length;
    console.log(`${g.padEnd(27)} | ${String(rs.length).padStart(7)} | ${pct(human, rs.length).padStart(20)} | ${pct(bot, rs.length).padStart(12)} | ${pct(rs.filter((r) => r.result === 'pop').length, rs.length).padStart(10)}`);
  }
  // head to head where the real chaser got the return
  const both = rows.filter((r) => r.real === 'returned');
  const botToo = both.filter((r) => r.result === 'returned');
  const diffs = botToo.map((r) => (r.ticks - r.realTicks) / 60);
  console.log(`where the real chaser returned it (${both.length}): bot also returned ${pct(botToo.length, both.length)};` +
    ` bot faster in ${pct(diffs.filter((d) => d < 0).length, botToo.length)} of those, median difference ${med(diffs) === '-' ? '-' : med(diffs).toFixed(2) + ' s'} (negative = bot faster)`);
  // windows not cut short by a teammate: the bot had the whole chance
  const fair = rows.filter((r) => r.real !== 'returned by someone else');
  console.log(`windows not ended by a teammate's return (${fair.length}): real chaser ${pct(fair.filter((r) => r.real === 'returned').length, fair.length)}, bot ${pct(fair.filter((r) => r.result === 'returned').length, fair.length)}`);
  console.log(`thinking: ${(rows.reduce((a, r) => a + r.ms, 0) / 1000 / (rows.reduce((a, r) => a + r.ticks, 0) / 60)).toFixed(2)} s per game second`);
}
