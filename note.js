// note.js - add a written explanation to the Learning tab.   node note.js "<title>" < text
const fs = require('fs'), path = require('path');
const file = path.join(__dirname, 'runs', 'train', 'notes.json');
const notes = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
notes.push({ at: Date.now(), title: process.argv[2] || 'Update', text: fs.readFileSync(0, 'utf8').trim() });
fs.writeFileSync(file, JSON.stringify(notes, null, 1));
console.log(notes.length + ' notes');
