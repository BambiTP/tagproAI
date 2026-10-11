// tune/contain.js - the containing chasers from the private page's "Chase me" tab (watch.html mContain), with every
// number pulled out into P so tune/tune.js can search for better ones. Shared by node (tune/game.js) and the browser
// (served at /tune/contain.js, used by the "Chasers contain (tuned)" mode).
//
// Each tick one chaser is the presser (the one the carrier is moving away from: closes in behind it, matching its
// speed, `cushion` metres back) and the other the cutter (stands ahead/beside the carrier where it leaves the least
// room to escape: rays to walls in 16 directions, `rayMax` long, room towards home counting `homeW` extra and along
// its momentum `momW` extra; moving further costs `distW` per metre). New: `sideMin` keeps the cutter's spot on the
// carrier's way home (cosine to the route-home direction at least sideMin; -1 = anywhere, as before) and `route`
// measures "towards home" along the route round walls instead of the straight line to the flag.
// SPLIT mode (split = 1, the user's idea): instead of both trailing, one chaser (the one further along the carrier's
// way home) races AHEAD: it goes for the first point on the carrier's route home it can reach `margin` metres before
// the carrier (looking minLead..maxLead tiles along the route), so it waits between the carrier and home. Once it is
// ahead and within boxR metres, it boxes in with the cutter rules above. The other presses from the side away from the
// ahead chaser (pressSide 0 = straight behind, 1 = fully the opposite side), herding the carrier towards it.
// A chaser only goes for the tag (solo) when holding one key touches the carrier whatever it does after its reaction.
// quadKeep = 1: each chaser keeps its spots inside its own quadrant of the carrier (the quadrant rule: crossing into
// another one counts as a swipe), at least quadM metres in; it learns its quadrant as tune/game.js does.
// Speed (the user: they don't need full speed, especially the containing one): coast = a band (m/s) around the speed a
// chaser wants in which it lets go of the keys instead of pushing (no overshooting); the cutter (and split's ahead
// chaser while boxing in) moves at most cutVmax once within calmR metres of its spot. When not swiping, no chaser moves more than
// close m/s faster than the carrier: they keep pace instead of racing in (close 2.7 = no limit). closeLead = 1 (the user): only the chaser on the side the
// carrier is moving towards is held to that (it waits in the way); the other one, which it is moving away from, runs. brake > 0: a chaser closes on its
// spot only as fast as it can still slow to the carrier's speed by the time it gets there (brake m/s/s; a ball speeds up
// about 1.5 m/s/s), so a slow carrier doesn't see it fly past. lean: the presser sits lean x carrier speed (s) closer,
// since a carrier moving fast away from it can't turn back in time (cushion never below 0.45 m).
// adj = 1 (the user): the two chasers are always in neighbouring quadrants of the carrier (sharing one side of it, split
// across the other line), never the same quadrant or diagonal ones; when they are, the one nearest a line is sent across
// it (that fix is kept until they are neighbours), and each keeps its spots inside its wanted quadrant (adjM metres in;
// small, or the carrier slips between two chasers split across its line), backing up when that is behind it.
// lineV > 0 (the user): a chaser never carries much momentum towards its quadrant lines (moving with the carrier): towards
// a line it goes only as fast as it could still stop before it at lineA m/s/s, and at least lineV m/s; along the lines and
// at the carrier it is free, so it comes in down its own side instead of drifting across.
// wallNear > 0: once the carrier is within wallNear metres of a wall along its motion it has to turn, so chasers ease off
// to at most wallV m/s (not when swiping).
// pairSolo = 1: a chaser may also commit when it is a near miss (within pairR metres of certain) while its teammate is
// within pairD metres of the carrier on the other side of it, so the dodge runs towards the teammate.
// predict: the chasers see the carrier react ticks late; for placing themselves (not for the certain-tag test, which
// allows for the delay itself) they carry it forward predict * react ticks on its momentum, stopped by walls.
// wallSolo = 1 (always on now; 0 = the old test): walls next to the carrier limit how far it can dodge that way (so
// pinned in a corner it can be finished); the old test pretended it could dodge through walls, so cornered carriers
// were never killed. Walls are checked a little to each side too, since a wall ending beside it can be slipped round.
(function (out) {
  const ACTIONS = [[0, 0], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const T_ = 0.4, TOUCH = 0.385, DT = 1 / 60, DAMP = 1 - 0.5 / 60, ACC = 0.025, MS = 2.5;
  const DEFAULTS = { cushion: 0.7, r1: 0.8, r2: 1.2, spread: 5, homeW: 0.8, momW: 0.5, distW: 2, rayMax: 3, obstR: 0.6,
    gain: 3, vmax: 2.7, soloTicks: 60, sideMin: -1, route: 0,
    quadKeep: 0, quadM: 0.5, coast: 0.1, cutVmax: 2.7, calmR: 1, pairSolo: 0, pairR: 0.15, pairD: 1.5, predict: 0, wallSolo: 1, split: 0, minLead: 2, maxLead: 10, margin: 0.4, boxR: 1.6, pressSide: 0.4, close: 2.7, brake: 2, lean: 0, adj: 1, adjM: 0.1, wallNear: 1.2, wallV: 1.5, closeLead: 0, lineV: 0.6, lineA: 2 };
  // the values tune.js searches over: [min, max], or 'flag' for 0/1
  const RANGES = { cushion: [0.6, 2], r1: [0.6, 1.6], r2: [0.8, 2.4], spread: [2, 7], homeW: [0, 4], momW: [0, 2], distW: [0, 4],
    rayMax: [1.5, 6], obstR: [0.3, 1], gain: [1, 6], vmax: [2, 3.5], soloTicks: [20, 90], sideMin: [-1, 0.9], route: 'flag',
    quadKeep: 'flag', quadM: [0.3, 1.2], coast: [0.05, 0.6], cutVmax: [1, 2.7], calmR: [0.3, 2], pairSolo: 'flag', pairR: [0, 0.4], pairD: [0.8, 3], predict: [0, 1], split: 'flag', minLead: [0, 6], maxLead: [4, 18], margin: [-0.5, 2], boxR: [0.8, 3.5], pressSide: [0, 1], close: [0.2, 2.7], brake: [0, 4], lean: [0, 0.4], adj: 'flag', adjM: [0, 0.8], wallNear: [0, 3], wallV: [0.5, 2.7], closeLead: 'flag', lineV: [0, 1.5], lineA: [0.3, 4] };
  const INTS = { spread: 1, soloTicks: 1, minLead: 1, maxLead: 1 };

  const blocked = (v) => { v = parseFloat(v); const f = Math.floor(v); return v === 0 || f === 1 || v === 7 || v === 9.1 || v === 9.3; };
  function field(tiles, gx, gy) { // route distance (m) to tile (gx, gy), spike neighbours cost extra
    const W = tiles.length, H = tiles[0].length, d = new Float64Array(W * H).fill(Infinity), pen = new Float32Array(W * H);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (parseFloat(tiles[x][y]) === 7) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const u = x + a, v = y + b; if (u >= 0 && v >= 0 && u < W && v < H) pen[u * H + v] = 0.3; }
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) return { d, W, H };
    const q = [[0, gx * H + gy]]; d[gx * H + gy] = 0;
    while (q.length) {
      let bi = 0; for (let i = 1; i < q.length; i++) if (q[i][0] < q[bi][0]) bi = i;
      const [c, k] = q[bi]; q[bi] = q[q.length - 1]; q.pop(); if (c > d[k]) continue;
      const x = (k / H) | 0, y = k - x * H;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        if (!a && !b) continue; const u = x + a, v = y + b; if (u < 0 || v < 0 || u >= W || v >= H) continue;
        if (blocked(tiles[u][v]) || (a && b && (blocked(tiles[u][y]) || blocked(tiles[x][v])))) continue;
        const nc = c + T_ * (a && b ? Math.SQRT2 : 1) + pen[u * H + v] * T_;
        if (nc < d[u * H + v]) { d[u * H + v] = nc; q.push([nc, u * H + v]); }
      }
    }
    return { d, W, H };
  }
  function clear(tiles, x0, y0, x1, y1) {
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L / 0.08)), r = 0.185;
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]]) {
        const tx = Math.round((x + ox) / T_), ty = Math.round((y + oy) / T_);
        if (tx < 0 || ty < 0 || tx >= tiles.length || ty >= tiles[0].length || blocked(tiles[tx][ty])) return false;
      }
    }
    return true;
  }
  const wallAt = (tiles, x, y) => { const tx = Math.round(x / T_), ty = Math.round(y / T_); return tx < 0 || ty < 0 || tx >= tiles.length || ty >= tiles[0].length || blocked(tiles[tx][ty]); };
  const fieldAt = (F, x, y) => { const u = Math.round(x / T_), v = Math.round(y / T_); return u < 0 || v < 0 || u >= F.W || v >= F.H ? Infinity : F.d[u * F.H + v]; };
  function fieldDir(F, x, y) { // the downhill direction of a route field from (x, y), [0, 0] when there is none
    const u = Math.round(x / T_), v = Math.round(y / T_); let b = fieldAt(F, x, y), hx = 0, hy = 0;
    for (let a = -1; a <= 1; a++) for (let e = -1; e <= 1; e++) { if (!a && !e) continue; const dv = fieldAt(F, (u + a) * T_, (v + e) * T_); if (dv < b) { b = dv; const L = Math.hypot(a, e); hx = a / L; hy = e / L; } }
    return [hx, hy];
  }
  const dirKey = (dx, dy) => { const L = Math.hypot(dx, dy); if (!L) return 0; const ax = Math.abs(dx) < 0.38 * L ? 0 : Math.sign(dx), ay = Math.abs(dy) < 0.38 * L ? 0 : Math.sign(dy); return ACTIONS.findIndex(([a, b]) => a === ax && b === ay); };
  function kin(x, y, vx, vy, a) { vx *= DAMP; vy *= DAMP; const [ax, ay] = ACTIONS[a];
    if (ax > 0 && vx < MS) vx += ACC; if (ax < 0 && vx > -MS) vx -= ACC; if (ay > 0 && vy < MS) vy += ACC; if (ay < 0 && vy > -MS) vy -= ACC; return [x + vx * DT, y + vy * DT, vx, vy]; }

  // env: { tiles, home: route field to the carrier's home (field()), spot: {x, y} its flag, react: ticks late,
  //        line: the contain line when there is one (tune/game.js) }
  // chasers: [{ x, y, vx, vy, dead }]; state: one object per chaser kept between ticks (made here when missing)
  function makeContain(env, P0) {
    const P = Object.assign({}, DEFAULTS, P0 || {}), tiles = env.tiles, wall = (x, y) => wallAt(tiles, x, y);
    const ray = (x, y, dx, dy, max, obst) => { for (let d = 0.1; d <= max; d += 0.1) { const px = x + dx * d, py = y + dy * d; if (wall(px, py)) return d - 0.1; for (const o of obst) if (Math.hypot(px - o[0], py - o[1]) < P.obstR) return d - 0.1; } return max; };
    const homeVec = (fc) => { // unit vector towards the carrier's home: along the route, or the straight line to the flag
      if (P.route && env.home) { const [hx, hy] = fieldDir(env.home, fc.x, fc.y); if (hx || hy) return [hx, hy]; }
      const gx = env.spot.x - fc.x, gy = env.spot.y - fc.y, gl = Math.hypot(gx, gy) || 1; return [gx / gl, gy / gl]; };
    const escape = (fc, obst, hv) => { // how much room the carrier has, weighted towards home and along its momentum
      const sp = Math.hypot(fc.vx, fc.vy); let e = 0;
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, dx = Math.cos(a), dy = Math.sin(a);
        const w = (1 + P.homeW * Math.max(0, dx * hv[0] + dy * hv[1])) * (1 + P.momW * (sp > 0.3 ? Math.max(0, (dx * fc.vx + dy * fc.vy) / sp) : 0));
        e += w * ray(fc.x, fc.y, dx, dy, P.rayMax, obst); }
      return e; };
    const soloKey = (c, fc, slack = 0) => { // a key that touches the carrier whatever it does (chase/killtest.js sure), seen `react` ticks late
      let best = -1, bestT = Infinity, room = null;
      // room to dodge each way, measured along lines a little to each side as well (OFFS metres): a wall that ends just
      // beside the carrier can be slipped round with a small sideways move, so the most room within reach counts
      const OFFS = [-0.4, -0.2, 0, 0.2, 0.4];
      if (P.wallSolo) { const ax = (dx, dy, o) => { const px = fc.x - dy * o, py = fc.y + dx * o; let d = 0; for (; d < 1.5; d += 0.04) if (wall(px + dx * (d + 0.19), py + dy * (d + 0.19))) break; return d; };
        room = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => OFFS.map((o) => ax(dx, dy, o))); }
      const roomIn = (r, side) => { let m = 0; OFFS.forEach((o, j) => { if (Math.abs(o) <= side + 0.05) m = Math.max(m, r[j]); }); return m; };
      for (let a = 1; a <= 8; a++) {
        let cx = c.x, cy = c.y, cvx = c.vx, cvy = c.vy, fx = fc.x, fy = fc.y, fvx = fc.vx, fvy = fc.vy, sp = 0, vs = 0;
        for (let t = 0; t < env.react; t++) { fvx *= DAMP; fvy *= DAMP; fx += fvx * DT; fy += fvy * DT; vs = vs * DAMP + ACC; sp += vs * DT; }
        for (let t = 1; t <= P.soloTicks && t < bestT; t++) {
          [cx, cy, cvx, cvy] = kin(cx, cy, cvx, cvy, a); if (wall(cx, cy)) break;
          fvx *= DAMP; fvy *= DAMP; fx += fvx * DT; fy += fvy * DT; vs = vs * DAMP + ACC; sp += vs * DT;
          let ex = sp, ey = sp;
          if (room) { const sx = Math.abs(fy - fc.y) + sp, sy = Math.abs(fx - fc.x) + sp; // how far it can be off each line
            ex = Math.min(sp, Math.max(0, fx >= cx ? roomIn(room[0], sx) - (fx - fc.x) : roomIn(room[1], sx) - (fc.x - fx)));
            ey = Math.min(sp, Math.max(0, fy >= cy ? roomIn(room[2], sy) - (fy - fc.y) : roomIn(room[3], sy) - (fc.y - fy))); }
          if (Math.hypot(Math.abs(fx - cx) + ex, Math.abs(fy - cy) + ey) < TOUCH + slack) { bestT = t; best = a; break; }
        }
      }
      return bestT <= P.soloTicks ? { a: best, t: bestT } : null; };
    let easeOff = false; // this tick: the carrier is about to reach a wall (wallNear)
    const goTo = (c, s, tx, ty, fc, t, calm) => {
      if ((s.want || P.quadKeep) && s.q) { const Q = s.want || s.q, M = s.want ? P.adjM : P.quadM; if (Q[0] && (tx - fc.x) * Q[0] < M) tx = fc.x + Q[0] * M; if (Q[1] && (ty - fc.y) * Q[1] < M) ty = fc.y + Q[1] * M; } // to a spot moving with the carrier: match its velocity, pulled onto the spot; route round walls
      if (!clear(tiles, c.x, c.y, tx, ty)) {
        if (!s.F || t - s.Ft >= 12) { s.F = field(tiles, Math.round(tx / T_), Math.round(ty / T_)); s.Ft = t; }
        const cx = Math.round(c.x / T_), cy = Math.round(c.y / T_); let best = Infinity, wx = tx, wy = ty;
        for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const u = cx + a, v = cy + b; if (u < 0 || v < 0 || u >= s.F.W || v >= s.F.H) continue; const dv = s.F.d[u * s.F.H + v]; if (dv === Infinity) continue;
          const cc = dv + Math.hypot(c.x - u * T_, c.y - v * T_); if (cc < best && clear(tiles, c.x, c.y, u * T_, v * T_)) { best = cc; wx = u * T_; wy = v * T_; } }
        const L = Math.hypot(wx - c.x, wy - c.y) || 1; return dirKey((wx - c.x) / L * MS - c.vx, (wy - c.y) / L * MS - c.vy);
      }
      const vm = calm && Math.hypot(tx - c.x, ty - c.y) < P.calmR ? Math.min(P.vmax, P.cutVmax) : P.vmax, vc = Math.min(easeOff ? Math.min(vm, P.wallV) : vm, !P.closeLead || (c.x - fc.x) * fc.vx + (c.y - fc.y) * fc.vy > 0 ? Math.hypot(fc.vx, fc.vy) + P.close : Infinity);
      const gx = tx - c.x, gy = ty - c.y, gd = Math.hypot(gx, gy), gk = P.brake > 0 && gd > 1e-6 ? Math.min(P.gain, Math.sqrt(2 * P.brake * gd) / gd) : P.gain;
      let vx = fc.vx + gk * gx, vy = fc.vy + gk * gy; const V = Math.hypot(vx, vy); if (V > vc) { vx *= vc / V; vy *= vc / V; }
      if (P.lineV > 0 && (s.want || P.quadKeep) && s.q) { const Q = s.want || s.q, M = s.want ? P.adjM : P.quadM; // slow towards its quadrant lines (lineV)
        for (let a = 0; a < 2; a++) { if (!Q[a]) continue; const d = ((a ? c.y - fc.y : c.x - fc.x)) * Q[a] - M, ok = Math.max(P.lineV, Math.sqrt(2 * P.lineA * Math.max(0, d)));
          const rel = ((a ? vy - fc.vy : vx - fc.vx)) * Q[a]; if (rel < -ok) { if (a) vy = fc.vy - ok * Q[a]; else vx = fc.vx - ok * Q[a]; } } }
      const ex = vx - c.vx, ey = vy - c.vy; return ACTIONS.findIndex(([a, b]) => a === (Math.abs(ex) < P.coast ? 0 : Math.sign(ex)) && b === (Math.abs(ey) < P.coast ? 0 : Math.sign(ey))); };

    const routeAhead = (fc, n) => { // points along the carrier's route home, one per tile, up to n tiles
      const pts = []; let x = fc.x, y = fc.y, d = 0;
      for (let k = 0; k < n; k++) { const [hx, hy] = fieldDir(env.home, x, y); if (!hx && !hy) break; const s = Math.hypot(hx, hy) * T_; x = Math.round(x / T_) * T_ + hx * T_; y = Math.round(y / T_) * T_ + hy * T_; d += s; pts.push({ x, y, d }); }
      return pts; };
    const split = (t, fc, chasers, state, out, free, live) => {
      // the ahead chaser: the one nearer home along the route (kept unless the other is clearly nearer, 1 m)
      const hd = (i) => fieldAt(env.home, chasers[i].x, chasers[i].y);
      let ai = state.ahead !== undefined && live.includes(state.ahead) ? state.ahead : live[0];
      for (const i of live) if (hd(i) < hd(ai) - 1) ai = i;
      state.ahead = ai; const pi = live.find((i) => i !== ai), a = chasers[ai], sp = Math.hypot(fc.vx, fc.vy);
      if (free.includes(ai)) {
        const fd = fieldAt(env.home, fc.x, fc.y), ahead = hd(ai) < fd - P.minLead * T_, near = Math.hypot(a.x - fc.x, a.y - fc.y) < P.boxR;
        if (ahead && near) { // in place: box in like the cutter, between the carrier and home
          const hv = homeVec(fc), hx = sp > 0.3 ? fc.vx / sp : hv[0], hy = sp > 0.3 ? fc.vy / sp : hv[1], h0 = Math.atan2(hy, hx), pq = chasers[pi] || a;
          let best = null, bs = Infinity;
          for (const r of [P.r1, P.r2]) for (let k = -P.spread; k <= P.spread; k++) {
            const an = h0 + k * Math.PI / 8, x = fc.x + Math.cos(an) * r, y = fc.y + Math.sin(an) * r;
            if (P.sideMin > -1 && Math.cos(an) * hv[0] + Math.sin(an) * hv[1] < P.sideMin) continue;
            if (wall(x, y) || !clear(tiles, fc.x, fc.y, x, y)) continue;
            const sc = escape(fc, [[x, y], [pq.x, pq.y]], hv) + P.distW * Math.hypot(x - a.x, y - a.y); if (sc < bs) { bs = sc; best = [x, y]; }
          }
          out[ai] = goTo(a, state[ai], best ? best[0] : fc.x, best ? best[1] : fc.y, fc, t, true);
        } else { // race to the first route point it reaches margin metres before the carrier
          // with a contain line (env.line, tiles), never past it: the carrier crossing it is already out
          let pts = routeAhead(fc, P.maxLead); const L = env.line;
          if (L) { const cut = pts.findIndex((q) => (q.x / T_ - L.x) * L.ux + (q.y / T_ - L.y) * L.uy > L.face - 1.2); if (cut >= 0) pts = pts.slice(0, Math.max(1, cut)); }
          let tgt = pts[pts.length - 1];
          for (let k = P.minLead; k < pts.length; k++) { if (Math.hypot(pts[k].x - a.x, pts[k].y - a.y) <= pts[k].d - P.margin) { tgt = pts[k]; break; } }
          out[ai] = tgt ? goTo(a, state[ai], tgt.x, tgt.y, { vx: 0, vy: 0 }, t) : goTo(a, state[ai], fc.x, fc.y, fc, t);
        }
      }
      if (pi !== undefined && free.includes(pi)) { // press from the side away from the ahead chaser
        const p = chasers[pi]; let bx = sp > 0.3 ? -fc.vx / sp : p.x - fc.x, by = sp > 0.3 ? -fc.vy / sp : p.y - fc.y; let l = Math.hypot(bx, by) || 1; bx /= l; by /= l;
        let ox = fc.x - a.x, oy = fc.y - a.y; l = Math.hypot(ox, oy) || 1; ox /= l; oy /= l;
        let dx = bx * (1 - P.pressSide) + ox * P.pressSide, dy = by * (1 - P.pressSide) + oy * P.pressSide; l = Math.hypot(dx, dy) || 1;
        out[pi] = goTo(p, state[pi], fc.x + dx / l * P.cushion, fc.y + dy / l * P.cushion, fc, t);
      }
      return out; };
    // keys for every chaser this tick; fc = the carrier as the chasers see it (react ticks ago), t = tick number
    const ahead = (fc) => { const n = Math.round(P.predict * env.react); if (!n) return fc; let { x, y, vx, vy } = fc;
      for (let k = 0; k < n; k++) { vx *= DAMP; vy *= DAMP; if (wall(x + vx * DT, y)) vx = 0; if (wall(x, y + vy * DT)) vy = 0; x += vx * DT; y += vy * DT; }
      return { x, y, vx, vy }; };
    return function keys(t, fcSeen, chasers, state) {
      const fc0 = fcSeen, fc = ahead(fcSeen);
      const out = chasers.map(() => 0), free = [];
      chasers.forEach((c, i) => { if (!state[i]) state[i] = { solo: null, F: null, Ft: 0 }; const s = state[i];
        { const d = [c.x - fc0.x, c.y - fc0.y]; if (!s.q) s.q = [0, 0]; for (let a = 0; a < 2; a++) { if (!s.q[a]) { if (Math.abs(d[a]) > 0.3) s.q[a] = Math.sign(d[a]); } else if (d[a] * s.q[a] < -0.3) s.q[a] = -s.q[a]; } }
        if (c.dead) return;
        if (s.solo && t < s.solo.until) { out[i] = s.solo.a; return; } s.solo = null;
        if (t % 4 === 0) { const m = chasers[1 - i], cover = P.pairSolo && m && !m.dead && Math.hypot(m.x - fc0.x, m.y - fc0.y) < P.pairD && (fc0.x - c.x) * (fc0.x - m.x) + (fc0.y - c.y) * (fc0.y - m.y) < 0;
          const k = soloKey(c, fc0, cover ? P.pairR : 0); if (k) { s.solo = { a: k.a, until: t + k.t + 10 }; out[i] = k.a; return; } }
        free.push(i); });
      if (!free.length) return out;
      { const v = Math.hypot(fc0.vx, fc0.vy); easeOff = P.wallNear > 0 && v > 0.3 && ray(fc0.x, fc0.y, fc0.vx / v, fc0.vy / v, P.wallNear, []) < P.wallNear - 0.2; }
      if (P.adj && chasers.length === 2 && !chasers[0].dead && !chasers[1].dead) { // neighbouring quadrants (adj)
        const off = (i) => [chasers[i].x - fc0.x, chasers[i].y - fc0.y], q = [0, 1].map((i) => [0, 1].map((a) => state[i].q[a] || Math.sign(off(i)[a]) || 1));
        const nb = (A, B) => A && B && (A[0] === B[0]) !== (A[1] === B[1]);
        if (nb(q[0], q[1])) { state[0].want = q[0]; state[1].want = q[1]; } else if (nb(state[0].want, state[1].want)) { /* keep the fix already chosen */ }
        else { let bi = 0, ba = 0, bd = Infinity; for (let i = 0; i < 2; i++) for (let a = 0; a < 2; a++) { const d = Math.abs(off(i)[a]); if (d < bd) { bd = d; bi = i; ba = a; } }
          const w = [q[0].slice(), q[1].slice()]; w[bi][ba] = -w[bi][ba]; state[0].want = w[0]; state[1].want = w[1]; }
      } else for (const s of state) if (s) s.want = null;
      const live = chasers.map((c, i) => i).filter((i) => !chasers[i].dead), sp = Math.hypot(fc.vx, fc.vy);
      // presser: the one the carrier is moving away from (or the closest when it is slow)
      const behind = (i) => { const c = chasers[i], dx = c.x - fc.x, dy = c.y - fc.y, l = Math.hypot(dx, dy) || 1; return sp > 0.5 ? (dx * fc.vx + dy * fc.vy) / l / sp : l / 10; };
      let ord = live.slice().sort((a, b) => behind(a) - behind(b));
      if (P.split && env.home && live.length > 1) return split(t, fc, chasers, state, out, free, live);
      const pi = ord[0], ci = ord[1];
      if (pi !== undefined && free.includes(pi)) {
        const ux = sp > 0.3 ? fc.vx / sp : 0, uy = sp > 0.3 ? fc.vy / sp : 0, c = chasers[pi], cu = Math.max(0.45, P.cushion - P.lean * sp); let px = fc.x - ux * cu, py = fc.y - uy * cu;
        if (sp <= 0.3) { const dx = c.x - fc.x, dy = c.y - fc.y, l = Math.hypot(dx, dy) || 1; px = fc.x + dx / l * P.cushion; py = fc.y + dy / l * P.cushion; }
        out[pi] = goTo(c, state[pi], px, py, fc, t);
      }
      if (ci !== undefined && free.includes(ci)) {
        const c = chasers[ci], pq = chasers[pi], hv = homeVec(fc);
        const hx = sp > 0.3 ? fc.vx / sp : hv[0], hy = sp > 0.3 ? fc.vy / sp : hv[1], h0 = Math.atan2(hy, hx);
        let best = null, bs = Infinity;
        for (const r of [P.r1, P.r2]) for (let k = -P.spread; k <= P.spread; k++) {
          const a = h0 + k * Math.PI / 8, x = fc.x + Math.cos(a) * r, y = fc.y + Math.sin(a) * r;
          if (P.sideMin > -1 && Math.cos(a) * hv[0] + Math.sin(a) * hv[1] < P.sideMin) continue;
          if (wall(x, y) || !clear(tiles, fc.x, fc.y, x, y)) continue;
          const sc = escape(fc, [[x, y], [pq.x, pq.y]], hv) + P.distW * Math.hypot(x - c.x, y - c.y); if (sc < bs) { bs = sc; best = [x, y]; }
        }
        out[ci] = goTo(c, state[ci], best ? best[0] : fc.x, best ? best[1] : fc.y, fc, t, true);
      }
      return out;
    };
  }
  Object.assign(out, { makeContain, DEFAULTS, RANGES, INTS, field, clear, wallAt, fieldAt, fieldDir, dirKey, kin, blocked, ACTIONS });
})(typeof module !== 'undefined' ? module.exports : (window.TuneContain = {}));
