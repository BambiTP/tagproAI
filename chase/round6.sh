#!/bin/bash
# chase round 6: the smart blocker against both chasing plans, on round 3's puzzles
cd /home/metjr/tagproAI
for a in both guard; do b=smart
  for i in 0 1 2; do IDS=$(paste -sd, chase/results/ids3-0$i) TAG=-$i node chase/team.js $a $b 0 99999 & done; wait
  cat chase/results/team-$a-$b-[012].jsonl > chase/results/team-$a-$b.jsonl && rm chase/results/team-$a-$b-[012].jsonl
done
node chase/teamsummary.js > chase/results/team-summary.txt
