// arena.js - the public puzzle server behind the GitHub Pages site (docs/): accounts, puzzles with bot
// ghosts, runs checked by replaying their keys, R-press tracking, skill ratings, per-puzzle records,
// automatic R-spam flags and admin tools. watch.js starts it on its own port (127.0.0.1:8092) and only
// that port goes through the Cloudflare tunnel, so the personal Tailscale page stays private.
//
// The game is about the best time: players retry a puzzle as often as they like, then move on.
//  - Every try is started on the server (/api/start) first, so a try that never reports back still counts.
//  - Modes sort puzzles by how hard the best time is to reach: at first by how much the planning bot beats
//    plain steering (the simple bot), later by how close players get to the record.
//  - Rating works like chess with each puzzle as an opponent: a puzzle's result comes from your best time
//    against the planning bot's, shrunk a little per try, so grinding pays only if it really improves.
//  - Medals: gold beats the planning bot, silver is within 10%, bronze finishes. The WR (world record) is the
//    fastest player time, with a ghost to race; records also count the bots.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), http = require('http');

const DEFAULT_DIR = path.join(__dirname, 'runs', 'arena');
const ADMINS = (process.env.ARENA_ADMINS || 'bambi').toLowerCase().split(','); // accounts with these names are admins
const ORIGINS = ['https://bambitp.github.io'];
const RESERVED = /^(__proto__|constructor|prototype|hasownproperty|tostring|valueof)$/i; // never valid usernames
const ENDS = ['arrived', 'pop', 'timeout', 'restart'];
const IP_LIMIT = +(process.env.ARENA_IP_LIMIT || 60); // requests per 10 seconds from one address
const REG_LIMIT = +(process.env.ARENA_REG_LIMIT || 3); // new accounts per hour from one address
const START_RATING = 1000, K_PLAYER = 32, K_PUZZLE = 16;
const TRY_FACTOR = 0.98;             // each try after the first takes 2% off a puzzle's result
const TOKEN_DAYS = 30;
const MODES = ['easy', 'medium', 'hard', 'expert'];
const LISTS = [...MODES, 'starred'];   // 'starred': the player's saved puzzles, in any mode
const BOTS = { search: 'planning bot', baseline: 'simple bot', fast: 'fast planning bot', net: 'network', guided: 'network-guided' };

const readJSON = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const writeJSON = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); };
const now = () => Date.now();
const isTry = (e) => e !== 'next';
const isRestart = (e) => e === 'restart' || e === 'abandoned';

// how hard the best time is to reach, from the bots: how much careful planning beats plain steering
function botMode(b) {
  if (!b || b.search.result !== 'arrived' || b.baseline.result !== 'arrived') return 'expert';
  const gap = b.baseline.ticks / b.search.ticks;
  return gap < 1.03 ? 'easy' : gap < 1.15 ? 'medium' : gap < 1.4 ? 'hard' : 'expert';
}
// ... and from players once 3 have finished it: how far their best times typically are from the record
// ... and when a person beats every bot by a clear margin the best time takes a trick the bots miss
// (puzzle 300: all five bots 2.98 s, a boost route 2.72 s), so it's at least hard, or expert
function trickMode(botBest, humanBest) {
  if (!botBest || !humanBest) return 'easy';
  const gap = botBest / humanBest;
  return gap >= 1.08 ? 'expert' : gap >= 1.04 ? 'hard' : 'easy';
}
const harder = (a, b) => (MODES.indexOf(a) >= MODES.indexOf(b) ? a : b);
function playerMode(ratios) {
  const s = [...ratios].sort((a, b) => a - b), m = s[s.length >> 1];
  return m < 1.05 ? 'easy' : m < 1.15 ? 'medium' : m < 1.3 ? 'hard' : 'expert';
}
function medalOf(ticks, b) {
  if (ticks == null) return null;
  if (!b || b.search.result !== 'arrived' || ticks <= b.search.ticks) return 'gold';
  return ticks <= b.search.ticks * 1.1 ? 'silver' : 'bronze';
}

module.exports = function startArena(ctx) {
  // ctx: { N, record, task, getMap, ready, playable, botRuns(seed), extraOf(seed), FIRST, host, port, origins }
  const { N } = ctx, DIR = ctx.dir || DEFAULT_DIR; // ctx.dir: a separate data folder (tests)
  const USERS = path.join(DIR, 'users.json'), TOKENS = path.join(DIR, 'tokens.json'), TRIES = path.join(DIR, 'tries.jsonl');
  const BEST = path.join(DIR, 'best');
  fs.mkdirSync(BEST, { recursive: true });
  // stores without a prototype, so no key (e.g. "__proto__") can reach Object.prototype
  const users = Object.assign(Object.create(null), readJSON(USERS, {})), tokens = Object.assign(Object.create(null), readJSON(TOKENS, {}));
  const getUser = (key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(users, key) ? users[key] : null);
  for (const k of ADMINS) if (getUser(k)) users[k].admin = true;
  for (const k of Object.keys(users)) if (!ADMINS.includes(k)) users[k].admin = false;
  for (const [t, v] of Object.entries(tokens)) if (v.exp < now()) delete tokens[t];
  const origins = ctx.origins || ORIGINS;
  const devOrigins = !!process.env.ARENA_DEV; // allow http://localhost pages only when testing
  let tries = fs.existsSync(TRIES) ? fs.readFileSync(TRIES, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  let byUser = new Map();
  const index = () => { byUser = new Map(); for (const t of tries) { if (!byUser.has(t.u)) byUser.set(t.u, []); byUser.get(t.u).push(t); } };
  index();
  const triesOf = (key) => byUser.get(key) || [];
  const saveUsers = () => writeJSON(USERS, users), saveTokens = () => writeJSON(TOKENS, tokens);
  const logTry = (t) => { tries.push(t); if (!byUser.has(t.u)) byUser.set(t.u, []); byUser.get(t.u).push(t); fs.appendFileSync(TRIES, JSON.stringify(t) + '\n'); };
  const bestFile = (key) => path.join(BEST, key + '.json');

  // ---------- accounts ----------
  const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
  function newUser(name, pw) {
    const salt = crypto.randomBytes(16).toString('hex'), key = name.toLowerCase();
    const admin = ADMINS.includes(key);
    return { name, salt, hash: hashPw(pw, salt), created: now(), admin, banned: false, excluded: false, trusted: false,
      flags: [], mode: 'easy', next: Object.fromEntries(LISTS.map((m) => [m, ctx.FIRST])), sess: {}, done: {}, stars: {}, open: null,
      rating: START_RATING, sessions: 0, finished: 0, best: {} };
  }
  function issueToken(key) {
    const t = crypto.randomBytes(32).toString('hex');
    tokens[t] = { u: key, exp: now() + TOKEN_DAYS * 864e5 }; saveTokens(); return t;
  }
  function auth(req) {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || ''), t = m && tokens[m[1]];
    if (!t || t.exp < now()) return null;
    return getUser(t.u);
  }
  // at most n events per `ms` for a key
  const hits = new Map();
  function limited(key, n, ms) {
    const t = now(), a = (hits.get(key) || []).filter((x) => x > t - ms);
    a.push(t); hits.set(key, a); return a.length > n;
  }
  setInterval(() => { // forget old rate-limit records and expired logins
    const t = now();
    for (const [k, a] of hits) if (!a.length || a[a.length - 1] < t - 3600e3) hits.delete(k);
    let gone = 0; for (const [k, v] of Object.entries(tokens)) if (v.exp < t) { delete tokens[k]; gone++; }
    if (gone) saveTokens();
  }, 60e3).unref();
  // short-lived caches: the puzzle list, records and leaderboard are recomputed at most this often
  const cache = new Map();
  function cached(key, ms, fn) {
    const c = cache.get(key), t = now();
    if (c && c.at > t - ms) return c.v;
    const v = fn(); cache.set(key, { at: t, v }); return v;
  }
  const extraOf = (s) => cached('x' + s, 30e3, () => ctx.extraOf(s));
  const counts = (u) => u && !u.banned && !u.excluded && !(u.flags.length && !u.trusted);

  // ---------- puzzles: bot times, records, modes ----------
  function botTimes(seed) {
    const b = ctx.botRuns(seed), x = extraOf(seed), out = {};
    for (const k of Object.keys(BOTS)) { const r = (b && b[k]) || x[k]; if (r && r.result === 'arrived') out[k] = r.ticks; }
    return out;
  }
  const refTicks = (seed) => botTimes(seed).search || Math.min(N.MAX_TICKS, ...Object.values(botTimes(seed)));
  // a puzzle's fastest time by anyone: players in good standing and bots
  function recordOf(seed) { return cached('r' + seed, 5e3, () => recordNow(seed)); }
  function recordNow(seed) {
    let best = null;
    for (const [k, t] of Object.entries(botTimes(seed))) if (!best || t < best.ticks) best = { ticks: t, by: BOTS[k], bot: true };
    for (const u of Object.values(users)) {
      const t = u.best[seed];
      if (t != null && counts(u) && (!best || t < best.ticks)) best = { ticks: t, by: u.name, bot: false };
    }
    return best;
  }
  // the world record: the fastest time by a player in good standing (bots don't count)
  function wrOf(seed) {
    return cached('w' + seed, 5e3, () => {
      let best = null;
      for (const [k, u] of Object.entries(users)) {
        const t = u.best[seed];
        if (t != null && counts(u) && (!best || t < best.ticks)) best = { ticks: t, by: u.name, key: k };
      }
      return best;
    });
  }
  function puzzleMode(seed) { return cached('m' + seed, 30e3, () => modeNow(seed)); }
  function modeNow(seed) {
    const rec = recordOf(seed), ratios = [];
    let human = ctx.ownerBest ? ctx.ownerBest(seed) : null;   // the site owner's private-page best counts too
    for (const u of Object.values(users)) if (counts(u) && u.best[seed] != null) {
      if (rec) ratios.push(u.best[seed] / rec.ticks);
      if (human == null || u.best[seed] < human) human = u.best[seed];
    }
    const bt = Object.values(botTimes(seed)), trick = trickMode(bt.length ? Math.min(...bt) : null, human);
    return harder(ratios.length >= 3 ? playerMode(ratios) : botMode(ctx.botRuns(seed)), trick);
  }
  const inList = (s, mode, u) => (mode === 'starred' ? !!(u.stars && u.stars[s]) : puzzleMode(s) === mode);
  function nextReady(from, mode, u) {
    let best = null;
    for (const s of ctx.ready) if (s >= from && ctx.playable(s) && (best === null || s < best) && inList(s, mode, u)) best = s;
    return best;
  }
  function medals(u) {
    const m = { gold: 0, silver: 0, bronze: 0, records: 0, wrs: 0 };
    for (const [s, t] of Object.entries(u.best)) {
      const k = medalOf(t, ctx.botRuns(+s)); if (k) m[k]++;
      const r = recordOf(+s); if (r && !r.bot && r.by === u.name) m.records++;
      const w = wrOf(+s); if (w && w.by === u.name) m.wrs++;
    }
    return m;
  }

  // ---------- ratings, rebuilt from the try log (on start and after admin changes) ----------
  const expected = (rp, rq) => 1 / (1 + 10 ** ((rq - rp) / 400));
  // a puzzle's result between 0 and 1: 0.5 for matching the planning bot, 1 for half its time, less per try
  function sessionScore(best, ref, tryCount) {
    if (best == null) return 0;
    return Math.max(0, Math.min(1, 1.5 - best / ref)) * TRY_FACTOR ** Math.max(0, tryCount - 1);
  }
  let puzzles = {};
  const puzzleOf = (seed) => (puzzles[seed] = puzzles[seed] || { rating: START_RATING, sessions: 0, finishes: 0, tries: 0, restarts: 0 });
  function closeSession(u, seed, s) {
    const p = puzzleOf(seed), S = sessionScore(s.best, refTicks(seed), s.tries), E = expected(u.rating, p.rating);
    u.rating += K_PLAYER * (S - E); u.sessions++; if (s.best != null) u.finished++;
    if (counts(u)) { p.rating -= K_PUZZLE * (S - E); p.sessions++; p.tries += s.tries; p.restarts += s.restarts; if (s.best != null) p.finishes++; }
    return { score: S, change: K_PLAYER * (S - E) };
  }
  const blank = () => ({ tries: 0, restarts: 0, deaths: 0, best: null });
  function tally(s, t) {
    if (!isTry(t.end)) return;
    s.tries++;
    if (isRestart(t.end)) s.restarts++; else if (t.end === 'pop' || t.end === 'timeout') s.deaths++;
    else if (t.end === 'arrived' && (s.best == null || t.ticks < s.best)) s.best = t.ticks;
  }
  function rebuild() {
    puzzles = {};
    const st = {};
    for (const u of Object.values(users)) { u.rating = START_RATING; u.sessions = 0; u.finished = 0; u.done = {}; }
    for (const t of tries) {
      const u = users[t.u]; if (!u) continue;
      const id = t.u + ':' + t.seed, s = (st[id] = st[id] || blank());
      tally(s, t);
      if (t.end === 'next') { if (!u.done[t.seed]) { closeSession(u, t.seed, s); u.done[t.seed] = 1; } delete st[id]; }
    }
    // live counters for puzzles still open
    for (const u of Object.values(users)) u.sess = {};
    for (const [id, s] of Object.entries(st)) { const [k, seed] = id.split(':'); if (users[k]) users[k].sess[seed] = s; }
  }

  // ---------- automatic R-spam flags ----------
  function checkFlags(key) {
    const u = users[key]; if (!u || u.trusted) return;
    const rs = triesOf(key).filter((t) => isRestart(t.end)), last = rs.slice(-30), recent = rs.filter((t) => t.at > now() - 10 * 60e3);
    const reasons = [];
    if (recent.length >= 40) reasons.push(['fast', `${recent.length} restarts in 10 minutes`]);
    if (last.length >= 20) {
      const instant = last.filter((t) => t.ticks < 30).length, idle = last.filter((t) => t.idle).length;
      if (instant / last.length > 0.6) reasons.push(['instant', `${instant} of the last ${last.length} restarts within half a second`]);
      if (idle / last.length > 0.7) reasons.push(['idle', `${idle} of the last ${last.length} restarts without pressing a key`]);
    }
    const fresh = reasons.filter(([kind]) => !u.flags.some((f) => f.kind === kind));
    if (fresh.length) {
      const wasCounted = counts(u);
      for (const [kind, reason] of fresh) u.flags.push({ kind, reason, at: now() });
      saveUsers();
      if (wasCounted) rebuild(); // their results come out of the puzzle stats and records
    }
  }

  // ---------- a player's puzzle ----------
  // tries on a puzzle since the player last moved on from it
  function session(u, seed) { return (u.sess[seed] = u.sess[seed] || blank()); }
  function current(key) {
    const u = users[key], mode = u.mode, seed = nextReady(u.next[mode], mode, u);
    u.stars = u.stars || {}; u.next.starred = u.next.starred || ctx.FIRST;
    const left = Object.fromEntries(LISTS.map((m) => [m, [...ctx.ready].filter((s) => s >= u.next[m] && ctx.playable(s) && inList(s, m, u)).length]));
    if (seed === null) return { seed: null, mode, left, first: prevReady(Infinity, mode, u) === null, message: mode === 'starred'
      ? (Object.keys(u.stars).length ? "You're past your last starred puzzle. Press Back to replay them, or star more with the ☆ button." : 'No starred puzzles yet. Press the ☆ button on a puzzle to save it here.')
      : `You've done every ${mode} puzzle that's ready. The bots are still working on new ones; try another mode or check back later.` };
    if (seed !== u.next[mode]) { u.next[mode] = seed; saveUsers(); }
    const t = ctx.task(seed), b = ctx.botRuns(seed), x = extraOf(seed), mine = readJSON(bestFile(key), {}), cur = session(u, seed);
    return { seed, mode, left, map: ctx.getMap(t.key), tile: N.TILE, touchR: N.BALL_R, goal: t.goal, start: t.start, maxTicks: N.MAX_TICKS,
      session: { tries: cur.tries, restarts: cur.restarts, deaths: cur.deaths, best: cur.best }, yourBest: u.best[seed] ?? null,
      practice: !!u.done[seed], starred: !!u.stars[seed], puzzleMode: puzzleMode(seed), first: prevReady(seed, mode, u) === null,
      record: recordOf(seed), wr: wrPublic(seed), fastestBot: Math.min(...Object.values(botTimes(seed)), N.MAX_TICKS), refTicks: refTicks(seed), rating: Math.round(puzzleOf(seed).rating), bots: botTimes(seed),
      ghosts: { search: b && b.search.frames, baseline: b && b.baseline.frames, fast: x.fast && x.fast.frames,
        net: x.net && x.net.frames, guided: x.guided && x.guided.frames, you: mine[seed] || null, wr: wrFrames(seed) } };
  }
  const wrPublic = (seed) => { const w = wrOf(seed); return w && { ticks: w.ticks, by: w.by }; };
  // the WR holder's run, to race as a ghost
  function wrFrames(seed) { const w = wrOf(seed); return w ? readJSON(bestFile(w.key), {})[seed] || null : null; }
  function start(key) {
    const u = users[key], mode = u.mode;
    if (u.banned) throw new Error('This account is banned.');
    const seed = nextReady(u.next[mode], mode, u); if (seed === null) throw new Error('No puzzle ready.');
    // a try that was started and never reported counts as a restart on its puzzle
    if (u.open) {
      const e = { u: key, seed: u.open.seed, at: now(), end: 'abandoned', ticks: 0, idle: true };
      logTry(e); tally(session(u, u.open.seed), e);
    }
    u.open = { id: crypto.randomBytes(8).toString('hex'), at: now(), seed, mode };
    saveUsers(); checkFlags(key);
    return { tryId: u.open.id, seed };
  }
  function finish(key, body) {
    const u = users[key], open = u.open;
    if (!open || body.tryId !== open.id) throw new Error('Unknown try. Reload the page.');
    const ks = body.keys;
    if (!Array.isArray(ks) || ks.length > N.MAX_TICKS || !ks.every((k) => Number.isInteger(k) && k >= 0 && k <= 8)) throw new Error('Bad keys.');
    // the server's replay decides; a run that didn't finish, die or time out was a restart
    const run = ctx.record(ctx.task(open.seed), (i) => (i < ks.length ? ks[i] : undefined));
    const end = run.result === 'arrived' || run.result === 'pop' ? run.result : ks.length >= N.MAX_TICKS ? 'timeout' : 'restart';
    u.open = null;
    const entry = { u: key, seed: open.seed, at: now(), end, ticks: run.ticks, idle: ks.every((k) => k === 0), claimed: ENDS.includes(body.end) ? body.end : null };
    const cur = session(u, open.seed), recBefore = recordOf(open.seed), wrBefore = wrOf(open.seed);
    tally(cur, entry);
    let best = false;
    if (end === 'arrived' && (u.best[open.seed] == null || run.ticks < u.best[open.seed])) {
      best = true; u.best[open.seed] = run.ticks;
      const mine = readJSON(bestFile(key), {}); mine[open.seed] = run.frames; writeJSON(bestFile(key), mine);
    }
    logTry(entry); saveUsers(); checkFlags(key);
    if (best) for (const k of ['r', 'w', 'm']) cache.delete(k + open.seed);
    const rec = recordOf(open.seed), wr = wrOf(open.seed);
    return { end, ticks: run.ticks, claimed: entry.claimed, best, medal: end === 'arrived' ? medalOf(run.ticks, ctx.botRuns(open.seed)) : null,
      record: rec, wr: wrPublic(open.seed), newWR: end === 'arrived' && !!wr && wr.by === u.name && (!wrBefore || run.ticks < wrBefore.ticks),
      newRecord: end === 'arrived' && !!rec && !rec.bot && rec.by === u.name && (!recBefore || run.ticks < recBefore.ticks),
      session: { tries: cur.tries, restarts: cur.restarts, deaths: cur.deaths, best: cur.best } };
  }
  function dropOpen(u, key, seed) {
    if (u.open && u.open.seed === seed) { const e = { u: key, seed, at: now(), end: 'abandoned', ticks: 0, idle: true }; logTry(e); tally(session(u, seed), e); u.open = null; }
  }
  // move on (or skip) to the next puzzle in this mode; the puzzle's result counts towards the rating now,
  // unless it already counted on an earlier visit (going back to a puzzle is practice)
  function next(key) {
    const u = users[key], mode = u.mode, seed = nextReady(u.next[mode], mode, u);
    if (seed === null) throw new Error('No puzzle ready.');
    dropOpen(u, key, seed);
    logTry({ u: key, seed, at: now(), end: 'next' });
    const practice = !!u.done[seed], r = practice ? { score: null, change: 0 } : closeSession(u, seed, session(u, seed));
    u.done[seed] = 1; delete u.sess[seed];
    u.next[mode] = seed + 1; saveUsers();
    return { ...r, practice, rating: u.rating, puzzle: current(key) };
  }
  function prevReady(seed, mode, u) {
    let best = null;
    for (const s of ctx.ready) if (s < seed && s >= ctx.FIRST && ctx.playable(s) && (best === null || s > best) && inList(s, mode, u)) best = s;
    return best;
  }
  // back to the previous puzzle in this mode
  function back(key) {
    const u = users[key], mode = u.mode, seed = nextReady(u.next[mode], mode, u), prev = prevReady(seed === null ? Infinity : seed, mode, u);
    if (prev === null) throw new Error('This is the first puzzle in this mode.');
    if (seed !== null) dropOpen(u, key, seed);
    u.next[mode] = prev; saveUsers();
    return current(key);
  }

  // ---------- public tables ----------
  function leaderboard() {
    const players = Object.values(users).filter((u) => !u.banned && !u.excluded && u.sessions >= 3)
      .map((u) => ({ name: u.name, rating: Math.round(u.rating), finished: u.finished, sessions: u.sessions, ...medals(u), flagged: u.flags.length > 0 && !u.trusted }))
      .sort((a, b) => b.rating - a.rating).slice(0, 100);
    const pz = Object.entries(puzzles).filter(([, p]) => p.sessions > 0).map(([s, p]) => {
      const rec = recordOf(+s), mine = Object.values(users).filter((u) => counts(u) && u.best[s] != null).map((u) => u.best[s] / (rec ? rec.ticks : 1));
      return { seed: +s, mode: puzzleMode(+s), rating: Math.round(p.rating), players: p.sessions, finishRate: p.finishes / p.sessions,
        triesPer: p.tries / p.sessions, restartsPer: p.restarts / p.sessions,
        nearRecord: mine.length ? mine.filter((r) => r <= 1.05).length / mine.length : null,
        record: rec && { secs: rec.ticks / 60, by: rec.by, bot: rec.bot }, wr: (() => { const w = wrOf(+s); return w && { secs: w.ticks / 60, by: w.by }; })(),
        botSecs: refTicks(+s) / 60 };
    }).sort((a, b) => b.rating - a.rating);
    return { players, puzzles: pz };
  }
  function puzzleBoard(seed) {
    const rows = Object.values(users).filter((u) => counts(u) && u.best[seed] != null).map((u) => ({ name: u.name, ticks: u.best[seed], bot: false }));
    for (const [k, t] of Object.entries(botTimes(seed))) rows.push({ name: BOTS[k], ticks: t, bot: true });
    return rows.sort((a, b) => a.ticks - b.ticks).slice(0, 50);
  }
  function me(key) {
    const u = users[key];
    return { name: u.name, admin: u.admin, rating: Math.round(u.rating), finished: u.finished, sessions: u.sessions,
      mode: u.mode, modes: LISTS, stars: Object.keys(u.stars || {}).length, medals: medals(u), banned: u.banned, flagged: u.flags.length > 0 && !u.trusted };
  }

  // ---------- admin ----------
  function adminList() {
    return Object.entries(users).map(([key, u]) => {
      const mine = triesOf(key).filter((t) => isTry(t.end)), rs = mine.filter((t) => isRestart(t.end));
      return { key, name: u.name, created: u.created, admin: u.admin, banned: u.banned, excluded: u.excluded, trusted: u.trusted,
        flags: u.flags, rating: Math.round(u.rating), sessions: u.sessions, finished: u.finished, tries: mine.length,
        restarts: rs.length, instant: rs.filter((t) => t.ticks < 30).length, idle: rs.filter((t) => t.idle).length,
        deaths: mine.filter((t) => t.end === 'pop').length, last: mine.length ? mine[mine.length - 1].at : null, counted: !!counts(u) };
    }).sort((a, b) => (b.last || 0) - (a.last || 0));
  }
  function adminAction(body) {
    const u = getUser(body.key); if (!u) throw new Error('No such player.');
    switch (body.action) {
      case 'exclude': u.excluded = true; break;
      case 'include': u.excluded = false; break;
      case 'ban': u.banned = true; break;
      case 'unban': u.banned = false; break;
      case 'clearflags': u.flags = []; u.trusted = true; break;      // trusted: no new automatic flags
      case 'untrust': u.trusted = false; break;
      case 'delete': // all their tries and best runs; the account stays
        tries = tries.filter((t) => t.u !== body.key); index();
        fs.writeFileSync(TRIES, tries.map((t) => JSON.stringify(t) + '\n').join(''));
        if (fs.existsSync(bestFile(body.key))) fs.unlinkSync(bestFile(body.key));
        Object.assign(u, { next: Object.fromEntries(LISTS.map((m) => [m, ctx.FIRST])), sess: {}, done: {}, open: null, best: {}, flags: [] });
        break;
      default: throw new Error('Unknown action.');
    }
    cache.clear(); rebuild(); saveUsers();
    return { ok: true };
  }

  // ---------- http ----------
  function send(req, res, code, body) {
    const o = req.headers.origin, h = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    if (o && (origins.includes(o) || (devOrigins && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)))) {
      Object.assign(h, { 'access-control-allow-origin': o, vary: 'Origin', 'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-max-age': '600' });
    }
    res.writeHead(code, h); res.end(body === undefined ? '' : JSON.stringify(body));
  }
  const ip = (req) => req.headers['cf-connecting-ip'] || req.socket.remoteAddress;

  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') return send(req, res, 204);
    if (limited('ip:' + ip(req), IP_LIMIT, 10e3)) return send(req, res, 429, { error: 'Too many requests. Slow down.' });
    const u = new URL(req.url, 'http://x');
    let raw = '', big = false;
    req.on('data', (c) => { raw += c; if (raw.length > 64e3 && !big) { big = true; send(req, res, 413, { error: 'Too big.' }); req.destroy(); } });
    req.on('end', () => {
      if (big) return;
      try {
        const body = raw ? JSON.parse(raw) : {}, p = u.pathname, post = req.method === 'POST';
        if (p === '/api/health') return send(req, res, 200, { ok: true });
        if ((p === '/api/register' || p === '/api/login') && post) {
          if (limited('auth:' + ip(req), 10, 10 * 60e3)) return send(req, res, 429, { error: 'Too many tries. Wait a few minutes.' });
          const name = String(body.username || ''), pw = String(body.password || ''), key = name.toLowerCase();
          if (p === '/api/register') {
            if (!/^[A-Za-z0-9_-]{3,20}$/.test(name) || RESERVED.test(name)) return send(req, res, 400, { error: 'Usernames are 3 to 20 letters, numbers, - or _.' });
            if (pw.length < 8 || pw.length > 200) return send(req, res, 400, { error: 'Passwords need at least 8 characters.' });
            if (getUser(key)) return send(req, res, 409, { error: 'That name is taken.' });
            if (limited('register:' + ip(req), REG_LIMIT, 60 * 60e3)) return send(req, res, 429, { error: 'Too many new accounts from here.' });
            users[key] = newUser(name, pw); saveUsers();
            return send(req, res, 200, { token: issueToken(key), me: me(key) });
          }
          const v = getUser(key);
          if (!v || !crypto.timingSafeEqual(Buffer.from(hashPw(pw, v.salt), 'hex'), Buffer.from(v.hash, 'hex'))) return send(req, res, 401, { error: 'Wrong username or password.' });
          return send(req, res, 200, { token: issueToken(key), me: me(key) });
        }
        if (p === '/api/leaderboard') return send(req, res, 200, cached('board', 10e3, leaderboard));
        if (p === '/api/puzzle') return send(req, res, 200, puzzleBoard(parseInt(u.searchParams.get('seed'), 10)));
        const user = auth(req);
        if (!user) return send(req, res, 401, { error: 'Please log in.' });
        const key = user.name.toLowerCase();
        if (p === '/api/logout' && post) { delete tokens[/^Bearer (\w+)$/.exec(req.headers.authorization)[1]]; saveTokens(); return send(req, res, 200, { ok: true }); }
        if (p === '/api/me') return send(req, res, 200, me(key));
        if (p === '/api/current') return send(req, res, 200, current(key));
        if (p === '/api/star' && post) {
          const s = parseInt(body.seed, 10); if (!ctx.ready.has(s)) return send(req, res, 400, { error: 'No such puzzle.' });
          user.stars = user.stars || {};
          if (body.on) user.stars[s] = now(); else delete user.stars[s];
          saveUsers(); return send(req, res, 200, { seed: s, starred: !!user.stars[s], count: Object.keys(user.stars).length });
        }
        if (p === '/api/mode' && post) {
          if (!LISTS.includes(body.mode)) return send(req, res, 400, { error: 'Unknown mode.' });
          user.mode = body.mode; saveUsers(); return send(req, res, 200, current(key));
        }
        if (p === '/api/start' && post) {
          if (limited('start:' + key, 4, 1000)) return send(req, res, 429, { error: 'Slow down.' });
          return send(req, res, 200, start(key));
        }
        if (p === '/api/finish' && post) {
          if (limited('finish:' + key, 4, 1000) || limited('finish:all', 40, 1000)) return send(req, res, 429, { error: 'Slow down.' });
          return send(req, res, 200, finish(key, body));
        }
        if (p === '/api/next' && post) return send(req, res, 200, next(key));
        if (p === '/api/back' && post) return send(req, res, 200, back(key));
        if (p.startsWith('/api/admin/')) {
          if (!user.admin) return send(req, res, 403, { error: 'Admins only.' });
          if (p === '/api/admin/players') return send(req, res, 200, adminList());
          if (p === '/api/admin/action' && post) return send(req, res, 200, adminAction(body));
        }
        send(req, res, 404, { error: 'Not found.' });
      } catch (e) { send(req, res, 400, { error: e.message }); }
    });
  });
  server.requestTimeout = 15e3; server.headersTimeout = 10e3; // don't let slow requests hold connections open
  rebuild();
  server.listen(ctx.port, ctx.host, () => console.log(`arena: http://${ctx.host}:${ctx.port}/api/health`));
  return { server, users, rebuild };
};
