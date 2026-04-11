const fs = require('fs');
const path = require('path');

const htmlSrc = fs.readFileSync(path.join(__dirname, 'src', 'ui.html'), 'utf8');
const jsSrc = fs.readFileSync(path.join(__dirname, 'ui.js'), 'utf8');

const outHtml = htmlSrc.replace('/* __UI_JS__ */', jsSrc);
fs.writeFileSync(path.join(__dirname, 'ui.html'), outHtml);

console.log('Built ui.html successfully.');