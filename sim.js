// sim.js - tagpro-local's engine run headless: a virtual clock, virtual timers, no network,
// and save/restore of the whole mutable state so search can try futures and rewind.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { GameRoom } = require('./engine/game');
const { loadMap, trimPng } = require('./engine/mapLoader');
const { PHYSICS: PH, STATES } = require('./engine/constants');
const Box2D = require('./engine/box2d');
const V = Box2D.Common.Math.b2Vec2;

const MAP_DIR = path.join(__dirname, 'maps');
const mapCache = {};
function getMap(key) {
  if (!mapCache[key]) {
    const buf = fs.readFileSync(path.join(MAP_DIR, key + '.png'));
    let img;
    try { img = PNG.sync.read(buf); } catch (e) { img = PNG.sync.read(trimPng(buf)); }
    const jf = path.join(MAP_DIR, key + '.json');
    const json = fs.existsSync(jf) ? JSON.parse(fs.readFileSync(jf, 'utf8')) : {};
    mapCache[key] = loadMap(img, json);
    mapCache[key].key = key;
  }
  return mapCache[key];
}
function mapKeys() {
  return JSON.parse(fs.readFileSync(path.join(MAP_DIR, 'rotation.json'), 'utf8'))
    .filter((k) => fs.existsSync(path.join(MAP_DIR, k + '.png')));
}

// player fields that change during play (enumerable ones are copied generically)
const HIDDEN = ['respawnAt', 'portalCooldownUntil', 'tagproTags'];

class Sim extends GameRoom {
  constructor(map, settings = {}) {
    const clock = { t: 0 };
    super({ id: 'sim', map, isPrivate: true, now: () => clock.t,
      settings: Object.assign({ disableAllPups: true, noAfkKick: true, time: 1e9 }, settings) });
    this.clock = clock;
    this.queueT = []; // virtual timers: { at, seq, fn }
    this.seq = 0;
    this.journal = null; // tile writes [x, y, old] while a search is running
    this.state = STATES.ACTIVE;
    this.stateEndsAt = Infinity;
  }

  // no network
  send() {} broadcast() {} broadcastP() {} snapshot() {} afkCheck() {}
  flushDirty() { if (this.dirty) this.dirty.clear(); }
  queue() {}

  later(ms, fn) {
    const h = { at: this.clock.t + ms, seq: this.seq++, fn };
    const q = this.queueT;
    let i = q.length;
    while (i > 0 && (q[i - 1].at > h.at)) i--;
    q.splice(i, 0, h);
    return h;
  }
  setTile(x, y, v, quiet) {
    if (this.journal) this.journal.push([x, y, this.tiles[x][y]]);
    super.setTile(x, y, v, quiet);
  }

  addBall(team = 1) {
    const c = { emit() {}, disconnect() {} };
    this.addClient(c, { publicId: 'b' + this.nextPlayerId, name: 'bot' }, { team });
    return this.players[c.playerId];
  }
  place(p, x, y, vx = 0, vy = 0) {
    p.dead = false;
    p.body.SetActive(true);
    p.body.SetPosition(new V(x, y));
    p.body.SetLinearVelocity(new V(vx, vy));
    p.body.SetAngularVelocity(0);
    p.body.SetAwake(true);
  }

  tickOnce() {
    this.clock.t += 1000 / 60;
    while (this.queueT.length && this.queueT[0].at <= this.clock.t) this.queueT.shift().fn();
    this.step();
  }

  // ---- save / restore ----
  save() {
    const ps = [];
    for (const p of Object.values(this.players)) {
      const b = p.body, pos = b.GetPosition(), v = b.GetLinearVelocity();
      const o = { p, x: pos.x, y: pos.y, a: b.GetAngle(), vx: v.x, vy: v.y, w: b.GetAngularVelocity(),
        active: b.IsActive(), fields: Object.assign({}, p), keys: Object.assign({}, p.keys),
        touching: new Set(p.touching), onPickups: new Set(p.onPickups), portalPending: p.portalPending };
      for (const h of HIDDEN) o[h] = p[h];
      ps.push(o);
    }
    if (!this.journal) this.journal = [];
    return { t: this.clock.t, tick: this.tick, seq: this.seq, q: this.queueT.slice(), ps,
      j: this.journal.length, score: Object.assign({}, this.score), flagHome: Object.assign({}, this.flagHome),
      tileState: Object.assign({}, this.tileState), buttons: copyButtons(this.buttonsHeld) };
  }
  restore(s) {
    while (this.journal.length > s.j) { const [x, y, v] = this.journal.pop(); this.tiles[x][y] = v; }
    this.clock.t = s.t; this.tick = s.tick; this.seq = s.seq; this.queueT = s.q.slice();
    this.score = Object.assign({}, s.score); this.flagHome = Object.assign({}, s.flagHome);
    this.tileState = Object.assign({}, s.tileState); this.buttonsHeld = copyButtons(s.buttons);
    for (const o of s.ps) {
      const p = o.p;
      for (const k of Object.keys(p)) if (!(k in o.fields)) delete p[k];
      Object.assign(p, o.fields); Object.assign(p.keys, o.keys);
      p.touching = new Set(o.touching); p.onPickups = new Set(o.onPickups); p.portalPending = o.portalPending;
      for (const h of HIDDEN) p[h] = o[h];
      const b = p.body;
      b.SetActive(o.active);
      b.SetPositionAndAngle(new V(o.x, o.y), o.a);
      b.SetLinearVelocity(new V(o.vx, o.vy));
      b.SetAngularVelocity(o.w);
      b.SetAwake(true);
    }
  }
  // drop the journal once nothing will rewind past this point
  commit() { this.journal = null; }
}

function copyButtons(b) { const o = {}; for (const k in b) o[k] = new Set(b[k]); return o; }

function setKeys(p, a) {
  const [dx, dy] = ACTIONS[a];
  p.keys.left = dx < 0; p.keys.right = dx > 0; p.keys.up = dy < 0; p.keys.down = dy > 0;
}
const ACTIONS = [[0, 0], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

module.exports = { Sim, getMap, mapKeys, setKeys, ACTIONS, PH };
