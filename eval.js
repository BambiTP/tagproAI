// eval.js - run fixed A->B tasks with a controller and report.
//   node eval.js <baseline|search> [n=40] [first=1] [width] [depth]
const N = require('./nav');

function episode(task, ctl) {
  const sim = new N.Sim(require('./sim').getMap(task.key));
  const p = sim.addBall(1);
  sim.place(p, task.start.x, task.start.y, task.start.vx, task.start.vy);
  let a = 0;
  for (let t = 0; t < N.MAX_TICKS; t++) {
    if (t % N.K === 0) {
      const q = p.body.GetPosition(), v = p.body.GetLinearVelocity();
      sim.commit();
      a = ctl.name === 'search' ? ctl(task, sim, p) : ctl(task, q.x, q.y, v.x, v.y);
    }
    N.setKeys(p, a);
    sim.tickOnce();
    if (p.dead) return { result: 'pop', ticks: t + 1 };
    const q = p.body.GetPosition(), v = p.body.GetLinearVelocity();
    if (N.arrived(task.goal, q.x, q.y, v.x, v.y)) return { result: 'ok', ticks: t + 1 };
  }
  return { result: 'timeout', ticks: N.MAX_TICKS };
}

if (require.main === module) {
  const [which = 'baseline', n = '40', first = '1', width = '16', depth = '6'] = process.argv.slice(2);
  const keys = N.mapKeys();
  const ctl = which === 'search' ? N.makeSearch({ width: +width, depth: +depth }) : N.baseline;
  const out = [];
  const t0 = Date.now();
  for (let i = +first; i < +first + +n; i++) {
    const task = N.makeTask(i, keys);
    const r = episode(task, ctl);
    const est = N.heuristic(task.F, task.goal, task.start.x, task.start.y, task.start.vx, task.start.vy);
    out.push({ i, map: task.key, est, ...r });
  }
  console.log(JSON.stringify({ which, width: +width, depth: +depth, secs: (Date.now() - t0) / 1000, out }));
}
module.exports = { episode };
