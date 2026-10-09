// league/league.js - league training for one carrier against two chasers (league/env.js), by trial and error (PPO).
// Two networks: the carrier's, and the chasers' (both chasers use it, each from its own side). Every generation:
//   - GAMES games where the carrier learns, against the latest chasers half the time and a saved older chaser network
//     the other half (picked from the pool, favouring ones it does worst against), and the same for the chasers
//   - a PPO update of each network from its own games
//   - every SNAP generations both networks are saved into the pool (the league) and tested against simple hand-made
//     players: chasers that lead the carrier, and a carrier that runs at its goal and swerves from chasers within 2 m
// Rewards: the carrier +1 for escaping (past both chasers), the chasers +1 for a return; the loser -1; a draw 0.
// Chasers hold to kill (league/env.js): on a certain kill the key is held and the network overruled; those decisions
// aren't learned from. The hand-made lead chasers hold to kill too.
//   node league/league.js [generations]   (resumes from league/state/ if it is there)
const fs = require('fs'), path = require('path');
const { Net } = require('./nn');
const { Game, VIEW } = require('./env');
const { ACTIONS } = require('../sim');

const DIR = path.join(__dirname, 'state'), GAMES = +(process.env.GAMES || 120), SNAP = 10, GAMMA = 0.99, LAMBDA = 0.95, POOL_MAX = 40;
fs.mkdirSync(DIR, { recursive: true });
let seed = 12345; const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

// ---- simple hand-made players, for measuring progress (they steer in the world frame) ----
const steerKey = (p, tx, ty) => { const q = p.body.GetPosition(), w = p.body.GetLinearVelocity(), L = Math.hypot(tx - q.x, ty - q.y) || 1;
  const ex = (tx - q.x) / L * 2.5 - w.x, ey = (ty - q.y) / L * 2.5 - w.y, ax = Math.abs(ex) < 0.1 ? 0 : Math.sign(ex), ay = Math.abs(ey) < 0.1 ? 0 : Math.sign(ey);
  return ACTIONS.findIndex(([a, b]) => a === ax && b === ay); };
const worldToGame = (g, wa) => { for (let a = 0; a < 9; a++) if (g.keyToWorld(a) === wa) return a; return 0; };
const leadChaser = (g, i) => { const late = g.hist[0].ca, p = g.ch[i], q = p.body.GetPosition(), d = Math.hypot(late.x - q.x, late.y - q.y), tau = Math.min(1.5, d / 2.5);
  return worldToGame(g, steerKey(p, late.x + late.vx * tau, late.y + late.vy * tau)); };
const runCarrier = (g) => { const q = g.ca.body.GetPosition(); let hx = g.goal.x - q.x, hy = g.goal.y - q.y; const l = Math.hypot(hx, hy) || 1; hx /= l; hy /= l;
  for (const c of g.hist[0].ch) { const d = Math.hypot(q.x - c.x, q.y - c.y); if (d < 2) { const w = (2 - d) / 2 * 1.5; hx += (q.x - c.x) / (d || 1) * w; hy += (q.y - c.y) / (d || 1) * w; } }
  return worldToGame(g, steerKey(g.ca, q.x + hx, q.y + hy)); };

// ---- one game; who: 'ca' (record the carrier's decisions) / 'ch' (the chasers') / null; players: functions(g) -> key ----
function play(g, caPlayer, chPlayer, who) {
  g.reset(); const rec = []; let res = null;
  while (!res) {
    const vc = g.view('ca'), v0 = g.view(0), v1 = g.view(1);
    const a = caPlayer(vc), b0 = chPlayer(v0, 0), b1 = chPlayer(v1, 1);
    // a chaser holding a kill is overruled, so that decision isn't the network's and isn't learned from
    if (who === 'ca') rec.push({ x: vc, ...a }); else if (who === 'ch') rec.push([g.holding(0) ? null : { x: v0, ...b0 }, g.holding(1) ? null : { x: v1, ...b1 }]);
    res = g.step(a.a, [b0.a, b1.a]);
  }
  const r = res === 'escape' ? 1 : res === 'return' ? -1 : 0; // the carrier's result
  return { res, r, rec };
}
// advantages (GAE) for one learner's decisions in one game with a reward only at the end
function credit(steps, R) {
  const out = []; let adv = 0, next = 0;
  for (let t = steps.length - 1; t >= 0; t--) {
    const s = steps[t], last = t === steps.length - 1, rwd = last ? R : 0, nv = last ? 0 : next;
    const delta = rwd + GAMMA * nv - s.v; adv = delta + GAMMA * LAMBDA * (last ? 0 : adv);
    out.push({ x: s.x, a: s.a, logp: s.logp, adv, ret: adv + s.v }); next = s.v;
  }
  return out;
}

// ---- state ----
const load = (f) => (fs.existsSync(path.join(DIR, f)) ? JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) : null);
const st = load('state.json') || { gen: 0, pool: { ca: [], ch: [] } };
const caNet = load('carrier.json') ? Net.fromJSON(load('carrier.json')) : new Net(VIEW, 1);
const chNet = load('chaser.json') ? Net.fromJSON(load('chaser.json')) : new Net(VIEW, 2);
const poolNet = {}; const getPool = (side, i) => { const k = side + i; if (!poolNet[k]) poolNet[k] = Net.fromJSON(load(`${side}-${st.pool[side][i].gen}.json`)); return poolNet[k]; };
const game = new Game(777);
const log = (o) => fs.appendFileSync(path.join(DIR, 'log.jsonl'), JSON.stringify(o) + '\n');

// pick an opponent from a pool: favour the ones this learner does worst against (their score), else the latest
function opponent(side) {
  const pool = st.pool[side]; if (!pool.length || rng() < 0.5) return { net: side === 'ca' ? caNet : chNet, i: -1 };
  const w = pool.map((p) => 0.2 + Math.max(0, p.score || 0)); let u = rng() * w.reduce((a, b) => a + b, 0), i = 0;
  while (i < pool.length - 1 && (u -= w[i]) > 0) i++;
  return { net: getPool(side, i), i };
}

const gens = +(process.argv[2] || 100);
for (let G = 0; G < gens; G++) {
  const t0 = Date.now(), caBatch = [], chBatch = [], out = { ca: {}, ch: {} };
  for (let n = 0; n < GAMES; n++) {
    const learnCa = n % 2 === 0, opp = opponent(learnCa ? 'ch' : 'ca');
    const caP = learnCa ? (x) => caNet.act(x, rng) : (x) => opp.net.act(x, rng);
    const chP = learnCa ? (x) => opp.net.act(x, rng) : (x) => chNet.act(x, rng);
    const r = play(game, caP, chP, learnCa ? 'ca' : 'ch');
    if (learnCa) { caBatch.push(...credit(r.rec, r.r)); out.ca[r.res] = (out.ca[r.res] || 0) + 1; }
    else { chBatch.push(...credit(r.rec.map((s) => s[0]).filter(Boolean), -r.r), ...credit(r.rec.map((s) => s[1]).filter(Boolean), -r.r)); out.ch[r.res] = (out.ch[r.res] || 0) + 1; }
    // the pool opponent's score: how well it does against the learner (decays towards the latest results)
    if (opp.i >= 0) { const p = st.pool[learnCa ? 'ch' : 'ca'][opp.i], won = learnCa ? (r.r < 0 ? 1 : 0) : (r.r > 0 ? 1 : 0); p.score = 0.9 * (p.score || 0.5) + 0.1 * won; }
  }
  for (const B of [caBatch, chBatch]) { const m = B.reduce((a, b) => a + b.adv, 0) / (B.length || 1), sd = Math.sqrt(B.reduce((a, b) => a + (b.adv - m) ** 2, 0) / (B.length || 1)) || 1; for (const b of B) b.adv = (b.adv - m) / sd; }
  const uCa = caNet.update(caBatch), uCh = chNet.update(chBatch);
  st.gen++;
  const entry = { gen: st.gen, secs: +((Date.now() - t0) / 1000).toFixed(1), carrierGames: out.ca, chaserGames: out.ch, carrierUpdate: uCa, chaserUpdate: uCh };
  if (st.gen % SNAP === 0) {
    // test against the hand-made players (greedy networks), 60 games each
    const test = (caP, chP) => { const c = {}; for (let n = 0; n < 60; n++) { const r = play(game, caP, chP, null); c[r.res] = (c[r.res] || 0) + 1; } return c; };
    entry.carrierVsLeadChasers = test((x) => caNet.act(x, rng, true), (x, i) => ({ a: leadChaser(game, i) }));
    entry.chasersVsRunningCarrier = test(() => ({ a: runCarrier(game) }), (x) => chNet.act(x, rng, true));
    entry.handVsHand = st.gen === SNAP ? test(() => ({ a: runCarrier(game) }), (x, i) => ({ a: leadChaser(game, i) })) : undefined;
    for (const [side, net] of [['ca', caNet], ['ch', chNet]]) {
      fs.writeFileSync(path.join(DIR, `${side}-${st.gen}.json`), JSON.stringify(net.toJSON()));
      st.pool[side].push({ gen: st.gen, score: 0.5 });
      if (st.pool[side].length > POOL_MAX) st.pool[side].splice(0, 1); // the oldest leaves the league
      for (const k in poolNet) if (k.startsWith(side)) delete poolNet[k];
    }
  }
  log(entry);
  console.log(`gen ${st.gen} ${entry.secs}s carrier learning: ${JSON.stringify(out.ca)} chasers learning: ${JSON.stringify(out.ch)}` +
    (entry.carrierVsLeadChasers ? ` | vs hand-made: carrier ${JSON.stringify(entry.carrierVsLeadChasers)} chasers ${JSON.stringify(entry.chasersVsRunningCarrier)}` : ''));
  fs.writeFileSync(path.join(DIR, 'carrier.json'), JSON.stringify(caNet.toJSON()));
  fs.writeFileSync(path.join(DIR, 'chaser.json'), JSON.stringify(chNet.toJSON()));
  fs.writeFileSync(path.join(DIR, 'state.json'), JSON.stringify(st));
}
