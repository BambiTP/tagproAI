#!/bin/bash
# release-better.sh - wait for a training round to finish, then put its network on the site if it beats the
# released one on the 39 test puzzles (speed to the target, and it must finish at least as many puzzles).
#   release-better.sh <round done file> <new net> <new eval> <current eval>
cd "$(dirname "$0")"
while [ ! -f "$1" ]; do sleep 60; done
node -e "
const fs=require('fs');const T={};for(let s=101;s<=140;s++){const f='runs/touch/bots/'+s+'.json';if(fs.existsSync(f))T[s]=require('./'+f).pathTiles}
const L=f=>fs.readFileSync(f,'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.seed);
const score=f=>{const r=L(f).filter(r=>r.result==='arrived'&&T[r.seed]);return {n:r.length,v:r.reduce((a,x)=>a+T[x.seed]/(x.ticks/60),0)/r.length}};
const a=score('$3'),b=score('$4');
console.log('new',a,'released',b);
if(a.n>=b.n&&a.v>b.v){fs.copyFileSync('$2','runs/train/net-release.json');console.log('released the new network')}else console.log('kept the released network');"
