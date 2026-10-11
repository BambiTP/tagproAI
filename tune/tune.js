// tune/tune.js - searches for better contain-chaser values (tune/contain.js) on kill-point starts (tune/game.js).
// Every setting plays the same STARTS starts against every escaper. Score = half the worst escaper's stop rate plus
// half the average stop rate (stopped = a guaranteed kill or held for 8 s; escapes, missed swipes and bumps are not). Trial 0 is the page's current values, trial 1 the
// same with the cutter kept on the carrier's way home; then RANDOM random settings, then mutations of the best few.
// At the end the top 5 (and trial 0) are rechecked on TEST new starts, so a lucky score on the first set shows up.
// Progress goes to tune/state/ for the private page's "Tune contain" tab. Resumes from trials.jsonl if stopped.
//   node tune/tune.js [trials=300]      env: WORKERS=3 STARTS=150 RANDOM=30 TEST=300 SEEDFROM=<an old best.json> KINDS=kp,wall
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path');

if (!isMainThread) {
  const { play, GROUPS } = require('./game');
  parentPort.on('message', (job) => {
    const per = {}, games = []; let lastLive = 0;
    const groups = GROUPS.filter((g) => job.kinds.includes(g.kind));
    for (const g of groups) per[g.id] = { escape: 0, return: 0, hold: 0, bump: 0 };
    for (const seed of job.seeds) for (const g of groups) {
      const r = play(seed, g.escaper, job.params, job.record, g.kind), e = g.id;
      per[e][r.result]++;
      if (job.record) games.push({ seed, escaper: e, ...r });
      const now = Date.now();
      if (now - lastLive > 2500) { lastLive = now; const L = job.record ? r : play(seed, g.escaper, job.params, true, g.kind); parentPort.postMessage({ live: { trial: job.id, seed, escaper: e, ...L } }); }
      parentPort.postMessage({ progress: { id: job.id, done: games.length || Object.values(per).reduce((s, p) => s + p.escape + p.return + p.hold + p.bump, 0) } });
    }
    parentPort.postMessage({ result: { id: job.id, per, games } });
  });
  return;
}

const C = require('./contain'), { GROUPS } = require('./game');
const KINDS = (process.env.KINDS || 'kp,wall').split(','), ESCAPERS = GROUPS.filter((g) => KINDS.includes(g.kind)).map((g) => g.id);
const DIR = path.join(__dirname, 'state'); fs.mkdirSync(DIR, { recursive: true });
const MAX = +(process.argv[2] || 300), WORKERS = +(process.env.WORKERS || 3), NS = +(process.env.STARTS || 150), RANDOM = +(process.env.RANDOM || 30), TEST = +(process.env.TEST || 300);
const SEED = process.env.SEEDFROM ? JSON.parse(fs.readFileSync(process.env.SEEDFROM, 'utf8')) : null;
const SEEDS = Array.from({ length: NS }, (_, i) => i + 1), TSEEDS = Array.from({ length: TEST }, (_, i) => 100001 + i);
const write = (f, o) => { fs.writeFileSync(path.join(DIR, f + '.tmp'), JSON.stringify(o)); fs.renameSync(path.join(DIR, f + '.tmp'), path.join(DIR, f)); };

const scoreOf = (per) => { const rates = Object.values(per).map((p) => (p.return + p.hold) / (p.escape + p.return + p.hold + (p.bump || 0)));
  return 0.5 * Math.min(...rates) + 0.5 * rates.reduce((a, b) => a + b, 0) / rates.length; };
const rnd = Math.random;
const fix = (p) => { for (const [k, r] of Object.entries(C.RANGES)) { if (r === 'flag') p[k] = p[k] ? 1 : 0; else { p[k] = Math.min(r[1], Math.max(r[0], p[k])); p[k] = C.INTS[k] ? Math.round(p[k]) : Math.round(p[k] * 100) / 100; } }
  if (p.r2 < p.r1) [p.r1, p.r2] = [p.r2, p.r1]; return p; };
const random = () => { const p = { ...C.DEFAULTS }; for (const [k, r] of Object.entries(C.RANGES)) p[k] = r === 'flag' ? (rnd() < 0.5 ? 1 : 0) : r[0] + rnd() * (r[1] - r[0]); return fix(p); };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const mutate = (p0) => { const p = { ...p0 }; let changed = 0;
  while (!changed) for (const [k, r] of Object.entries(C.RANGES)) { if (rnd() > 0.35) continue; changed++;
    if (r === 'flag') p[k] = 1 - p[k]; else p[k] += gauss() * 0.15 * (r[1] - r[0]); }
  return fix(p); };

// resume
const trials = fs.existsSync(path.join(DIR, 'trials.jsonl')) ? fs.readFileSync(path.join(DIR, 'trials.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
let best = trials.reduce((b, t) => (!b || t.score > b.score ? t : b), null), nextId = trials.length;
const running = new Map(), started = new Date().toISOString();
function nextParams() {
  const id = nextId++;
  if (id === 0) return { id, params: fix({ ...C.DEFAULTS }), parent: null, how: 'current page values' };
  if (id === 1) return { id, params: fix({ ...C.DEFAULTS, sideMin: 0, route: 1 }), parent: 0, how: 'current + cutter kept on the way home' };
  if (SEED && id === 2) return { id, params: fix({ ...C.DEFAULTS, ...SEED.params, wallSolo: 1 }), parent: null, how: 'best of the last run' };
  if (SEED && id === 3) return { id, params: fix({ ...C.DEFAULTS, ...SEED.params, wallSolo: 1 }), parent: 2, how: 'best of the last run, kills use walls' };
  if (SEED && id === 4) return { id, params: fix({ ...C.DEFAULTS, ...SEED.params, wallSolo: 1, split: 1 }), parent: 2, how: 'best of the last run, split mode' };
  if (id === 5) return { id, params: fix({ ...C.DEFAULTS, sideMin: 0, route: 1, split: 1 }), parent: 1, how: 'split mode, starting values' };
  if (id === 6) return { id, params: fix({ ...C.DEFAULTS, sideMin: 0, route: 1, wallSolo: 1 }), parent: 1, how: 'current + way home + kills use walls' };
  if (id < 7 + RANDOM) return { id, params: random(), parent: null, how: 'random' };
  const top = trials.slice().sort((a, b) => b.score - a.score).slice(0, 5), par = top[Math.floor(rnd() * rnd() * top.length)];
  return { id, params: mutate(par.params), parent: par.id, how: 'changed from #' + par.id };
}
function status(phase) {
  write('status.json', { phase, started, max: MAX, starts: NS, escapers: ESCAPERS, games: NS * ESCAPERS.length, done: trials.length,
    best: best && { id: best.id, score: best.score }, running: [...running.values()].map((r) => ({ id: r.id, how: r.how, params: r.params, done: r.done })), ranges: C.RANGES, defaults: C.DEFAULTS });
}

const workers = Array.from({ length: WORKERS }, () => new Worker(__filename));
let finishing = false;
function give(w) {
  if (nextId >= MAX) { if (!running.size && !finishing) { finishing = true; testTop(); } return; }
  const job = nextParams(); job.done = 0; running.set(job.id, job); status('searching');
  w.postMessage({ id: job.id, params: job.params, seeds: SEEDS, record: true, kinds: KINDS });
}
workers.forEach((w) => {
  w.on('message', (m) => {
    if (m.live) write('live.json', m.live);
    else if (m.progress) { const j = running.get(m.progress.id); if (j) j.done = m.progress.done; }
    else if (m.result && m.result.id >= 1e6) testDone(m.result);
    else if (m.result && running.has(m.result.id)) {
      const j = running.get(m.result.id); running.delete(j.id);
      const t = { id: j.id, how: j.how, parent: j.parent, params: j.params, per: m.result.per, score: Math.round(scoreOf(m.result.per) * 10000) / 10000, at: new Date().toISOString() };
      trials.push(t); fs.appendFileSync(path.join(DIR, 'trials.jsonl'), JSON.stringify(t) + '\n');
      if (!best || t.score > best.score) { best = t; write('best.json', t); write('best-games.json', m.result.games); }
      if (j.id === 0) write('base-games.json', m.result.games);
      console.log('#' + t.id, t.score, JSON.stringify(t.per), t.how, best.id === t.id ? 'BEST' : '');
      status('searching'); give(w);
    }
  });
  give(w);
});
setInterval(() => status(finishing ? 'final check on new starts' : 'searching'), 2000).unref();

// final check: the top 5 and the current values on TEST new starts
const tests = new Map();
function testTop() {
  const pick = trials.slice().sort((a, b) => b.score - a.score).slice(0, 5); if (!pick.find((t) => t.id === 0) && trials[0]) pick.push(trials[0]);
  status('final check on new starts');
  const chunks = WORKERS, size = Math.ceil(TEST / chunks); let wi = 0;
  for (const t of pick) for (let c = 0; c < chunks; c++) {
    const jid = 1e6 + t.id * 10 + c; tests.set(jid, t.id); running.set(jid, { id: jid, how: 'final check of #' + t.id, params: t.params, done: 0 });
    workers[wi++ % WORKERS].postMessage({ id: jid, params: t.params, seeds: TSEEDS.slice(c * size, (c + 1) * size), record: false, kinds: KINDS });
  }
}
const testPer = {};
function testDone(r) {
  const tid = tests.get(r.id); running.delete(r.id);
  const acc = testPer[tid] || (testPer[tid] = {}); for (const [e, p] of Object.entries(r.per)) { const a = acc[e] || (acc[e] = { escape: 0, return: 0, hold: 0, bump: 0 }); for (const k in p) a[k] += p[k]; }
  if ([...running.keys()].some((k) => k >= 1e6)) return;
  const out = Object.entries(testPer).map(([id, per]) => ({ id: +id, per, score: Math.round(scoreOf(per) * 10000) / 10000, trainScore: trials.find((t) => t.id === +id).score, params: trials.find((t) => t.id === +id).params }))
    .sort((a, b) => b.score - a.score);
  write('final.json', { at: new Date().toISOString(), starts: TEST, results: out });
  console.log('final', JSON.stringify(out.map((o) => [o.id, o.trainScore, o.score])));
  status('done'); workers.forEach((w) => w.terminate());
}
