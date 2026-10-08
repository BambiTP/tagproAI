#!/bin/bash
# chase round 3: two against two, every chasing plan against every carrying plan on every 38th puzzle
cd /home/metjr/tagproAI
ls chase/scenarios | sed 's/.json$//' | sort | awk 'NR%38==0' > chase/results/round3-ids.txt
split -n l/3 -d chase/results/round3-ids.txt chase/results/ids3-
for a in both guard; do for b in alone block; do
  for i in 0 1 2; do IDS=$(paste -sd, chase/results/ids3-0$i) TAG=-$i node chase/team.js $a $b 0 99999 & done; wait
  cat chase/results/team-$a-$b-[012].jsonl > chase/results/team-$a-$b.jsonl && rm chase/results/team-$a-$b-[012].jsonl
done; done
node chase/teamsummary.js > chase/results/team-summary.txt
