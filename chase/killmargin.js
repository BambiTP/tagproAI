// chase/killmargin.js - how big a safety margin does the fast kill check need? Re-checks every recorded case where
// either side said "kill" with the fast check demanding a closer pass (touch distance minus the margin), and counts
// wrong kills (fast says kill, the engine says the carrier escapes) and missed kills, per carrier reaction time.
//   node chase/killmargin.js [results file]
const fs = require('fs'), path = require('path');
const { fast } = require('./killtest');
const file = process.argv[2] || path.join(__dirname, 'results', 'killtest.jsonl');
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
console.log(rows.length, 'recorded cases (every case either side called a kill, plus near misses)');
for (const m of [0, 0.01, 0.02, 0.03, 0.05, 0.08]) {
  const out = {};
  for (const r of rows) {
    const f = fast(r.s, r.k, r.react, 0.385 - m).worst < Infinity, e = r.exact != null, o = (out[r.react] = out[r.react] || { wrong: 0, missed: 0, kills: 0 });
    if (e) o.kills++; if (f && !e) o.wrong++; if (e && !f) o.missed++;
  }
  console.log(`margin ${m.toFixed(2)} m: ` + Object.entries(out).map(([k, o]) => `react ${k}: wrong ${o.wrong}, missed ${o.missed} of ${o.kills} kills`).join(' | '));
}
