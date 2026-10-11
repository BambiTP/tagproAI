# TagPro chase bots

**Play it here: https://bambitp.github.io/tagproAI/**

Red chasers try to tag a blue runner. Every ball moves with TagPro's exact physics (same
acceleration, top speed, friction and wall bounces as the real game). Every game is on a brand
new random map, sometimes with islands in the middle. You can watch, or take over the runner or a
chaser with the arrow keys.

The whole thing is one file, `index.html`. Open it in a browser and it runs; there is nothing to
install.

The earlier contents of this repository are saved on the
[`archive-2026-10-11`](https://github.com/BambiTP/tagproAI/tree/archive-2026-10-11) branch.

## How the bots think

### 1. Time, not distance

In TagPro a ball can't turn on the spot. It speeds up slowly, about 1.7 seconds from standing
still to full speed, and to change direction it first has to slow down. So "how far away is it?"
is the wrong question. The bots ask **"how many ticks would it take me to get there, from the way
I'm moving right now?"** They work this out for every tile on the map, going around walls.

This comes from research on pursuit with momentum (the "damped double integrator" papers), where
each player's reach is drawn as rings of equal arrival time instead of equal distance.

### 2. Who gets where first

For every tile, the bots compare the runner's arrival time with the chasers'. The tiles the
runner reaches first are its **territory**, shaded blue on the page; the chasers' tiles are red.
The runner wants to keep its territory big. The chasers want to shrink it to nothing, and once
the blue is gone the runner is trapped. This is the "dominance region" (Voronoi) idea from the
pursuit papers.

### 3. Behaviours: "when I see this, I do that"

Each bot has a short list of behaviours. Each one has a **trigger** (a situation it looks for)
and an **action**. Every 3 ticks (20 times a second), each bot runs the most important behaviour whose trigger is true. The side panel shows which one
each bot is using right now.

**Runner**

| Behaviour | When | What it does |
|---|---|---|
| Dodge | a chaser is about to reach it | tries every key combo half a second into the future and picks the one that gets away |
| Run for open space | otherwise | heads for open floor it reaches first, away from walls and dead ends, keeping its speed up |
| Loop the island | an island is close and a chaser is near | circles the island, keeping it between itself and the chaser |
| Run away | fallback | runs from the nearest chaser |

**Chasers**

| Behaviour | When | What it does |
|---|---|---|
| Guard quadrants together | both chasers are close | splits the map into four quadrants around the runner; each chaser guards one of the two the runner most wants to escape into |
| Shadow, don't lunge | close, and the runner still has a way out | stays just off the runner on the side it wants to go, matching its speed. A lunge that misses carries you past the runner and lets it through, so it only goes for the tag once the runner has no dodge left |
| Cut off | the runner is far away | works out where the runner wants to go and gets to that route first |
| Wait on the escape route | the other chaser is pressing | stands where the runner will run to get away from the teammate |
| Trap the loop | the runner is circling an island | goes round the other way |
| Go for the tag | otherwise | aims at where the runner is heading, not where it is |

The chasers' speed control (how close to sit, and how much faster than the runner to close in)
was tuned by an evolution search over thousands of games. It learned to close in at no more than
about 1 m/s faster than the runner. Faster than that, the chaser overshoots and the runner gets
past it.

## How good are they

Measured over 40 games of each kind, bot against bot, 30 seconds per game:

| Game | Runner tagged | Average time to tag | Runner got past a chaser |
|---|---|---|---|
| 2 chasers vs 1 runner | 100% | 8.1 s | 0.33 times a game |
| 1 chaser vs 1 runner | 98% | 11.6 s | 0.33 times a game |

Things to keep in mind:

- These are bots against bots. The runner bot is the weaker side, so these numbers say more
  about how the chasers do against *this* runner than against a good human. Try playing the
  runner yourself.
- 40 games is a small sample: a difference of a few games is noise.
- No boosts, bombs, spikes or powerups: just balls, walls and tags.
- **Islands only help the runner when they are big.** At full speed a ball needs a loop roughly
  8 to 10 tiles across to turn around without slowing down. Small islands just get in the way;
  big ones give the runner a loop to circle.

## Research it draws on

- Casini & Garulli (2022), *A two-pursuer one-evader game with equal speed and finite capture
  radius*: with equal speed, a tag is only possible from some positions.
- Zhou et al., *Cooperative pursuit with Voronoi partitions* and *"Smarter Lions"*: two equal-speed
  chasers can always catch a runner on a map with no holes; with obstacles it takes three.
- Shishika & Kumar (2019), *Perimeter-defense game on arbitrary convex shapes*: two defenders
  pinching an attacker that neither could stop alone.
- Damped double-integrator pursuit (Li, Wang & Xie 2024; arXiv 2505.11951): pursuit with
  momentum, measured in arrival time.
- Llanes et al. (Georgia Tech, 2026): learned runners lure chasers into bumping into each other,
  which is why the chasers spread out.
- TagPro defence advice: contain rather than lunge, and only commit when the tag is certain.

## Built from

[chase-playground](https://github.com/BambiTP/chase-playground): a small engine with TagPro's
movement physics (taken from tagpro-local's server, same Box2D build, checked tick by tick) and the
BuildAMapWorkshop map generator.
