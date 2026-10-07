#!/bin/bash
# round6.sh - a DAgger round (runs as a systemd user unit): network run 5 drives new boost puzzles, the
# best-of-four teacher corrects it at the places it reached (dagger.js), then network run 6 trains on all
# the boost-aware lessons plus the corrections (counted 5 times) and gets tested like the earlier rounds.
set -e
cd "$(dirname "$0")"
T=runs/train
for s in 70100 70300 70500; do node dagger.js $T/net-run5.json $s 200 $T/dg$s.bin > $T/dg$s.log 2>&1 & done
wait
rm -f $T/v-dagger.bin
for i in 1 2 3 4 5; do cat $T/dg70100.bin $T/dg70300.bin $T/dg70500.bin >> $T/v-dagger.bin; done
FEAT=2 TRAIN_FILES=v node train.js 15 $T/net-run6.json > $T/train6.out 2>&1
NET=$T/net-run6.json node speed.js net 101 40 > $T/eval/net-run6.jsonl
SEEDS=$(node -e "console.log(require('./$T/boost-test.json').join(','))") NET=$T/net-run6.json node speed.js net > $T/eval-boost/net-run6.jsonl
NET=$T/net-run6.json node speed.js guided 101 40 > $T/eval/guided-run6.jsonl
echo done > $T/round6.done
