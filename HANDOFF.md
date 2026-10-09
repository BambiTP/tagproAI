# Handoff: tagproAI bot work (state on 2026-10-09)

Read this, then `PROJECT.md` (full project notes, the "Chasing" section has every result). Memory files in
`~/.claude/projects/-home-metjr/memory/` also apply (game primer, feedback rules).

## How the user wants to work (important, learned the hard way)
- **Short, plain explanations.** No walls of text, no pseudocode unless asked. Explain like to a third party.
- **Confirm the plan in a few lines before a big build.** But when the user says go, just do it.
- **Use your own judgement and evidence.** The user's TagPro ideas are hypotheses, not instructions (they said so).
  Their factual game descriptions and their terms are fine to use.
- **Offline only.** Never put bots on tagpro-local, never start tagpro-local servers. No human players exist.
- **Don't misread intent.** When a request is ambiguous or contradicts an earlier one, ask in one line.
  (Example: "draw is a win for chaser" really meant holder; "kill area map" meant *training maps built around
  kill zones*, not a heat map.)
- **No expected-caps model** in bot training.
- Never test on the live arena data; use a separate copy (see PROJECT.md).

## The user's terms
- **Kill points:** a flat stretch of wall running straight into an inward bump (corner). A chaser doesn't need to
  contain there, it lets the carrier run into the wall. Forward = towards the carrier's own flag (it wants to go
  there), backward = only while retreating. Found by `chase/pinches.js` -> `chase/pinches.json` (`lanes`, with `fwd`
  per team). The user liked the latest version ("looks pretty good", may still miss a few).
- **Safety nets:** choke points (pinches); chasers fall back to the next one when they can't contain.
- **Hold to kill / solo:** a chaser only commits when holding one key (straight or diagonal) is a certain kill.
  `chase/killtest.js sure()` is the certain test (carrier may move any way; includes the 200 ms the chaser can't
  see). 235/235 held kills returned in tests.
- **Holder:** the flag carrier.

## What was being built when this session ended (the user's current request)
League neural-network training of **1 carrier vs 2 chasers on maps built around kill zones**, with proper contain
starts. Rewards: **chasers win only with a return; an escape or lasting 8 s is a win for the holder.**
- `league/killenv.js` (new, uncommitted, working): games on the full real map at a forward kill point. Carrier on
  the lane running into the bump; guard chaser on the open side; pressing chaser behind. Escape = by route home
  (its flag / end zone) it is GAP seconds sooner than both chasers. Spikes pop = return. 1,868 starts. Random play:
  ~58 ms per game, 30% return / 22% draw / 48% escape. **Check the starts look right before training** (the user was
  unhappy with the previous setup); show them a few starts.
- `league/league.js` currently uses the open-floor `league/env.js`. Next step: switch it to `KillGame` (same interface:
  reset, view, step, holding, hist, ca, ch, keyToWorld; VIEW is 24 there, not 23). The hand-made baselines in
  league.js use `g.goal` (straight line); for KillGame they should steer along `g.homeDir()`.
- Then: retrain from scratch (`rm -rf league/state`), run as `systemd-run --user --unit tagproai-league ...`.
- Make the private page's "Hold vs league" tab (watch.html `loadLeague`, watch.js `/league`) play on KillGame starts
  so the user can test as the holder. It currently uses the open-floor env, which the user called terrible.
- The old open-floor league is saved in `league/state-openfloor/` (don't build on it).

## Running in the background
- `tagproai-chase22`: the flag-home rerun of the 2v2 comparisons (`chase/round22.sh`, resumable). Done so far:
  plain vs plain 61.9% returned; rollout blocker 61.6% (its earlier gain does NOT hold on flag-home puzzles); lead
  chasers 66.3%. Running: both-rollout2, then lead-rollout2.
- `tagproai-chase23` (queued, waits for 22): containing chasers (`team.js contain`) on the same puzzles.
- Compare with `node chase/compare.js h <plan>` (e.g. `BASE=lead-rollout2 node chase/compare.js h contain-rollout2`).
- Services: tagproai-server (private page :8090 + arena), tagproai-tunnel, tagproai-files (:8091, recordings/).
  Restart tagproai-server after editing watch.js / arena.js.

## Key results so far (details in PROJECT.md)
- 60% of the old chase puzzles had the carrier's own flag taken; use flag-home puzzles (`chase/results/home-ids.txt`).
- Certain-kill grid (`chase/killtest.js grid`, results/killgrid-*.csv): fast check trustworthy beyond 0.45 m.
- Rollout carrier (`rollout2`) was the big 2v2 win on old puzzles (21% vs 72% returned; 52% vs 71% against lead
  chasers); being rechecked on flag-home puzzles now.
- Blocking: only the leverage blocker and the rollout blocker ever helped, and the rollout blocker's gain vanished on
  flag-home puzzles.

## Private page tabs (http://100.106.58.111:8090)
Play, Watch bots, Chase me (you carry vs browser chasers), Hold vs league, Chases (duel/2v2 replays),
Kill points (kill points + safety nets per map, team switch), Graphs, Learning. Upload page: `/upload` (pasted
pictures land in `runs/uploads/`).
