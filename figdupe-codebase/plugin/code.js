// figdupe — Figma Plugin (sandbox thread)
// AI-command interface: the plugin receives commands from the AI via WebSocket
// relay (through ui.html) and executes them against the Figma Plugin API.

figma.showUI(__html__, { width: 440, height: 260, title: 'figdupe' });

figma.ui.postMessage({
  type:     'file_info',
  fileKey:  figma.fileKey  || figma.root.name,
  fileName: figma.root.name,
});

// ─── Message bridge ───────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg) => {
  if (!msg) return;

  if (msg.type === 'resize')   { figma.ui.resize(msg.w || 440, msg.h || 260); return; }
  if (msg.type === 'open_url') { figma.openExternal(msg.url); return; }

  // AI commands arrive as { id, command, params } with no type field
  if (!msg.command) return;

  const { id, command, params } = msg;
  try {
    const result = await handleCommand(command, params || {});
    figma.ui.postMessage({ id, result });
  } catch (err) {
    figma.ui.postMessage({ id, error: err.message });
  }
};

// ─── Command Router ───────────────────────────────────────────────────────────

async function handleCommand(command, params) {
  switch (command) {

    case 'ping':
      return { status: 'ok', file: figma.root.name, page: figma.currentPage.name };

    case 'get_selection':
      return figma.currentPage.selection.map(n => serializeNode(n, 3));

    case 'get_pages':
      return figma.root.children.map(p => ({ id: p.id, name: p.name }));

    case 'set_current_page': {
      const page = figma.root.children.find(p => p.id === params.pageId);
      if (!page) throw new Error(`Page ${params.pageId} not found`);
      figma.currentPage = page;
      return { ok: true, pageId: page.id, name: page.name };
    }

    case 'get_page_frames':
      return figma.currentPage.children.map(n => ({ id: n.id, name: n.name, type: n.type }));

    case 'get_nodes':
      return getNodes(params);

    case 'get_nodes_flat':
      return getNodesFlat(params);

    case 'get_local_styles':
      return getLocalStyles();

    case 'rename_node':
      return renameNode(params.nodeId, params.name);

    case 'bulk_rename':
      return bulkRename(params.renames);

    case 'set_characters':
      return await setCharacters(params.nodeId, params.text);

    case 'bulk_set_characters':
      return await bulkSetCharacters(params.items);

    case 'set_property':
      return setProperty(params.nodeId, params.field, params.value);

    case 'bulk_set_property':
      return bulkSetProperty(params.items);

    case 'create_node':
      return await createNode(params);

    case 'create_node_tree':
      return await createNodeTree(params);

    case 'set_node_raw':
      return await setNodeRaw(params);

    case 'delete_node':
      return deleteNode(params.nodeId);

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// ─── Serialization ────────────────────────────────────────────────────────────

function isMixed(v) { return v === figma.mixed; }

function serializeFills(fills) {
  if (!fills || isMixed(fills)) return [];
  return fills.map(f => {
    const out = { type: f.type, visible: f.visible !== undefined ? f.visible : true, opacity: f.opacity !== undefined ? f.opacity : 1 };
    if (f.type === 'SOLID') {
      out.color = { r: Math.round(f.color.r * 255), g: Math.round(f.color.g * 255), b: Math.round(f.color.b * 255) };
    }
    return out;
  });
}

function serializeNode(node, depth) {
  const base = { id: node.id, name: node.name, type: node.type };

  if (node.type === 'TEXT') {
    base.text     = node.characters;
    base.fontSize = isMixed(node.fontSize) ? null : node.fontSize;
    if (!isMixed(node.fontName) && node.fontName) {
      base.fontFamily = node.fontName.family;
      base.fontWeight = node.fontName.style;
    }
    base.fills = serializeFills(node.fills);
  }

  if (node.type !== 'TEXT' && 'fills' in node && !isMixed(node.fills)) {
    base.fills = serializeFills(node.fills);
  }

  if ('cornerRadius' in node) {
    base.cornerRadius = isMixed(node.cornerRadius) ? null : node.cornerRadius;
  }

  if ('x' in node) { base.x = node.x; base.y = node.y; }
  if ('width' in node) { base.width = node.width; base.height = node.height; }

  if ('layoutMode' in node) {
    base.layoutMode            = node.layoutMode;
    base.paddingTop            = node.paddingTop;
    base.paddingRight          = node.paddingRight;
    base.paddingBottom         = node.paddingBottom;
    base.paddingLeft           = node.paddingLeft;
    base.itemSpacing           = node.itemSpacing;
    base.primaryAxisSizingMode = node.primaryAxisSizingMode;
    base.counterAxisSizingMode = node.counterAxisSizingMode;
  }

  if ('opacity' in node)    base.opacity    = node.opacity;
  if ('visible' in node)    base.visible    = node.visible;
  if ('clipsContent' in node) base.clipsContent = node.clipsContent;

  if (depth > 0 && 'children' in node) {
    base.children = node.children.map(c => serializeNode(c, depth - 1));
  } else if ('children' in node) {
    base.childCount = node.children.length;
  }

  return base;
}

// ─── Query commands ───────────────────────────────────────────────────────────

function getNodes({ nodeId, depth = 4 }) {
  const node = nodeId ? figma.getNodeById(nodeId) : figma.currentPage;
  if (!node) throw new Error(`Node ${nodeId} not found`);
  return serializeNode(node, depth);
}

function getNodesFlat({ nodeId, skipVectors = true, skipInstances = false } = {}) {
  const root   = nodeId ? figma.getNodeById(nodeId) : figma.currentPage;
  if (!root) throw new Error(`Node ${nodeId} not found`);
  const VECTOR_TYPES = new Set(['VECTOR', 'IMAGE', 'STAR', 'POLYGON', 'ELLIPSE', 'LINE']);
  const results = [];
  function walk(n) {
    if (skipVectors && VECTOR_TYPES.has(n.type)) return;
    results.push(serializeNode(n, 0));
    if ('children' in n) {
      for (const c of n.children) {
        if (skipInstances && c.id.includes(';')) continue;
        walk(c);
      }
    }
  }
  walk(root);
  return results;
}

function getLocalStyles() {
  const textStyles  = figma.getLocalTextStyles().map(s => ({
    id: s.id, name: s.name, type: 'TEXT',
    fontSize: s.fontSize,
    fontFamily: s.fontName ? s.fontName.family : null,
    fontWeight: s.fontName ? s.fontName.style  : null,
  }));
  const paintStyles = figma.getLocalPaintStyles().map(s => ({
    id: s.id, name: s.name, type: 'PAINT',
    fills: serializeFills(s.paints),
  }));
  return { text: textStyles, paint: paintStyles };
}

// ─── Rename ───────────────────────────────────────────────────────────────────

function renameNode(nodeId, name) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  const old = node.name;
  node.name = name;
  return { ok: true, nodeId, oldName: old, newName: name };
}

function bulkRename(renames) {
  return renames.map(({ nodeId, name }) => {
    try { return renameNode(nodeId, name); }
    catch (e) { return { ok: false, nodeId, error: e.message }; }
  });
}

// ─── Text ─────────────────────────────────────────────────────────────────────

const _loadedFonts = new Set();
async function ensureFontLoaded(fontName) {
  const key = `${fontName.family}:${fontName.style}`;
  if (!_loadedFonts.has(key)) {
    await figma.loadFontAsync(fontName);
    _loadedFonts.add(key);
  }
}

async function setCharacters(nodeId, text) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  if (node.type !== 'TEXT') throw new Error(`Node ${nodeId} is not a TEXT node`);
  const fontName = isMixed(node.fontName) ? { family: 'Inter', style: 'Regular' } : node.fontName;
  await ensureFontLoaded(fontName);
  const old = node.characters;
  node.characters = text;
  return { ok: true, nodeId, oldText: old, newText: text };
}

async function bulkSetCharacters(items) {
  const results = [];
  for (const { nodeId, text } of items) {
    try { results.push(await setCharacters(nodeId, text)); }
    catch (e) { results.push({ ok: false, nodeId, error: e.message }); }
  }
  return results;
}

// ─── Properties ──────────────────────────────────────────────────────────────

const SETTABLE_PROPERTIES = new Set([
  'name', 'visible', 'opacity', 'blendMode', 'clipsContent',
  'layoutMode', 'primaryAxisSizingMode', 'counterAxisSizingMode',
  'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
  'itemSpacing', 'counterAxisSpacing',
  'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
  'constraints', 'layoutAlign', 'layoutGrow', 'layoutPositioning',
  'strokeWeight', 'strokeAlign', 'dashPattern',
]);

function setProperty(nodeId, field, value) {
  if (!SETTABLE_PROPERTIES.has(field)) throw new Error(`Property "${field}" is not in the allowed list`);
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  node[field] = value;
  return { ok: true, nodeId, field, value };
}

function bulkSetProperty(items) {
  return items.map(({ nodeId, field, value }) => {
    try { return setProperty(nodeId, field, value); }
    catch (e) { return { ok: false, nodeId, field, error: e.message }; }
  });
}

// ─── Node creation ────────────────────────────────────────────────────────────

function makeFill(f) {
  if (f.type === 'SOLID') {
    const fill = { type: 'SOLID', color: { r: f.r / 255, g: f.g / 255, b: f.b / 255 } };
    if (f.opacity !== undefined) fill.opacity = f.opacity;
    return fill;
  }
  return f;
}

function makeStroke(s) {
  if (s.type === 'SOLID') {
    const stroke = { type: 'SOLID', color: { r: s.r / 255, g: s.g / 255, b: s.b / 255 } };
    if (s.opacity !== undefined) stroke.opacity = s.opacity;
    return stroke;
  }
  return s;
}

async function applyNodeProps(node, props) {
  // Load font before any text operation
  if (node.type === 'TEXT') {
    const fn = props.fontName || { family: 'Inter', style: 'Regular' };
    await ensureFontLoaded(fn);
    node.fontName = fn;
  }

  const SKIP = new Set(['type', 'children', 'fontName']);

  for (const [key, value] of Object.entries(props)) {
    if (SKIP.has(key)) continue;
    try {
      if (key === 'fills') {
        node.fills = value.map(makeFill);
      } else if (key === 'strokes') {
        node.strokes = value.map(makeStroke);
      } else if (key === 'characters') {
        const fn = isMixed(node.fontName) ? { family: 'Inter', style: 'Regular' } : node.fontName;
        await ensureFontLoaded(fn);
        node.characters = value;
      } else if (key === 'effects') {
        node.effects = value;
      } else if (key === 'width' || key === 'height') {
        // handled together below
      } else if (key in node) {
        node[key] = value;
      }
    } catch (e) {
      console.warn(`[figdupe] applyNodeProps: could not set "${key}": ${e.message}`);
    }
  }

  // Apply width + height together so resize() locks in the final size
  if (('width' in props || 'height' in props) && 'resize' in node) {
    try {
      const w = props.width  !== undefined ? props.width  : node.width;
      const h = props.height !== undefined ? props.height : node.height;
      node.resize(w, h);
    } catch (e) {}
  }
}

function instantiateNode(type) {
  switch (type) {
    case 'FRAME':     return figma.createFrame();
    case 'COMPONENT': return figma.createComponent();
    case 'RECTANGLE': return figma.createRectangle();
    case 'ELLIPSE':   return figma.createEllipse();
    case 'LINE':      return figma.createLine();
    case 'TEXT':      return figma.createText();
    case 'VECTOR':    return figma.createVector();
    default: throw new Error(`Unsupported node type: ${type}`);
  }
}

async function createNode({ type, parentId, props = {} }) {
  const parent = parentId ? figma.getNodeById(parentId) : figma.currentPage;
  if (!parent) throw new Error(`Parent ${parentId} not found`);
  const node = instantiateNode(type);
  if ('appendChild' in parent) parent.appendChild(node);
  await applyNodeProps(node, props);
  return { id: node.id, name: node.name, type: node.type };
}

async function setNodeRaw({ nodeId, props = {} }) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  await applyNodeProps(node, props);
  return { ok: true, nodeId };
}

async function createNodeTree({ tree, parentId }) {
  const parent = parentId ? figma.getNodeById(parentId) : figma.currentPage;
  if (!parent) throw new Error(`Parent ${parentId} not found`);

  const idMap = {}; // name → id

  async function build(def, parentNode) {
    const type     = def.type;
    const children = def.children || [];
    const props    = {};
    for (const k of Object.keys(def)) {
      if (k !== 'type' && k !== 'children') props[k] = def[k];
    }
    const node = instantiateNode(type);
    if ('appendChild' in parentNode) parentNode.appendChild(node);
    await applyNodeProps(node, props);
    if (props.name) idMap[props.name] = node.id;
    for (const child of children) {
      await build(child, node);
    }
    return node;
  }

  const defs = Array.isArray(tree) ? tree : [tree];
  for (const def of defs) {
    await build(def, parent);
  }

  return idMap;
}

function deleteNode(nodeId) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  node.remove();
  return { ok: true, nodeId };
}
