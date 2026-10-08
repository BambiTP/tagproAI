#!/bin/bash
# chase round 1: pursue and lead on every 6th puzzle, 3 processes at a time, then the summary
cd /home/metjr/tagproAI
ls chase/scenarios | sed 's/.json$//' | sort | awk 'NR%6==0' > chase/results/round1-ids.txt
split -n l/3 -d chase/results/round1-ids.txt chase/results/ids-
for v in pursue lead; do
  for i in 0 1 2; do IDS=$(paste -sd, chase/results/ids-0$i) TAG=-$i node chase/run.js $v 0 99999 & done; wait
  cat chase/results/$v-[012].jsonl > chase/results/$v.jsonl && rm chase/results/$v-[012].jsonl
done
node chase/summary.js pursue lead > chase/results/summary.txt
