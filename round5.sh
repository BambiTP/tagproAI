#!/bin/bash
# round5.sh - network run 5 on the boost-aware view (runs as a systemd user unit): rebuild every recorded
# run with the new view (refeat.js: gen.js runs once, gen2.js best-of-four runs twice), the human runs
# (humangen.js), train, then test like the earlier rounds.
set -e
cd "$(dirname "$0")"
T=runs/train
for f in d10000 d20000 d30000; do node refeat.js $T/$f.bin $T/v-$f.bin 1 >> $T/round5.log 2>&1 & done
for f in b40000 b50000 b60000; do node refeat.js $T/$f.bin $T/v-$f.bin 2 >> $T/round5.log 2>&1 & done
FEAT=2 node humangen.js $T/v-h-human.bin >> $T/round5.log 2>&1 &
wait
FEAT=2 TRAIN_FILES=v node train.js 15 $T/net-run5.json > $T/train5.out 2>&1
NET=$T/net-run5.json node speed.js net 101 40 > $T/eval/net-run5.jsonl
SEEDS=$(node -e "console.log(require('./$T/boost-test.json').join(','))") NET=$T/net-run5.json node speed.js net > $T/eval-boost/net-run5.jsonl
NET=$T/net-run5.json node speed.js guided 101 40 > $T/eval/guided-run5.jsonl
echo done > $T/round5.done
