#!/bin/bash
# chase round 2: duels, every chaser against every carrier on every 19th puzzle (after round 1 finishes)
cd /home/metjr/tagproAI
while [ ! -s chase/results/summary.txt ]; do sleep 60; done
ls chase/scenarios | sed 's/.json$//' | sort | awk 'NR%19==0' > chase/results/round2-ids.txt
split -n l/3 -d chase/results/round2-ids.txt chase/results/ids2-
for c in pursue intercept mixed; do for r in run escape; do
  for i in 0 1 2; do IDS=$(paste -sd, chase/results/ids2-0$i) TAG=-$i node chase/duel.js $c $r 0 99999 & done; wait
  cat chase/results/duel-$c-$r-[012].jsonl > chase/results/duel-$c-$r.jsonl && rm chase/results/duel-$c-$r-[012].jsonl
done; done
node chase/duelsummary.js > chase/results/duel-summary.txt
