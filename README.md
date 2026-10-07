# tagpro-ai

A TagPro bot built on search in the real engine instead of model-free RL.
Milestone 1: get a ball to a point and stop there (within 12 px, under 0.25 m/s), on real maps.

## Run

```bash
npm install
npm test                      # determinism, restore fidelity, speed
node eval.js search 20 101    # 20 held-out tasks; or: baseline
node summarize.js <output.json>
```

## How it works

- `sim.js` runs tagpro-local's `engine/` (copied unchanged) headless: a virtual clock and virtual
  timers, no network, and `save()` / `restore()` of the whole mutable game state (ball bodies,
  player fields, tiles through a write journal, timers, buttons).
- `nav.js`:
  - the task generator (random real map, start and goal 4–30 tiles apart by path, random start velocity);
  - a time-to-go estimate: exact per-tick 1-D dynamics per axis in open floor, path distance along a
    tile field otherwise;
  - a hand-written baseline (per-axis steer and brake towards a waypoint);
  - the search controller. Every 4 ticks it runs a beam search in the engine: 9 key directions per
    node, depth 6 (0.4 s), width 16, ranked by ticks used + estimated ticks to go. It keeps the best
    line for every first move, and drops any state that pops on the next tick.
- `eval.js` runs fixed tasks: `node eval.js search 20 101`, then `node summarize.js <file>`.
- `test-sim.js` checks determinism, restore fidelity and speed.

## Results so far (40 held-out tasks, seeds 101–140)

| | arrived | pops | timeouts | mean time (35 tasks both solved) |
|---|---|---|---|---|
| search | 39 | 0 | 1 | 4.18 s |
| baseline | 35 | 2 | 3 | 5.12 s |

Engine checks: identical runs from the same inputs; restoring mid-wall-contact is off by at most
0.012 px over 3,000 snapshots; about 75k ticks/s for one ball on one core.

## Known limits

- The time-to-go estimate has dead spots near walls (task 124, and task 7 in the dev set): every
  0.4 s lookahead looks worse than waiting, so the ball sits still. This is the job of the learned
  value function in the next step.
- Search is slower than real time on 2 cores (about 1x real time). Fine for generating training data,
  not for playing.

## Next

Expert iteration: record (state, chosen move, actual time to arrive) from search, train a small
policy/value network on it, then use that value as the search's leaf estimate instead of the
hand-built one. Repeat.
