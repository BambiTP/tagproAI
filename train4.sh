#!/bin/bash
# train4.sh - the fourth training round, end to end (runs as a systemd user unit, so it outlives any session):
# record ~2,100 puzzles with the best-of-four planning bot (gen2.js), train network run 4 on those plus the
# human runs, then test it. Results land in runs/train/ and show on the Learning tab.
set -e
cd "$(dirname "$0")"
T=runs/train
for s in 40000 50000 60000; do node gen2.js $s 700 $T/b$s.bin > $T/b$s.log 2>&1 & done
wait
TRAIN_FILES=b,h node train.js 15 $T/net-run4.json > $T/train4.out 2>&1
NET=$T/net-run4.json node speed.js net 101 40 > $T/eval/net-run4.jsonl
SEEDS=$(node -e "console.log(require('./$T/boost-test.json').join(','))") NET=$T/net-run4.json node speed.js net > $T/eval-boost/net-run4.jsonl
NET=$T/net-run4.json node speed.js guided 101 40 > $T/eval/guided-run4.jsonl
# how good the teacher itself is on the test puzzles (best of the four planning bots)
node gen2.js 101 40 /tmp/teacher-test.bin > $T/eval-teacher.log 2>&1
echo done > $T/train4.done
