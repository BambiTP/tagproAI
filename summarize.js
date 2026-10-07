const r = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const ok = r.out.filter((e) => e.result === 'ok');
const c = (k) => r.out.filter((e) => e.result === k).length;
console.log(`${r.which} w${r.width} d${r.depth}: ok ${ok.length}/${r.out.length}, pops ${c('pop')}, timeouts ${c('timeout')}, mean time on success ${(ok.reduce((s, e) => s + e.ticks, 0) / Math.max(1, ok.length) / 60).toFixed(2)} s, mean ticks/est ${(ok.reduce((s, e) => s + e.ticks / e.est, 0) / Math.max(1, ok.length)).toFixed(2)}, wall ${r.secs}s`);
