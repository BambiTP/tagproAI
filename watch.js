// watch.js - play the puzzles yourself, watch the bots, and see graphs. Puzzles are "touch" tasks:
// done once the ball covers the goal point, at any speed (like grabbing a flag).
// The engine runs in the browser for play; the server replays your keys in the same engine to
// confirm each time, and two worker threads compute the bots' runs ahead of you.
//   node watch.js [host=127.0.0.1, e.g. the Tailscale address] [port=8090]
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Worker, isMainThread, parentPort } = require('worker_threads');
const N = require('./nav');
const { getMap } = require('./sim');

const FIRST = 101, AHEAD = 40, WORKERS = 2, MAX_FAILS = 5;
const DIR = path.join(__dirname, 'runs', 'touch'), BOTS = path.join(DIR, 'bots'), HUMAN = path.join(DIR, 'human.json');
const OLD = path.join(__dirname, 'runs', 'stop', 'human.json'); // stop-mode runs, cut at first touch on first start
const SEARCH = { width: 16, depth: 8 }; // 0.53 s ahead: 0.4 s let a boost throw it onto a spike (puzzle 107)

// one run with keys chosen by `choose(t, sim, p)`, recorded every tick
function record(task, choose) {
  const sim = new N.Sim(getMap(task.key));
  const p = sim.addBall(1);
  sim.place(p, task.start.x, task.start.y, task.start.vx, task.start.vy);
  const frames = [];
  let a = 0, result = 'timeout';
  for (let t = 0; t < N.MAX_TICKS; t++) {
    const k = choose(t, sim, p);
    if (k === undefined) break;
    a = k;
    N.setKeys(p, a);
    sim.tickOnce();
    const q = p.body.GetPosition(), v = p.body.GetLinearVelocity();
    frames.push([+q.x.toFixed(4), +q.y.toFixed(4), a]);
    if (p.dead) { result = 'pop'; break; }
    if (N.touched(task.goal, q.x, q.y)) { result = 'arrived'; break; }
  }
  let dist = 0, top = 0;
  for (let i = 1; i < frames.length; i++) {
    const d = Math.hypot(frames[i][0] - frames[i - 1][0], frames[i][1] - frames[i - 1][1]);
    dist += d; top = Math.max(top, d * 60);
  }
  return { result, ticks: frames.length, frames, avgSpeed: dist * 60 / Math.max(1, frames.length) / N.TILE, topSpeed: top / N.TILE };
}
// a controller decides every K ticks and holds its keys in between
function every(ctl, task) {
  let a = 0;
  return (t, sim, p) => {
    if (t % N.K === 0) {
      const q = p.body.GetPosition(), v = p.body.GetLinearVelocity();
      sim.commit();
      a = ctl.name === 'search' ? ctl(task, sim, p) : ctl(task, q.x, q.y, v.x, v.y);
    }
    return a;
  };
}

function makeTask(seed, keys) { const t = N.makeTask(seed, keys); t.touch = true; return t; }
// a gravity well out-pulls the keys almost everywhere in its range (puzzle 124 starts 5 tiles from a
// well behind a wall and nothing gets out), so skip puzzles that start or end inside one's range
const WELL_RANGE = require('./sim').PH.GRAVITY_WELL_RANGE;
function playable(seed) {
  const t = task(seed), T = getMap(t.key).tiles;
  for (let x = 0; x < T.length; x++) for (let y = 0; y < T[0].length; y++) {
    if (T[x][y] !== 22) continue;
    for (const p of [t.start, t.goal]) if (Math.hypot(p.x - x * N.TILE, p.y - y * N.TILE) <= WELL_RANGE) return false;
  }
  return true;
}
const taskCache = new Map();
function task(seed) {
  if (!taskCache.has(seed)) taskCache.set(seed, makeTask(seed, N.mapKeys()));
  return taskCache.get(seed);
}
// puzzle facts for the graphs: path length (tiles) and a full-speed estimate of the best time
function facts(t) {
  const F = t.F, tx = Math.round(t.start.x / N.TILE), ty = Math.round(t.start.y / N.TILE);
  return { pathTiles: F.d[tx * F.H + ty] / N.TILE,
    estTicks: N.heuristicTouch(F, t.goal, t.start.x, t.start.y, t.start.vx, t.start.vy) };
}

if (!isMainThread) {
  const keys = N.mapKeys(), search = N.makeSearch(SEARCH);
  const FS = require('./fastsearch');
  // carry out a plan from a fastsearch search, `keep` moves at a time
  const planner = (srch, task, keep) => {
    let plan = [], a = 0;
    return (t, sim, p) => {
      if (t % N.K === 0) { if (!plan.length) { sim.commit(); plan = srch(task, sim, p).line.slice(0, keep); } a = plan.shift(); }
      return a;
    };
  };
  // the network alone: its top move, every K ticks
  const netDriver = (net, task) => {
    let a = 0;
    return (t, sim, p) => {
      if (t % N.K === 0) { net.tiles = sim.tiles; const q = p.body.GetPosition(), v = p.body.GetLinearVelocity(); a = net.move(task, q.x, q.y, v.x, v.y); }
      return a;
    };
  };
  parentPort.on('message', (m) => {
    if (m.kind === 'extra') { // one of the other bots on one puzzle
      const task = makeTask(m.seed, keys), net = m.netFile ? new (require('./net').Net)(m.netFile) : null;
      const est = net && ((t, x, y, vx, vy) => net.ticksLeft(t, x, y, vx, vy));
      const run = m.bot === 'fast' ? record(task, planner(FS.makeSearch2({ prune: true }), task, 2))
        : m.bot === 'net' ? record(task, netDriver(net, task))
        : record(task, ((inner) => (t, sim, p) => { net.tiles = sim.tiles; return inner(t, sim, p); })(planner(FS.makeSearch2({ prune: true, est }), task, 2)));
      return parentPort.postMessage({ kind: 'extra', seed: m.seed, bot: m.bot, version: m.version, run });
    }
    const seed = m;
    const task = makeTask(seed, keys);
    const t0 = Date.now(), s = record(task, every(search, task)), ms = Date.now() - t0;
    parentPort.postMessage({ seed, map: task.key, ...facts(task), searchMs: ms,
      search: s, baseline: record(task, every(N.baseline, task)) });
  });
  return;
}

const HOST = process.argv[2] || process.env.HOST || '127.0.0.1'; // run with this machine's Tailscale address
const PORT = +(process.argv[3] || process.env.PORT || 8090);
const keys = N.mapKeys();
fs.mkdirSync(BOTS, { recursive: true });

// ---------- bots, computed ahead of the player ----------
const ready = new Set(fs.readdirSync(BOTS).map((f) => parseInt(f, 10)).filter((s) => Number.isFinite(s) && playable(s)));
const busy = new Set();
const botFile = (s) => path.join(BOTS, s + '.json');
function feed(w) {
  for (let s = FIRST; s <= Math.max(human.next, ...Object.values(human.nextBy)) + AHEAD; s++) {
    if (ready.has(s) || busy.has(s) || !playable(s)) continue;
    busy.add(s); w.idle = false; w.postMessage(s); return;
  }
  // then the other bots: your upcoming puzzles first, then the rest
  const up = [...ready].filter((s) => s >= human.next).sort((a, b) => a - b);
  const past = [...ready].filter((s) => s < human.next).sort((a, b) => b - a);
  const order = [...up, ...past];
  // the network alone takes a split second per puzzle, so it goes first everywhere; the guided search is slowest
  for (const bot of ['net', 'fast', 'guided']) {
    const version = bot === 'fast' ? 1 : netVersion;
    if (!version) continue;
    for (const s of order) {
      const m = extraMeta.get(s) || {};
      if (busyExtra.has(s + bot) || m[bot] === version) continue;
      busyExtra.add(s + bot); w.idle = false;
      w.postMessage({ kind: 'extra', seed: s, bot, version, netFile: bot === 'fast' ? null : NETFILE });
      return;
    }
  }
  w.idle = true;
}
// ---------- the other bots: fast planning bot, network alone, network-guided search ----------
// a network is only used once released to runs/train/net-release.json (train.js rewrites net.json every pass)
const EXTRA = path.join(DIR, 'extra'), NETFILE = path.join(__dirname, 'runs', 'train', 'net-release.json');
fs.mkdirSync(EXTRA, { recursive: true });
const extraFile = (s) => path.join(EXTRA, s + '.json');
const extraMeta = new Map(), busyExtra = new Set();
for (const f of fs.readdirSync(EXTRA)) {
  const r = JSON.parse(fs.readFileSync(path.join(EXTRA, f), 'utf8'));
  extraMeta.set(r.seed, { ...(r.ver || {}), fast: r.fast ? 1 : undefined });
}
let netVersion = null;
function checkNet() { netVersion = fs.existsSync(NETFILE) ? fs.statSync(NETFILE).mtimeMs : null; }
checkNet();
setInterval(() => { checkNet(); wake(); }, 30000);
function extraOf(s) { return fs.existsSync(extraFile(s)) ? JSON.parse(fs.readFileSync(extraFile(s), 'utf8')) : {}; }
const workers = [];
function startWorkers() {
  for (let i = 0; i < WORKERS; i++) {
    const w = new Worker(__filename);
    w.on('message', (r) => {
      if (r.kind === 'extra') {
        // one file per puzzle holds every other bot's run; ver says which network each came from
        const x = extraOf(r.seed);
        x.seed = r.seed; x[r.bot] = r.run; x.ver = { ...(x.ver || {}), [r.bot]: r.version };
        fs.writeFileSync(extraFile(r.seed), JSON.stringify(x));
        extraMeta.set(r.seed, { ...(extraMeta.get(r.seed) || {}), [r.bot]: r.version }); busyExtra.delete(r.seed + r.bot);
        console.log(`${r.bot} bot on ${r.seed}: ${r.run.result} ${(r.run.ticks / 60).toFixed(2)} s`);
        return feed(w);
      }
      fs.writeFileSync(botFile(r.seed), JSON.stringify(r));
      busy.delete(r.seed); ready.add(r.seed);
      console.log(`bots ${r.seed} (map ${r.map}): search ${r.search.result} ${(r.search.ticks / 60).toFixed(2)} s, baseline ${r.baseline.result} ${(r.baseline.ticks / 60).toFixed(2)} s`);
      feed(w);
    });
    w.on('error', (e) => console.error('worker', e));
    workers.push(w); feed(w);
  }
}
const wake = () => workers.forEach((w) => w.idle && feed(w));

// ---------- modes on the private page (easy to expert, the same rules as the puzzle site) ----------
// "all" is the original run through every puzzle in order; each mode keeps its own place
let arena = null;
const MODES = ['easy', 'medium', 'hard', 'expert'];
const modeOf = (s) => (arena ? arena.puzzleMode(s) : null);
const inMode = (s, m) => ready.has(s) && playable(s) && (m === 'all' || modeOf(s) === m);
// in a mode, puzzles you've already finished are skipped (they're under All, Back and the slow list)
const fresh = (s, m) => inMode(s, m) && !human.best[s];
function modeNext(m) {
  if (m === 'all') return human.next;
  let best = null;
  for (const s of ready) if (s >= human.nextBy[m] && fresh(s, m) && (best === null || s < best)) best = s;
  return best;
}
function advance(m, seed) {
  if (m === 'all') { human.next++; skipUnplayable(); } else human.nextBy[m] = seed + 1;
  human.fails = 0;
}
const modesLeft = () => ({ all: [...ready].filter((s) => s >= human.next && playable(s)).length,
  ...Object.fromEntries(MODES.map((m) => [m, [...ready].filter((s) => s >= human.nextBy[m] && fresh(s, m)).length])) });

// ---------- the player's runs ----------
// next: the puzzle you're on; fails: failed tries on it; best[seed]: your fastest arrival;
// attempts: every finished try
const human = fs.existsSync(HUMAN) ? JSON.parse(fs.readFileSync(HUMAN, 'utf8')) : importOld();
function skipUnplayable() { while (!playable(human.next)) { human.next++; human.fails = 0; } }
human.mode = human.mode || 'all';
human.nextBy = human.nextBy || Object.fromEntries(['easy', 'medium', 'hard', 'expert'].map((m) => [m, FIRST]));
skipUnplayable();
function importOld() {
  const h = { next: FIRST, fails: 0, best: {}, attempts: [] };
  if (!fs.existsSync(OLD)) return h;
  for (const [s, b] of Object.entries(JSON.parse(fs.readFileSync(OLD, 'utf8')).best)) {
    const g = task(+s).goal, i = b.frames.findIndex((f) => N.touched(g, f[0], f[1]));
    if (i >= 0) h.best[s] = { ticks: i + 1, frames: b.frames.slice(0, i + 1), fromStopMode: true };
  }
  console.log(`carried over ${Object.keys(h.best).length} stop-mode runs, cut at first touch`);
  return h;
}
function saveHuman() { fs.writeFileSync(HUMAN + '.tmp', JSON.stringify(human)); fs.renameSync(HUMAN + '.tmp', HUMAN); }



// a try on the current puzzle, or a retry of an earlier one (which only ever improves your best time)
function submit(body) {
  const cur = modeNext(human.mode), seed = body.seed, ks = body.keys, retry = seed !== cur;
  if (retry && !(ready.has(seed) && playable(seed))) throw new Error('not a puzzle you can play');
  if (!Array.isArray(ks) || ks.length > N.MAX_TICKS || !ks.every((k) => Number.isInteger(k) && k >= 0 && k <= 8)) throw new Error('bad keys');
  const t = task(seed);
  const run = record(t, (i) => (i < ks.length ? ks[i] : undefined));
  if (run.result === 'timeout' && ks.length < N.MAX_TICKS) run.result = 'quit';
  const old = human.best[seed];
  const isBest = run.result === 'arrived' && (!old || run.ticks < old.ticks);
  if (isBest) human.best[seed] = { ticks: run.ticks, frames: run.frames };
  human.attempts.push({ seed, result: run.result, ticks: run.ticks, at: Date.now(), browser: body.result, retry });
  if (!retry && (run.result === 'arrived' || ++human.fails >= MAX_FAILS)) advance(human.mode, seed);
  saveHuman(); wake();
  return { result: run.result, ticks: run.ticks, best: isBest, next: modeNext(human.mode), bots: bots(seed) };
}

function bots(seed) {
  if (!ready.has(seed)) return null;
  const r = JSON.parse(fs.readFileSync(botFile(seed), 'utf8'));
  const sum = (x) => ({ result: x.result, ticks: x.ticks, avgSpeed: x.avgSpeed, topSpeed: x.topSpeed });
  return { map: r.map, pathTiles: r.pathTiles, estTicks: r.estTicks, searchMs: r.searchMs,
    search: sum(r.search), baseline: sum(r.baseline) };
}

function stats() {
  const rows = [];
  const seeds = new Set([...ready, ...Object.keys(human.best).map(Number), ...human.attempts.map((a) => a.seed)]);
  for (const s of [...seeds].filter(playable).sort((a, b) => a - b)) {
    const b = bots(s), tries = human.attempts.filter((a) => a.seed === s);
    rows.push({ seed: s, ...(b || {}),
      you: human.best[s] ? human.best[s].ticks : null, tries: tries.length, pops: tries.filter((a) => a.result === 'pop').length });
  }
  return { next: human.next, rows, attempts: human.attempts.length };
}

// ---------- learning: recording progress, training scores, test results, notes ----------
const TRAIN = path.join(__dirname, 'runs', 'train');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : []);
function recorded() {
  let puzzles = 0, decisions = 0, failed = 0;
  if (!fs.existsSync(TRAIN)) return { puzzles, decisions, failed };
  for (const f of fs.readdirSync(TRAIN).filter((f) => /^[db]\d+\.log$/.test(f)))
    for (const r of jsonl(path.join(TRAIN, f))) if (r.rows) { puzzles++; decisions += r.rows; } else if (r.result) failed++;
  return { puzzles, decisions, failed };
}
setInterval(() => {
  if (fs.existsSync(TRAIN)) fs.appendFileSync(path.join(TRAIN, 'progress.jsonl'), JSON.stringify({ at: Date.now(), ...recorded() }) + '\n');
}, 60000);
function learning() {
  const evals = {}, dir = path.join(TRAIN, 'eval');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    const rows = jsonl(path.join(dir, f));
    evals[f.replace('.jsonl', '')] = { rows: rows.filter((r) => r.seed), summary: rows.find((r) => r.summary) || null };
  }
  // the test puzzles' route lengths and simple-bot times, for the speed-to-target graph
  const test = {};
  for (let s = 101; s <= 140; s++) if (ready.has(s)) {
    const r = JSON.parse(fs.readFileSync(botFile(s), 'utf8'));
    test[s] = { pathTiles: r.pathTiles, simple: r.baseline.result === 'arrived' ? r.baseline.ticks : null };
  }
  const nf = path.join(TRAIN, 'notes.json');
  return { now: Date.now(), recorded: recorded(), progress: jsonl(path.join(TRAIN, 'progress.jsonl')),
    training: jsonl(path.join(TRAIN, 'train-log.jsonl')), evals,
    notes: fs.existsSync(nf) ? JSON.parse(fs.readFileSync(nf, 'utf8')) : [],
    you: Object.fromEntries(Object.entries(human.best).map(([s, b]) => [s, b.ticks])), test };
}

// ---------- http ----------
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const ENGINE = { 'box2d.js': 1, 'constants.js': 1, 'game.js': 1 };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), seed = parseInt(u.searchParams.get('seed'), 10);
  try {
    if (u.pathname === '/') return send(res, 200, fs.readFileSync(path.join(__dirname, 'watch.html')), 'text/html');
    if (u.pathname.startsWith('/engine/') && ENGINE[u.pathname.slice(8)])
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'engine', u.pathname.slice(8))), 'text/javascript');
    if (u.pathname === '/current') {
      // the puzzle you're on in this mode, or with ?seed= another one to retry
      const mode = human.mode, cur = modeNext(mode);
      const s = seed && ready.has(seed) && playable(seed) ? seed : cur;
      if (s === null) return send(res, 200, { seed: null, mode, left: modesLeft(),
        message: `You've done every ${mode} puzzle that's ready. Pick another mode, or wait for the bots to work through more.` });
      const t = task(s), m = getMap(t.key), same = (x) => inMode(x, mode);
      return send(res, 200, { seed: s, next: cur, retry: s !== cur, fails: s === cur ? human.fails : 0, maxFails: MAX_FAILS,
        mode, puzzleMode: modeOf(s), left: modesLeft(),
        map: m, tile: N.TILE, touchR: N.BALL_R, goal: t.goal, start: t.start, maxTicks: N.MAX_TICKS, bots: bots(s), ghosts: ghostsOf(s),
        yourBest: human.best[s] ? human.best[s].ticks : null,
        prev: [...ready].filter((x) => x < s && same(x)).sort((a, b) => b - a)[0] || null,
        after: s === cur ? null : [...ready].filter((x) => x > s && (cur === null || x < cur) && same(x)).sort((a, b) => a - b)[0] || cur });
    }
    if (u.pathname === '/mode' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e3) req.destroy(); });
      req.on('end', () => { try { const m = JSON.parse(body).mode;
        if (m !== 'all' && !MODES.includes(m)) throw new Error('unknown mode');
        human.mode = m; human.fails = 0; saveHuman(); wake(); send(res, 200, { mode: m }); } catch (e) { send(res, 400, { error: e.message }); } });
      return;
    }
    if (u.pathname === '/restart' && req.method === 'POST') {
      // an R press on the private page: logged so the try count is honest (it can't change anything else)
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e3) req.destroy(); });
      req.on('end', () => { try { const r = JSON.parse(body);
        if (Number.isInteger(r.seed) && Number.isInteger(r.ticks)) { human.attempts.push({ seed: r.seed, result: 'restart', ticks: r.ticks, at: Date.now() }); saveHuman(); }
        send(res, 200, { ok: true }); } catch (e) { send(res, 400, { error: 'bad' }); } });
      return;
    }
    if (u.pathname === '/skip' && req.method === 'POST') {
      const cur = modeNext(human.mode); if (cur !== null) advance(human.mode, cur); saveHuman(); wake();
      return send(res, 200, { next: modeNext(human.mode) });
    }
    if (u.pathname === '/slow') {
      // puzzles where your best is 25% or more slower than the planning bot, worst first
      const out = [];
      for (const [s, b] of Object.entries(human.best)) {
        const r = ready.has(+s) && bots(+s);
        if (r && r.search.result === 'arrived' && b.ticks >= r.search.ticks * 1.25) out.push({ seed: +s, you: b.ticks, bot: r.search.ticks, ratio: b.ticks / r.search.ticks });
      }
      return send(res, 200, out.sort((a, b) => b.ratio - a.ratio));
    }
    if (u.pathname === '/watch') {
      // the ready puzzle after `seed`, wrapping round
      const wm = u.searchParams.get('mode') || 'all';
      const list = [...ready].filter((s) => wm === 'all' || (playable(s) && modeOf(s) === wm)).sort((a, b) => a - b);
      if (!list.length) return send(res, 202, { waiting: true });
      const s = list.find((x) => x > (seed || 0)) || list[0];
      const r = JSON.parse(fs.readFileSync(botFile(s), 'utf8')), t = task(s);
      const x = extraOf(s);
      return send(res, 200, { ...r, seed: s, tiles: getMap(t.key).tiles, tile: N.TILE, goal: t.goal, start: t.start,
        you: human.best[s] || null, fast: x.fast || null, net: x.net || null, guided: x.guided || null, puzzleMode: modeOf(s) });
    }
    if (u.pathname === '/stats') return send(res, 200, stats());
    if (u.pathname === '/learning') return send(res, 200, learning());
    if (u.pathname === '/submit' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
      req.on('end', () => { try { send(res, 200, submit(JSON.parse(body))); } catch (e) { send(res, 400, { error: e.message }); } });
      return;
    }
    send(res, 404, 'not found', 'text/plain');
  } catch (e) { console.error(e); send(res, 500, { error: e.message }); }
}).listen(PORT, HOST, () => {
  console.log(`http://${HOST}:${PORT}/`); startWorkers();
  // the public puzzle server for the GitHub Pages site, on its own port (see arena.js and tunnel.js)
  const botCache = new Map();
  arena = require('./arena')({ N, record, task, getMap, ready, playable, FIRST, extraOf,
    ownerBest: (s) => (human.best[s] ? human.best[s].ticks : null),
    botRuns: (s) => {
      if (!ready.has(s)) return null;
      if (!botCache.has(s)) botCache.set(s, JSON.parse(fs.readFileSync(botFile(s), 'utf8')));
      return botCache.get(s);
    },
    host: '127.0.0.1', port: +(process.env.ARENA_PORT || 8092) });
});

// ghost balls to race while you play: both bots and your own best on this puzzle
function ghostsOf(s) {
  const r = ready.has(s) ? JSON.parse(fs.readFileSync(botFile(s), 'utf8')) : null;
  const x = extraOf(s);
  return { search: r?.search.frames || null, baseline: r?.baseline.frames || null, you: human.best[s]?.frames || null,
    fast: x.fast?.frames || null, net: x.net?.frames || null, guided: x.guided?.frames || null };
}
