# Figdupe — System Context

Figdupe is a DOM-capture-to-Figma bridge with an AI command interface. It captures any website's computed DOM structure and exposes tools for you to build native Figma nodes from that data, step by step.

A local server (`server/server.js`) runs on port 7331 (HTTP for capture, WebSocket for command relay). The Figma plugin connects via WebSocket and executes commands. CLI tools (`tools/capture.js`, `tools/figma.js`) let you trigger captures and send Figma commands.

---

## Workflow

### Step 1 — Capture the target
```bash
# Capture a live website
node tools/capture.js https://example.com 1440

# Multiple viewport widths
node tools/capture.js https://example.com 1440,768,375

# Local file or folder
node tools/capture.js /path/to/app 1440
```
Returns a JSON tree with every DOM node's tag, bounding rect, computed styles, and children. Save it to `temp/` for analysis before building.

### Step 2 — Verify the Figma connection
```bash
node tools/figma.js ping
node tools/figma.js list_connected_files
node tools/figma.js get_pages
node tools/figma.js set_current_page '{"pageId":"<id>"}'
node tools/figma.js get_page_frames
```
**Rule:** If `list_connected_files` returns nothing, stop and ask the user to open the figdupe plugin in their Figma file.

### Step 3 — Build the page step by step
Analyse the DOM tree, then issue Figma commands to recreate the design. Work from the outside in: page frame → sections → components → text.

```bash
# Create the viewport frame
node tools/figma.js create_node '{"type":"FRAME","props":{"name":"homepage","x":0,"y":0,"width":1440,"height":4200,"fills":[{"type":"SOLID","r":255,"g":255,"b":255}],"clipsContent":true}}'

# Turn it into a vertical auto-layout container
node tools/figma.js set_node_raw '{"nodeId":"<id>","props":{"layoutMode":"VERTICAL","primaryAxisSizingMode":"AUTO","counterAxisSizingMode":"FIXED","itemSpacing":0,"paddingTop":0,"paddingBottom":0,"paddingLeft":0,"paddingRight":0}}'

# Create a section inside
node tools/figma.js create_node '{"type":"FRAME","parentId":"<frameId>","props":{"name":"hero","width":1440,"layoutMode":"VERTICAL","paddingTop":80,"paddingBottom":80,"paddingLeft":80,"paddingRight":80,"itemSpacing":24,"fills":[{"type":"SOLID","r":15,"g":15,"b":15}]}}'

# Add a heading text node
node tools/figma.js create_node '{"type":"TEXT","parentId":"<heroId>","props":{"name":"hero-heading","characters":"Build faster with AI","fontSize":64,"fills":[{"type":"SOLID","r":255,"g":255,"b":255}]}}'

# Create a whole nested structure at once
node tools/figma.js create_node_tree '{"parentId":"<id>","tree":{"type":"FRAME","name":"card","width":360,"layoutMode":"VERTICAL","paddingTop":24,"paddingLeft":24,"paddingRight":24,"paddingBottom":24,"itemSpacing":12,"cornerRadius":12,"fills":[{"type":"SOLID","r":255,"g":255,"b":255}],"children":[{"type":"TEXT","name":"card-title","characters":"Card Title","fontSize":20},{"type":"TEXT","name":"card-body","characters":"Card description text.","fontSize":14}]}}'

# Verify what was built
node tools/figma.js get_nodes '{"nodeId":"<id>","depth":2}'

# Update a node after inspecting it
node tools/figma.js set_node_raw '{"nodeId":"<id>","props":{"opacity":0.9}}'
```

---

## Command Reference

| Command | Key params | Notes |
|---------|-----------|-------|
| `ping` | — | Health check |
| `list_connected_files` | — | See connected Figma files |
| `get_pages` | — | All pages in the file |
| `set_current_page` | `{pageId}` | Switch active page |
| `get_page_frames` | — | Top-level frames on current page |
| `get_nodes` | `{nodeId, depth?}` | Read node tree (default depth 4) |
| `get_nodes_flat` | `{nodeId?, skipVectors?}` | Flat list of all descendants |
| `get_selection` | — | Currently selected nodes |
| `get_local_styles` | — | Text and paint styles |
| `create_node` | `{type, parentId?, props}` | Create one node |
| `create_node_tree` | `{tree, parentId?}` | Create a nested tree at once |
| `set_node_raw` | `{nodeId, props}` | Update any node properties |
| `delete_node` | `{nodeId}` | Remove a node |
| `set_characters` | `{nodeId, text}` | Set text content |
| `bulk_set_characters` | `{items:[{nodeId,text}]}` | Bulk text update |
| `rename_node` | `{nodeId, name}` | Rename a node |
| `bulk_rename` | `{renames:[{nodeId,name}]}` | Bulk rename |
| `set_property` | `{nodeId, field, value}` | Set an allowed property |
| `bulk_set_property` | `{items:[{nodeId,field,value}]}` | Bulk property set |

---

## Node Property Formats

### Fills (use r/g/b 0–255)
```json
[{ "type": "SOLID", "r": 255, "g": 255, "b": 255 }]
[{ "type": "SOLID", "r": 24,  "g": 24,  "b": 27,  "opacity": 0.9 }]
```

### Strokes
```json
[{ "type": "SOLID", "r": 229, "g": 229, "b": 235 }]
```

### Effects (shadows, blurs)
```json
[{ "type": "DROP_SHADOW", "color": {"r":0,"g":0,"b":0,"a":0.12}, "offset":{"x":0,"y":4}, "radius":16, "spread":0, "visible":true, "blendMode":"NORMAL" }]
```

### Auto-layout
```json
{
  "layoutMode": "VERTICAL",
  "primaryAxisSizingMode": "AUTO",
  "counterAxisSizingMode": "FIXED",
  "paddingTop": 24, "paddingBottom": 24, "paddingLeft": 24, "paddingRight": 24,
  "itemSpacing": 16
}
```

### Typography
```json
{
  "characters": "Hello",
  "fontSize": 16,
  "fontName": { "family": "Inter", "style": "Regular" }
}
```

---

## Temp File Conventions

- All intermediate work (captured DOM trees, analysis notes, build plans) goes in `temp/`
- Naming: `temp/<site>-dom.json`, `temp/<site>-plan.md`
- Delete `temp/` when done with the task

---

## Design Principles

- **Analyse before building** — read the full DOM tree and write a build plan to `temp/` first
- **Outside in** — page frame → section frames → component frames → text/images
- **Auto-layout everywhere** — use `layoutMode: 'VERTICAL'` or `'HORIZONTAL'` on every container; never place children with absolute x/y unless the parent is `layoutMode: 'NONE'`
- **Exact values** — copy colours, spacing, and font sizes directly from the captured DOM tree; never approximate
- **Verify as you go** — after creating a major section, call `get_nodes` to confirm ids and structure before continuing
- **Naming** — lowercase with dashes (`hero-section`, `nav-link`); never spaces
