#!/usr/bin/env node
// Triggers a DOM capture via the figdupe server and prints the result as JSON.
// Usage: node tools/capture.js <url-or-path> [widths-csv]
// Examples:
//   node tools/capture.js https://example.com
//   node tools/capture.js https://example.com 1440,768,375
//   node tools/capture.js /Users/me/my-app 1280
//   node tools/capture.js /Users/me/page.html

const http = require('http');

const args = process.argv.slice(2);
if (!args[0]) {
  console.error(`Usage: node tools/capture.js <url-or-path> [widths-csv]

Examples:
  node tools/capture.js https://example.com
  node tools/capture.js https://example.com 1440,768,375
  node tools/capture.js /path/to/app 1280`);
  process.exit(1);
}

const value  = args[0];
const widths = args[1]
  ? args[1].split(',').map(Number).filter(w => w >= 320 && w <= 3840)
  : [1440];
const type   = /^https?:\/\//i.test(value.trim()) ? 'url' : 'path';

if (widths.length === 0) {
  console.error('Invalid widths — values must be between 320 and 3840');
  process.exit(1);
}

const body       = JSON.stringify({ type, value, widths });
const bodyBuffer = Buffer.from(body);

const req = http.request({
  hostname: 'localhost',
  port:     7331,
  path:     '/capture',
  method:   'POST',
  headers:  {
    'Content-Type':   'application/json',
    'Content-Length': bodyBuffer.length,
  },
}, (res) => {
  let raw = '';
  res.on('data', chunk => raw += chunk);
  res.on('end', () => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error(JSON.stringify({ error: 'Invalid JSON from server' }));
      process.exit(1);
    }
    if (!data.ok) {
      console.error(JSON.stringify({ error: data.error || 'Capture failed' }));
      process.exit(1);
    }
    console.log(JSON.stringify(data.data, null, 2));
    process.exit(0);
  });
});

req.setTimeout(240000, () => {
  req.destroy();
  console.error(JSON.stringify({ error: 'Timeout — capture took too long (4 min limit)' }));
  process.exit(1);
});

req.on('error', (e) => {
  const hint = e.code === 'ECONNREFUSED'
    ? ' — is the figdupe server running? Start it with Start Figdupe.bat'
    : '';
  console.error(JSON.stringify({ error: e.message + hint }));
  process.exit(1);
});

req.write(body);
req.end();
