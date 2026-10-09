// chase/killgridsummary.js - readable tables from the kill grid (chase/results/killgrid-*.csv): the furthest distance at
// which a chaser holding one key is certain to touch the carrier, by chaser and carrier speed, for a few directions;
// and how often the fast check claims a kill further out than the engine allows (unsafe).
//   node chase/killgridsummary.js [react ticks, default 6]
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, 'results'), react = +(process.argv[2] || 6);
const rows = [];
for (const f of fs.readdirSync(R).filter((f) => /^killgrid(-\d+)?\.csv$/.test(f)))
  for (const l of fs.readFileSync(path.join(R, f), 'utf8').trim().split('\n').slice(1)) { const [cs, ca, fs_, fa, re, e, fa2] = l.split(',').map(Number); rows.push({ cs, ca, fs: fs_, fa, react: re, e, f: fa2 }); }
console.log(rows.length, 'combinations');
let unsafe = 0, worst = 0; for (const r of rows) if (r.f > r.e + 0.021) { unsafe++; worst = Math.max(worst, r.f - r.e); }
console.log(`fast check claims a kill further out than the engine allows: ${unsafe} combinations (worst by ${worst.toFixed(2)} m)`);
const get = (cs, ca, fs_, fa) => rows.find((r) => r.cs === cs && r.ca === ca && r.fs === fs_ && r.fa === fa && r.react === react);
const speeds = [0, 0.5, 1, 1.5, 2, 2.5, 3];
for (const [ca, fa, label] of [[0, 0, 'chaser heading straight at the carrier, carrier running straight away'],
  [0, 180, 'chaser heading straight at the carrier, carrier coming straight at the chaser'],
  [0, 90, 'chaser heading straight at the carrier, carrier running across (sideways)'],
  [0, 45, 'chaser heading straight at the carrier, carrier running away at 45 degrees']]) {
  console.log(`\n${label}; carrier reacts after ${react} ticks. Furthest certain kill (metres; 0.38 = touching; - = none):`);
  console.log('chaser speed \\ carrier speed  ' + speeds.map((v) => String(v).padStart(5)).join(''));
  for (const cs of speeds) console.log(String(cs).padStart(29) + '  ' + speeds.map((fs_) => { const r = get(cs, cs ? ca : 0, fs_, fs_ ? fa : 0); return (r ? (r.e ? r.e.toFixed(2) : '-') : '?').padStart(5); }).join(''));
}
