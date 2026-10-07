// tunnel.js - put the puzzle server (arena.js on 127.0.0.1:8092) on the internet through a free Cloudflare
// quick tunnel, and publish the tunnel's address in a GitHub gist that the Pages site reads. Quick tunnels
// get a new address each time, so this restarts cloudflared if it stops and republishes the address.
//   node tunnel.js [gist id]        (needs cloudflared on the PATH and `gh` logged in)
const { spawn, execFileSync } = require('child_process');

const GIST = process.argv[2] || 'e2b72b926dbfd6ef13490cd7b00902fe', FILE = 'tagpro-puzzles.json';
const ORIGIN = 'http://127.0.0.1:' + (process.env.ARENA_PORT || 8092);
const log = (...a) => console.log(new Date().toISOString(), ...a);

function publish(url) {
  const body = JSON.stringify({ files: { [FILE]: { content: JSON.stringify({ url, at: new Date().toISOString() }) } } });
  execFileSync('gh', ['api', '-X', 'PATCH', 'gists/' + GIST, '--input', '-'], { input: body, stdio: ['pipe', 'ignore', 'inherit'] });
  log('published', url);
}

// new quick tunnels can take half a minute to answer; wait for the server's health check through it
async function waitUntilUp(url) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(url + '/api/health'); if (r.ok) return true; } catch (e) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

let backoff = 5000;
function run() {
  const cf = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', ORIGIN], { stdio: ['ignore', 'ignore', 'pipe'] });
  let found = false;
  cf.stderr.on('data', async (d) => {
    const m = !found && /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d));
    if (!m) return;
    found = true;
    log('tunnel', m[0], 'waiting for it to answer');
    if (await waitUntilUp(m[0])) { publish(m[0]); backoff = 5000; } else { log('tunnel never answered; restarting'); cf.kill(); }
  });
  cf.on('exit', (code) => {
    log('cloudflared stopped (' + code + '), restarting in', backoff / 1000, 's');
    setTimeout(run, backoff); backoff = Math.min(backoff * 2, 5 * 60e3);
  });
}
run();
