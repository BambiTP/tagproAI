# TagPro AI: project notes

Everything needed to understand, run and continue this project. Written so someone new (or a fresh assistant
session) can pick it up without any other context. Last updated 2026-10-08.

---

## 1. What this is

A TagPro bot project built on the real game engine, plus two websites around it:

1. **Bots that drive a TagPro ball.** They run headless on tagpro-local's engine (`engine/`, copied unchanged
   from the tagpro-local repo), which reproduces real TagPro physics closely enough to replay real games.
2. **A private viewer** (served on the owner's Tailscale address, port 8090): play puzzles, watch every bot,
   graphs, and a Learning tab with training graphs and written notes.
3. **A public puzzle site** (GitHub Pages at `https://bambitp.github.io/tagproAI/`, backend through a
   Cloudflare quick tunnel): accounts, puzzles in four difficulty modes, medals, world records, a bot viewer,
   and a tab where players label what people are doing in real ranked replays.

The current skill is **"touch the target"**: start somewhere on a real map with a starting velocity, and touch a
target point as fast as possible (any speed). That is flag grabbing / powerup collecting in miniature. An older
"arrive and stop" version (stop within 12 px under 0.25 m/s) also exists in `nav.js` but humans found precise
stopping unrealistic and it is not used any more.

---

## 2. The physics facts that matter

- Engine units: metres. One tile = 0.4 m (40 px). Tile `i` has its centre at `i * 0.4` m.
- 60 ticks a second. Keys: 9 actions (none + 8 directions), `ACTIONS` in `sim.js`.
- Acceleration 0.025 m/s per tick (1.5 m/s²); top speed 2.5 m/s (6.25 tiles/s); drag `v *= 1 - 0.5/60` per tick.
  Keys cannot push you past top speed but don't cap speed either.
- Braking from full speed takes ~3.4 tiles and ~1.2 s.
- Ball radius 0.19 m. "Touched the target" = ball centre within 0.19 m of the goal point.
- **Boosts** set your velocity to 7.5 m/s (3× top speed; up to 10.6 on a diagonal) in the direction you are
  already moving, and drag barely slows it, so a boosted ball covers ground ~3× faster for a long way.
  A used boost becomes tile `5.1` (or `14.1`/`15.1`) until it respawns (~10 s). Red ball can use 5 and 14.
- **Gravity wells** (tile 22) out-pull your keys almost everywhere in their 2.6 m range (pull per tick is
  0.06/distance m/s; keys give 0.025). Puzzles starting or ending in a well's range are skipped
  (only puzzle 124 among 101-400). Map 96054 "Wamble NFC" is an event version with two wells; the regular
  map has none.
- Replay files (ranked, `~/nte/data/replays/xx/yy/<uuid>.ndjson.gz`): positions `rx, ry` are metres, so
  `rx / 0.4` is the tile index; updates every ~40 ms; `mapType` "nf" games are neutral-flag (skipped).

---

## 3. Puzzles

`nav.makeTask(seed, keys)` builds puzzle `seed` deterministically: a random map from `maps/rotation.json`,
a random plain-floor goal, a start 4-30 tiles away along the route, and a random starting velocity.
Touch puzzles set `task.touch = true`. Test puzzles are **101-140** (124 skipped). Training puzzles use seeds
10000+ (gen.js), 40000+ (gen2.js), 70000+ (dagger.js) so they never overlap the test set or what people play.

---

## 4. The bots

| Bot | Where | How it decides |
|---|---|---|
| Simple bot | `nav.baseline` | Steers its velocity at the next point on the shortest route (touch mode) |
| Planning bot | `nav.makeSearch` | Beam search in the real engine: 9 keys per step, width 16, depth 8 (0.53 s ahead), ranked by ticks used + estimated ticks to go. Depth 8 because 6 let a boost throw it onto a spike |
| Fast planning bot | `fastsearch.makeSearch2({prune:true})` with `keep: 2` | Same search but only tries keys near the previous one, and carries out 2 moves per plan. ~4× less thinking, ~2.5% slower routes |
| Live planning bot | `speed.js` version `live` | Fast bot on 3 threads (`fastsearch.Pool`, workers kept in lockstep) with a 110 ms time limit: 0.36 s of thinking per game second, slowest decision 121 ms (allowance 133). Fast enough to play live, one ball |
| Boost-aware planning | `makeSearch2({boosts: {setup, keep}})` | Route estimate treats live boosts as shortcuts (`nav.boostField`). No single setting is best everywhere |
| Best-of-four ("teacher") | `gen2.js` | Plays each puzzle without boosts and with three boost settings (0.3/0.85, 0.8/0.85, 1.5/0.7) and keeps the fastest. As fast as a strong human on the test puzzles |
| Network | `net.js` + a trained `net-runN.json` | A small neural network (two layers of 128) picks the move directly: ~0.01 s thinking per game second |
| Network-guided search | `makeSearch2({est})` | The search using the network's time-left guess instead of the hand formula |

### The route estimate (`nav.js`)
`field(tiles, gx, gy)` is a Dijkstra map of route distance to the goal (tiles next to spikes and lethal gates
cost extra). `heuristicTouch` turns distance + velocity into estimated ticks with exact per-tick dynamics.
`boostField(task, tiles, team, {setup, keep})` adds boost shortcuts: from each live boost, 16 launch lines;
every tile along a line (up to a wall, stopping short of spikes) is reachable at `distance × 2.5/(keep × v)`
plus `setup`; recomputed when a boost is used.

### What the network sees (`features.js`)
- Version 1 (`features`, 417 numbers): a 9×9 tile window around the ball with channels wall, spike, boost,
  other hazard, route distance; plus velocity, position inside the tile, direction and distance to the goal,
  route direction, route distance, the hand-written time estimate, and whether the goal is in sight.
- Version 2 (`features2`, 502 numbers, network run 5 on): adds a boost-aware route-distance channel, marks
  only live boosts, and adds boost-aware route direction, distance and time estimate. Needs the live tiles:
  set `net.tiles = sim.tiles`.

### Training (`train.js`)
Pure JavaScript (this machine has no GPU and an old CPU, so no PyTorch). One network, two outputs: the move
(9-way) and seconds left, learned as a **correction to the hand-written estimate** (so it starts as good as it).
Huber loss on time left, 8 mirror/rotation copies of every lesson, weight decay, keeps the best pass on
held-out puzzles (seeds ending in 0). `FEAT=2` for the version-2 view, `TRAIN_FILES=v,b,...` to choose files.

---

## 5. Results so far

Speed to the target = shortest-route length ÷ time, in tiles per second, on the 39 test puzzles.
Boost test = 19 puzzles where a human beat every bot (seeds in `runs/train/boost-test.json`), held out of all training.

| | Test puzzles | Notes |
|---|---|---|
| Simple bot | 4.22 (37/39) | |
| Planning bot | 4.80 | the original search |
| Fast planning bot | 4.68 | |
| Best-of-four teacher | 4.92 | human best times average 4.91 |
| Network run 1 (2k puzzles) | 3.73 (37/39) | |
| Network run 2 (2.3k, loss fixes, mirrors) | 4.35 | first to beat the hand formula at time left |
| Network run 3 (8.9k + 128 human runs) | 4.25 | boost test 14% faster than run 2, but used boosts on 5/19 (humans 16/19) |
| Network run 4 (2k best-of-four puzzles) | 3.77 (38/39) | worse: boost-blind view, small and mixed data |
| **Network run 5 (11k, boost-aware view)** | **4.30** | **released**; boosts on 6/19 |
| Network run 6 (DAgger, ~5,900 corrections) | 4.24 | not released; boosts on 5/19 |

Guided search never beat the hand formula (best: run 3 at 4.55 vs 4.68).

### Lessons learned
- Learning time left as a correction with an average-error-like loss, plus mirror copies, fixed memorising.
- Copying a teacher does **not** teach multi-move setups like lining up a boost: the network decides one move
  at a time, and once slightly off it is somewhere the teacher never showed it. More data, a boost-aware view
  (run 5) and correcting its own mistakes (DAgger, run 6) all gave little.
- Boost-aware search finds real boost routes (beats the human time on several puzzles) but no single setting
  is reliable; best-of-several is a good teacher.
- **Decision (stopping rule met after run 6): stop working on pure movement.**

---

## 6. Files

| File | Purpose |
|---|---|
| `sim.js` | Engine wrapper: virtual clock, save/restore of the whole game state |
| `nav.js` | Puzzles, route fields, estimates, simple bot, planning search, boost fields |
| `fastsearch.js` | Faster search (prune, keep, time limit, boosts, custom estimate) and the multi-thread `Pool` |
| `features.js` | What the network sees (versions 1 and 2) |
| `net.js` | Runs a trained network |
| `train.js` | Trains a network |
| `gen.js` / `gen2.js` / `humangen.js` / `dagger.js` / `refeat.js` | Make training lessons: planning bot / best-of-four / human runs / DAgger corrections / rebuild with view version 2 |
| `speed.js` | Tests a bot version on the test puzzles (`SEEDS=` for a list), writes JSON lines |
| `train4.sh`, `round5.sh`, `round6.sh` | Whole training rounds, run as systemd units |
| `release-better.sh` | Waits for a round, releases its network if it beats the current one |
| `watch.js` / `watch.html` | Private server + page (Play, Watch bots, Graphs, Learning); also starts the public server |
| `arena.js` | Public puzzle server (API on 127.0.0.1:8092) |
| `tunnel.js` | Cloudflare quick tunnel to the public server; publishes its address to a gist |
| `docs/template.html` + `build-pages.js` | The Pages site; `node build-pages.js` builds `docs/index.html` (shares drawing code with `watch.html`) |
| `labels/extract.js` | Turns ranked replays into labelled clips |
| `note.js` | Adds a written note to the Learning tab |
| `eval.js`, `summarize.js`, `test-sim.js` | The original stop-puzzle tests (`npm test`) |

Data (all in `runs/`, `labels/clips/`, git-ignored): `runs/touch/bots/<seed>.json` (bot runs per puzzle),
`runs/touch/extra/` (fast/network/guided runs), `runs/touch/human.json` (private-page player data),
`runs/train/` (recordings `*.bin`, logs, `net-runN.json`, `net-release.json`, evals, `notes.json`),
`runs/arena/` (public site: users, tries, best runs, labels).

---

## 7. Running it

Three systemd **user** services (linger is on, so they start at boot without a login):

| Service | Runs |
|---|---|
| `tagproai-server` | `node watch.js <tailscale-address>`: private page on :8090, public API on 127.0.0.1:8092, bot workers |
| `tagproai-tunnel` | `node tunnel.js`: quick tunnel to :8092, restarts cloudflared and republishes the address |
| `tagproai-files` | `python3 -m http.server 8091` on `recordings/` (downloads: GIFs, logos) |

Useful: `systemctl --user restart tagproai-server` after changing `watch.js`/`arena.js`;
`journalctl --user -u tagproai-tunnel`. Training rounds run as transient units (`systemd-run --user ...`).

The public page finds the backend by: last working address (browser storage) → GitHub gist API (60 calls an
hour per connection) → the gist's raw file. Gist id: `e2b72b926dbfd6ef13490cd7b00902fe`.

**Testing the public server:** never test on live data. Run a separate copy on port 8093 with its own data
folder (a small harness that calls `require('./arena')(ctx)` with `dir:` pointing elsewhere). Env vars:
`ARENA_ADMINS`, `ARENA_IP_LIMIT`, `ARENA_REG_LIMIT`, `ARENA_DEV`. Stop test servers with
`pgrep -f "^node ..."` so the kill doesn't match its own shell.

---

## 8. The public site (arena.js + docs/)

- Accounts (scrypt passwords, 30-day tokens, prototype-free stores, rate limits). Admin = account `bambi`.
- Every try is started on the server first; runs are verified by replaying the keys in the engine.
- **Modes**: easy/medium/hard/expert by how hard the *best time* is: the gap between plain steering and
  planning, overridden once 3 players finish (median distance from the record), and pushed up when a person
  beats every bot by 4% (hard) or 8% (expert). Plus ★ Starred and a picked puzzle.
- Retry for a better time; after a finish, 2.5 s to press R before moving on. Back/Skip, star, pause (P),
  auto-pause after 3 s without keys.
- Medals: blue = holds the WR (fastest player time, ties count, replaces the other medal), gold = beat the
  planning bot, silver = within 10%, bronze = finished. Click medals for times against the WR.
- Ghosts: every bot + your best + the WR holder's run.
- Rating: chess-style against puzzles; each try after the first costs 2%; resetting before pressing a key is free.
- R-spam flags: 10+ key-less restarts over 15+ s, or 20 of the last 30 restarts under a third of the puzzle's
  typical restart time (from 3+ other players). Flagged players are left out of stats/records until reviewed.
- "Watch the bots" works without a login (`/api/watch`).
- **Label replays**: 7,200 clips from 300 ranked games; the real TagPro client (served from tagpro-local's
  folder, classic textures) jumps to the moment, follows the ringed player and pauses; players confirm or
  correct the rules' label. Admin tab shows agreement per rule. Publishing whole ranked replays this way was
  the owner's choice.

---

## 9. Replay labels (the start of real-game understanding)

`labels/extract.js` rebuilds each ranked capture-the-flag game 10 times a second and labels every player with
rules: carrying (with "past N"), regrab, anti regrab, chasing, OD, escort, home defence, grab attempt,
pup fight, moving. Distances are route distances. Time shares in a sample: moving 28%, carrying 16%,
home defence 15%, chasing 11%, OD 10%, grab attempt 8%, pup fight 4%, escort 4%, anti regrab 2%, regrab 1.5%.
TagPro terms follow the owner's game primer (kept outside this repo).

---

## 10. Future plans

1. **Replay labels:** collect answers, fix the rules people disagree with, then train a classifier (decision
   trees, readable) on the answers plus the rule labels; extract all ~20,000 ranked replays.
2. **Moving targets:** chase a target that moves (like a flag carrier), the first step toward opponents.
3. **1-vs-1 chase and escape:** start both sides by copying high-rated players from the replays, then improve
   with a small league (chasers and runners playing each other). Full 4v4 league training is beyond this machine.
4. **Strategy layer:** a decision tree or small network picks what to do (from the label menu); the movement
   network or planning search carries it out.
5. Smaller items: real joined walls in the drawn clip view (the client's wall code is understood: `S()` picks a
   quarter-piece per corner, 232 pieces in the tile table); add run 5 to more views; more puzzles ahead of players.
