// build-pages.js - assemble the GitHub Pages site in docs/ from docs/template.html, the engine and the
// drawing code shared with watch.html.   node build-pages.js <gist id>
const fs = require('fs'), path = require('path');
const gist = process.argv[2] || (fs.existsSync('docs/index.html') && /const GIST='(\w+)'/.exec(fs.readFileSync('docs/index.html', 'utf8'))?.[1]);
if (!gist) throw new Error('usage: node build-pages.js <gist id>');
const w = fs.readFileSync('watch.html', 'utf8');
const shared = w.slice(w.indexOf('const $=id=>'), w.indexOf('// ---------- tabs ----------'));
const page = fs.readFileSync('docs/template.html', 'utf8').replace('/*SHARED*/', shared).replace('__GIST__', gist);
fs.writeFileSync('docs/index.html', page);
fs.mkdirSync('docs/engine', { recursive: true });
for (const f of ['box2d.js', 'constants.js', 'game.js']) fs.copyFileSync(path.join('engine', f), path.join('docs/engine', f));
fs.writeFileSync('docs/.nojekyll', '');
console.log('docs/index.html built (' + page.length + ' bytes), gist ' + gist);
