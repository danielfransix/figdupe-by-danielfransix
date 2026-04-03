#!/usr/bin/env node
// Usage: node tools/figma.js [--file <fileKey>] <command> [params-as-json]
// Examples:
//   node tools/figma.js ping
//   node tools/figma.js list_connected_files
//   node tools/figma.js get_pages
//   node tools/figma.js get_page_frames
//   node tools/figma.js create_node '{"type":"FRAME","props":{"name":"hero","width":1440,"height":900}}'
//   node tools/figma.js create_node_tree '{"tree":{"type":"FRAME","name":"card","width":360,"height":200,"children":[{"type":"TEXT","characters":"Hello"}]}}'
//   node tools/figma.js set_node_raw '{"nodeId":"1:2","props":{"layoutMode":"VERTICAL","paddingTop":40}}'
//   node tools/figma.js set_characters '{"nodeId":"1:3","text":"New content"}'
//   node tools/figma.js delete_node '{"nodeId":"1:4"}'

const WebSocket = require('../server/node_modules/ws');
const { randomUUID } = require('crypto');

// ─── Arg parsing ─────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);

let fileKey = null;
const args  = [...rawArgs];

const fileIdx = args.indexOf('--file');
if (fileIdx !== -1) {
  fileKey = args[fileIdx + 1];
  if (!fileKey) {
    console.error('--file requires a value (fileKey)');
    process.exit(1);
  }
  args.splice(fileIdx, 2);
}

const command = args[0];
let params = {};
if (args[1]) {
  try {
    params = JSON.parse(args[1]);
  } catch (e) {
    console.error('Invalid JSON for params:', e.message);
    process.exit(1);
  }
}

if (!command) {
  console.error(`Usage: node tools/figma.js [--file <fileKey>] <command> [params-json]

Commands:
  list_connected_files              List all files with an active plugin connection
  ping                              Health check
  get_pages                         List all pages
  set_current_page                  '{"pageId":"<id>"}'
  get_page_frames                   Top-level frames on current page
  get_nodes                         '{"nodeId":"<id>","depth":3}'
  get_nodes_flat                    '{"nodeId":"<id>","skipVectors":true}'
  get_selection                     Currently selected nodes
  get_local_styles                  Text and paint styles
  create_node                       '{"type":"FRAME","parentId":"<id>","props":{...}}'
  create_node_tree                  '{"tree":{...},"parentId":"<id>"}'
  set_node_raw                      '{"nodeId":"<id>","props":{...}}'
  delete_node                       '{"nodeId":"<id>"}'
  set_characters                    '{"nodeId":"<id>","text":"..."}'
  bulk_set_characters               '{"items":[{"nodeId":"<id>","text":"..."}]}'
  rename_node                       '{"nodeId":"<id>","name":"..."}'
  bulk_rename                       '{"renames":[{"nodeId":"<id>","name":"..."}]}'
  set_property                      '{"nodeId":"<id>","field":"layoutMode","value":"VERTICAL"}'
  bulk_set_property                 '{"items":[{"nodeId":"<id>","field":"...","value":"..."}]}'`);
  process.exit(1);
}

// ─── WebSocket call ───────────────────────────────────────────────────────────

const ws = new WebSocket('ws://localhost:7331');
const id = randomUUID();
let done = false;

const msg = { id, command, params };
if (fileKey) msg.fileKey = fileKey;

const timeout = setTimeout(() => {
  if (!done) {
    console.error(JSON.stringify({ error: 'Timeout — is the figdupe server running and plugin connected?' }));
    process.exit(1);
  }
}, 15000);

ws.on('open', () => {
  ws.send(JSON.stringify(msg));
});

ws.on('message', (raw) => {
  const res = JSON.parse(raw.toString());

  // Active prompt injected on first connection — print it
  if (res.type === 'active_prompt') {
    if (res.content) {
      process.stdout.write(`\n--- Active Prompt ---\n${res.content}\n--- End Prompt ---\n\n`);
    }
    return;
  }

  if (res.id !== id) return;
  done = true;
  clearTimeout(timeout);
  ws.close();
  if (res.error) {
    console.error(JSON.stringify({ error: res.error }));
    process.exit(1);
  }
  console.log(JSON.stringify(res.result, null, 2));
  process.exit(0);
});

ws.on('error', (e) => {
  if (!done) {
    console.error(JSON.stringify({ error: e.message + ' — is the figdupe server running?' }));
    process.exit(1);
  }
});
