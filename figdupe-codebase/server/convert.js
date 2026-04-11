'use strict';

// figdupe — Deterministic DOM tree → Figma node tree converter
// Handles: absolute positioning, flex auto-layout, component detection, variant sets

// ─── Color parsing ─────────────────────────────────────────────────────────────

function parseColor(css) {
  if (!css) return null;
  const s = css.trim();
  if (s === 'transparent' || s === 'initial' || s === 'inherit' || s === 'none') return null;
  if (s === 'rgba(0, 0, 0, 0)') return null;

  let m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (m) {
    const r = Math.round(parseFloat(m[1]));
    const g = Math.round(parseFloat(m[2]));
    const b = Math.round(parseFloat(m[3]));
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    if (a <= 0) return null;
    return { r, g, b, a };
  }

  m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    const h = m[1];
    let r, g, b, a = 1;
    if (h.length === 3) {
      r = parseInt(h[0]+h[0], 16); g = parseInt(h[1]+h[1], 16); b = parseInt(h[2]+h[2], 16);
    } else if (h.length === 4) {
      r = parseInt(h[0]+h[0], 16); g = parseInt(h[1]+h[1], 16); b = parseInt(h[2]+h[2], 16);
      a = parseInt(h[3]+h[3], 16) / 255;
    } else if (h.length === 6) {
      r = parseInt(h.slice(0,2), 16); g = parseInt(h.slice(2,4), 16); b = parseInt(h.slice(4,6), 16);
    } else if (h.length === 8) {
      r = parseInt(h.slice(0,2), 16); g = parseInt(h.slice(2,4), 16); b = parseInt(h.slice(4,6), 16);
      a = parseInt(h.slice(6,8), 16) / 255;
    } else return null;
    if (a <= 0) return null;
    return { r, g, b, a };
  }
  return null;
}

function colorToFill({ r, g, b, a }) {
  const f = { type: 'SOLID', r, g, b };
  if (typeof a === 'number' && a < 1) f.opacity = a;
  return f;
}

// ─── Value helpers ─────────────────────────────────────────────────────────────

function parsePx(v, fallback = 0) {
  if (!v || v === 'auto' || v === 'normal' || v === 'none' || v === 'initial') return fallback;
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

const SYSTEM_FONTS = new Set([
  '-apple-system','BlinkMacSystemFont','system-ui','ui-sans-serif','ui-serif',
  'ui-monospace','Segoe UI','sans-serif','serif','monospace','cursive','fantasy',
  'Arial','Helvetica','Helvetica Neue','Times New Roman','Georgia','Verdana',
]);

function parseFontFamily(fontFamily) {
  if (!fontFamily) return 'Inter';
  const first = fontFamily.split(',')[0].trim().replace(/['"]/g, '');
  return (first && !SYSTEM_FONTS.has(first)) ? first : 'Inter';
}

const WEIGHT_MAP = {
  100:'Thin', 200:'ExtraLight', 300:'Light', 400:'Regular',
  500:'Medium', 600:'SemiBold', 700:'Bold', 800:'ExtraBold', 900:'Black',
};

function parseFontStyle(weight, fontStyle) {
  const isItalic = fontStyle === 'italic' || fontStyle === 'oblique';
  const w = Math.round(parsePx(weight, 400) / 100) * 100;
  const name = WEIGHT_MAP[w] || 'Regular';
  return isItalic ? (name === 'Regular' ? 'Italic' : `${name} Italic`) : name;
}

function mapTextAlign(align) {
  if (align === 'center')  return 'CENTER';
  if (align === 'right')   return 'RIGHT';
  if (align === 'justify') return 'JUSTIFIED';
  return 'LEFT';
}

function parseLineHeight(lh, fontSize) {
  if (!lh || lh === 'normal') return null;
  if (lh.endsWith('px')) {
    const px = parsePx(lh, 0);
    return px > 0 ? { value: px, unit: 'PIXELS' } : null;
  }
  const n = parseFloat(lh);
  if (!isNaN(n) && n > 0 && n <= 10) return { value: Math.round(n * 100), unit: 'PERCENT' };
  if (lh.endsWith('%')) {
    const pct = parsePx(lh, 0);
    return pct > 0 ? { value: pct, unit: 'PERCENT' } : null;
  }
  return null;
}

// ─── Box shadow ────────────────────────────────────────────────────────────────

function parseShadowSegment(seg) {
  seg = seg.trim();
  if (!seg || seg === 'none') return null;
  const inset = /\binset\b/.test(seg);
  const colorRgba = seg.match(/rgba?\([^)]+\)/i);
  const colorHex  = seg.match(/#[0-9a-f]{3,8}/i);
  const colorStr  = colorRgba ? colorRgba[0] : (colorHex ? colorHex[0] : null);
  const color     = colorStr ? parseColor(colorStr) : null;
  if (!color) return null;
  const rest = seg.replace(/\binset\b/, '').replace(colorStr, '').trim();
  const nums = rest.split(/\s+/).map(t => parsePx(t, 0));
  const [x = 0, y = 0, blur = 0, spread = 0] = nums;
  return {
    type:      inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
    color:     { r: color.r / 255, g: color.g / 255, b: color.b / 255, a: color.a },
    offset:    { x, y },
    radius:    Math.max(blur, 0),
    spread:    spread || 0,
    visible:   true,
    blendMode: 'NORMAL',
  };
}

function parseBoxShadows(str) {
  if (!str || str === 'none') return [];
  const segs = [];
  let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { segs.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) segs.push(cur);
  return segs.map(parseShadowSegment).filter(Boolean);
}

// ─── Borders ───────────────────────────────────────────────────────────────────

function parseBorders(styles) {
  const sides = [
    { w: styles.bTopWidth,    c: styles.bTopColor,    s: styles.bTopStyle },
    { w: styles.bRightWidth,  c: styles.bRightColor,  s: styles.bRightStyle },
    { w: styles.bBottomWidth, c: styles.bBottomColor, s: styles.bBottomStyle },
    { w: styles.bLeftWidth,   c: styles.bLeftColor,   s: styles.bLeftStyle },
  ];
  const visible = sides.filter(b => parsePx(b.w, 0) > 0 && b.s && b.s !== 'none' && parseColor(b.c));
  if (!visible.length) return null;
  const primary = visible[0];
  const c = parseColor(primary.c);
  const avgW = visible.reduce((s, b) => s + parsePx(b.w, 0), 0) / visible.length;
  return {
    strokes:      [{ type: 'SOLID', r: c.r, g: c.g, b: c.b, ...(c.a < 1 ? { opacity: c.a } : {}) }],
    strokeWeight: Math.max(Math.round(avgW), 1),
    strokeAlign:  'INSIDE',
  };
}

function parseCorners(styles) {
  const tl = parsePx(styles.brTL, 0), tr = parsePx(styles.brTR, 0);
  const bl = parsePx(styles.brBL, 0), br = parsePx(styles.brBR, 0);
  if (!tl && !tr && !bl && !br) return {};
  if (tl === tr && tr === bl && bl === br) return { cornerRadius: Math.round(tl) };
  return { topLeftRadius: Math.round(tl), topRightRadius: Math.round(tr), bottomLeftRadius: Math.round(bl), bottomRightRadius: Math.round(br) };
}

// ─── Visual frame props ────────────────────────────────────────────────────────

function buildVisualProps(styles) {
  const props = {};
  const bgColor = parseColor(styles.bg);
  props.fills = bgColor ? [colorToFill(bgColor)] : [];
  const borders = parseBorders(styles);
  if (borders) Object.assign(props, borders);
  Object.assign(props, parseCorners(styles));
  const effects = parseBoxShadows(styles.boxShadow);
  if (effects.length) props.effects = effects;
  const opacity = parseFloat(styles.opacity || '1');
  // Ignore near-zero opacities — these are animation initial states (Framer Motion,
  // React Spring, etc.) and should appear at full opacity in the design snapshot.
  if (!isNaN(opacity) && opacity >= 0.1 && opacity < 1) props.opacity = opacity;
  const ov = styles.overflow || '';
  props.clipsContent = ov === 'hidden' || ov === 'clip' || ov === 'scroll' || ov === 'auto';
  return props;
}

// ─── Text props ────────────────────────────────────────────────────────────────

function buildTextProps(styles, text) {
  const color    = parseColor(styles.color);
  const family   = parseFontFamily(styles.fontFamily);
  const style    = parseFontStyle(styles.fontWeight, styles.fontStyle);
  const fontSize = Math.max(parsePx(styles.fontSize, 14), 1);
  const lsPx     = parsePx(styles.letterSpacing, 0);

  const props = {
    fontName:            { family, style },
    fontSize,
    characters:          text || '',
    textAlignHorizontal: mapTextAlign(styles.textAlign),
    fills:               color ? [colorToFill(color)] : [],
  };
  if (lsPx !== 0) props.letterSpacing = { value: lsPx, unit: 'PIXELS' };
  const lh = parseLineHeight(styles.lineHeight, fontSize);
  if (lh) props.lineHeight = lh;
  const td = styles.textDecoration || '';
  if (td.includes('underline'))    props.textDecoration = 'UNDERLINE';
  if (td.includes('line-through')) props.textDecoration = 'STRIKETHROUGH';
  if (styles.textTransform === 'uppercase')  props.textCase = 'UPPER';
  else if (styles.textTransform === 'lowercase')  props.textCase = 'LOWER';
  else if (styles.textTransform === 'capitalize') props.textCase = 'TITLE';
  return props;
}

// ─── Auto-layout detection ─────────────────────────────────────────────────────

function isFlexContainer(styles) {
  const d = styles.display || '';
  return d === 'flex' || d === 'inline-flex';
}

function mapJustifyContent(jc) {
  switch (jc) {
    case 'flex-end': case 'end': return 'MAX';
    case 'center': return 'CENTER';
    case 'space-between': case 'space-around': case 'space-evenly': return 'SPACE_BETWEEN';
    default: return 'MIN';
  }
}

function mapAlignItems(ai) {
  switch (ai) {
    case 'flex-end': case 'end': return 'MAX';
    case 'center': return 'CENTER';
    case 'stretch': return 'STRETCH';
    case 'baseline': return 'BASELINE';
    default: return 'MIN';
  }
}

function buildAutoLayoutProps(styles) {
  const layoutMode = (styles.flexDirection || 'row').startsWith('column') ? 'VERTICAL' : 'HORIZONTAL';
  const gap = layoutMode === 'VERTICAL'
    ? parsePx(styles.rowGap    || styles.gap, 0)
    : parsePx(styles.columnGap || styles.gap, 0);
  return {
    layoutMode,
    primaryAxisSizingMode:   'FIXED',
    counterAxisSizingMode:   'FIXED',
    paddingTop:              Math.round(parsePx(styles.paddingTop,    0)),
    paddingRight:            Math.round(parsePx(styles.paddingRight,  0)),
    paddingBottom:           Math.round(parsePx(styles.paddingBottom, 0)),
    paddingLeft:             Math.round(parsePx(styles.paddingLeft,   0)),
    itemSpacing:             Math.max(Math.round(gap), 0),
    primaryAxisAlignItems:   mapJustifyContent(styles.justifyContent),
    counterAxisAlignItems:   mapAlignItems(styles.alignItems),
  };
}

// Apply auto-layout child properties (layoutGrow, layoutAlign, layoutPositioning)
function applyAutoLayoutChildProps(figmaNode, childStyles) {
  const pos = childStyles.position || 'static';
  const isAbsolute = pos === 'absolute' || pos === 'fixed' || pos === 'sticky';

  if (isAbsolute) {
    figmaNode.layoutPositioning = 'ABSOLUTE';
    // Keep x/y — absolutely positioned children need explicit coordinates
  } else {
    // Flow child: Figma manages position via auto-layout
    delete figmaNode.x;
    delete figmaNode.y;

    // flex-grow → layoutGrow
    const flexGrow = parsePx(childStyles.flexGrow, 0);
    if (flexGrow > 0) figmaNode.layoutGrow = 1;

    // align-self → layoutAlign
    switch (childStyles.alignSelf) {
      case 'stretch':              figmaNode.layoutAlign = 'STRETCH'; break;
      case 'flex-end': case 'end': figmaNode.layoutAlign = 'MAX';     break;
      case 'center':               figmaNode.layoutAlign = 'CENTER';  break;
      case 'flex-start': case 'start': figmaNode.layoutAlign = 'MIN'; break;
      default: figmaNode.layoutAlign = 'INHERIT'; break;
    }
  }
}

// ─── Component detection ───────────────────────────────────────────────────────

// Only promote genuine interactive semantic elements to COMPONENT.
// The heuristic (small + styled = component) was too aggressive and broke Framer/React sites.
const COMPONENT_TAGS = new Set(['button', 'input', 'select', 'textarea']);

function isComponentCandidate(node) {
  return COMPONENT_TAGS.has(node.tag || '');
}

// ─── State-aware visual overrides ─────────────────────────────────────────────
// `stateStyles` comes from the CDP state capture { bg, color, borderColor, borderWidth, boxShadow, opacity }

function applyStateOverrides(baseVisual, stateStyles) {
  if (!stateStyles) return baseVisual;
  const overridden = { ...baseVisual };

  const bg = parseColor(stateStyles.bg);
  if (bg) overridden.fills = [colorToFill(bg)];

  if (stateStyles.boxShadow && stateStyles.boxShadow !== 'none') {
    const effects = parseBoxShadows(stateStyles.boxShadow);
    if (effects.length) overridden.effects = effects;
  }

  const borderColor = parseColor(stateStyles.borderColor);
  if (borderColor && stateStyles.borderWidth && parsePx(stateStyles.borderWidth, 0) > 0) {
    overridden.strokes = [colorToFill(borderColor)];
    overridden.strokeWeight = Math.max(Math.round(parsePx(stateStyles.borderWidth, 0)), 1);
    overridden.strokeAlign  = 'INSIDE';
  }

  const opacity = parseFloat(stateStyles.opacity || '1');
  if (!isNaN(opacity) && opacity < 1) overridden.opacity = opacity;
  else delete overridden.opacity;

  return overridden;
}

// ─── Node converters ───────────────────────────────────────────────────────────

function convertNode(node, parentRect, inAutoLayout, componentStatesMap) {
  const { rect, isText, isTextInBox, tag } = node;
  const x = Math.round(rect.x - parentRect.x);
  const y = Math.round(rect.y - parentRect.y);
  const w = Math.max(Math.round(rect.w), 1);
  const h = Math.max(Math.round(rect.h), 1);

  let figmaNode;
  if      (isText)      figmaNode = convertTextNode(node, x, y, w, h);
  else if (isTextInBox) figmaNode = convertTextInBoxNode(node, x, y, w, h);
  else if (tag === 'img') figmaNode = convertImageNode(node, x, y, w, h);
  else if (tag === 'svg') figmaNode = convertSvgNode(node, x, y, w, h);
  else figmaNode = convertContainerNode(node, x, y, w, h, componentStatesMap);

  // Auto-layout child context: strip/annotate position properties
  if (inAutoLayout && figmaNode) {
    applyAutoLayoutChildProps(figmaNode, node.styles || {});
  }

  return figmaNode;
}

function convertTextNode(node, x, y, w, h) {
  const { styles, text, name } = node;
  return { type: 'TEXT', name, x, y, width: w, height: h, ...buildTextProps(styles, text) };
}

function convertTextInBoxNode(node, x, y, w, h) {
  const { styles, text, name } = node;
  const visual = buildVisualProps(styles);
  const pTop = parsePx(styles.paddingTop, 0), pRight  = parsePx(styles.paddingRight, 0);
  const pBot = parsePx(styles.paddingBottom, 0), pLeft = parsePx(styles.paddingLeft, 0);
  return {
    type: 'FRAME', name, x, y, width: w, height: h,
    ...visual,
    children: [{
      type: 'TEXT', name: `${name}/label`,
      x: pLeft, y: pTop,
      width: Math.max(w - pLeft - pRight, 1),
      height: Math.max(h - pTop - pBot, 1),
      ...buildTextProps(styles, text),
    }],
  };
}

function convertImageNode(node, x, y, w, h) {
  const { name, styles } = node;
  const { effects, opacity, ...corners } = parseCorners(styles);
  return {
    type: 'RECTANGLE', name, x, y, width: w, height: h,
    fills: [{ type: 'SOLID', r: 210, g: 210, b: 210 }],
    ...parseCorners(styles),
    ...(parseBoxShadows(styles.boxShadow).length ? { effects: parseBoxShadows(styles.boxShadow) } : {}),
  };
}

function convertSvgNode(node, x, y, w, h) {
  const { name, styles } = node;
  const iconColor = parseColor(styles.color) || parseColor(styles.fill);
  return {
    type: 'RECTANGLE', name: `${name} (svg)`, x, y, width: w, height: h,
    fills: iconColor ? [colorToFill(iconColor)] : [{ type: 'SOLID', r: 180, g: 180, b: 180 }],
    ...parseCorners(styles),
  };
}

function convertContainerNode(node, x, y, w, h, componentStatesMap) {
  const { styles, name } = node;
  const visual = buildVisualProps(styles);
  const isFlex = isFlexContainer(styles);
  const isComponent = isComponentCandidate(node);

  // Look up state data from CDP capture (keyed by "x,y,w,h")
  const stateKey = node.rect ? `${node.rect.x},${node.rect.y},${node.rect.w},${node.rect.h}` : null;
  const stateData = stateKey && componentStatesMap ? componentStatesMap.get(stateKey) : null;

  const baseProps = {
    name,
    x, y,
    width: w,
    height: h,
    ...visual,
    ...(isFlex ? buildAutoLayoutProps(styles) : {}),
  };

  // Build children, passing auto-layout context
  const children = (node.children || [])
    .map(child => convertNode(child, node.rect, isFlex, componentStatesMap))
    .filter(Boolean);

  if (isComponent && stateData) {
    // Build a COMPONENT_SET with multiple state variants
    return buildComponentSet(name, baseProps, children, stateData, styles);
  }

  if (isComponent) {
    // Single-state COMPONENT (no captured state data available)
    return { type: 'COMPONENT', ...baseProps, children };
  }

  return { type: 'FRAME', ...baseProps, children };
}

// ─── COMPONENT_SET builder ─────────────────────────────────────────────────────

const STATE_ORDER = ['default', 'hover', 'focus', 'active', 'disabled'];

function buildComponentSet(name, baseProps, children, stateData, styles) {
  const variants = [];

  for (const stateName of STATE_ORDER) {
    if (stateName !== 'default' && !stateData[stateName]) continue;

    const stateStyles = stateData[stateName] || null;
    const variantVisual = stateStyles ? applyStateOverrides(
      { fills: baseProps.fills, effects: baseProps.effects, strokes: baseProps.strokes,
        strokeWeight: baseProps.strokeWeight, strokeAlign: baseProps.strokeAlign },
      stateStyles
    ) : { fills: baseProps.fills, effects: baseProps.effects };

    const label = stateName.charAt(0).toUpperCase() + stateName.slice(1);

    variants.push({
      type:    'COMPONENT',
      name:    `State=${label}`,           // Figma variant naming convention
      x:       0,
      y:       0,
      width:   baseProps.width,
      height:  baseProps.height,
      ...(baseProps.layoutMode ? {
        layoutMode:            baseProps.layoutMode,
        primaryAxisSizingMode: baseProps.primaryAxisSizingMode,
        counterAxisSizingMode: baseProps.counterAxisSizingMode,
        paddingTop:            baseProps.paddingTop,
        paddingRight:          baseProps.paddingRight,
        paddingBottom:         baseProps.paddingBottom,
        paddingLeft:           baseProps.paddingLeft,
        itemSpacing:           baseProps.itemSpacing,
        primaryAxisAlignItems: baseProps.primaryAxisAlignItems,
        counterAxisAlignItems: baseProps.counterAxisAlignItems,
      } : {}),
      ...baseProps.cornerRadius !== undefined ? { cornerRadius: baseProps.cornerRadius } : {},
      ...parseCorners(styles),
      clipsContent: baseProps.clipsContent,
      ...variantVisual,
      children: deepClone(children),
    });
  }

  if (variants.length === 1) {
    // Only default — no set needed, return single COMPONENT
    return { ...variants[0], name, x: baseProps.x, y: baseProps.y };
  }

  // Return a COMPONENT_SET descriptor — interpreted by create_component_set in code.js
  return {
    type:     'COMPONENT_SET',
    name,
    x:        baseProps.x,
    y:        baseProps.y,
    variants,
  };
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ─── Page frame builder ────────────────────────────────────────────────────────

function convertCapture(capture, offsetX, componentStatesMap) {
  const { width, height, title, url, tree } = capture;
  const label = (title || url || 'Page').replace(/\s+/g, ' ').trim().slice(0, 80);

  const bodyBg = (tree && tree.styles) ? parseColor(tree.styles.bg) : null;
  const fills  = bodyBg ? [colorToFill(bodyBg)] : [{ type: 'SOLID', r: 255, g: 255, b: 255 }];

  const bodyRect  = (tree && tree.rect) || { x: 0, y: 0 };
  const topNodes  = (tree && tree.children && tree.children.length > 0) ? tree.children : (tree ? [tree] : []);

  const isFlex = tree && tree.styles ? isFlexContainer(tree.styles) : false;
  const children = topNodes
    .map(child => convertNode(child, bodyRect, isFlex, componentStatesMap))
    .filter(Boolean);

  return {
    type:         'FRAME',
    name:         `${label} — ${width}px`,
    x:            offsetX,
    y:            0,
    width,
    height:       Math.max(height, 1),
    fills,
    clipsContent: false,
    children,
  };
}

// ─── Main exports ──────────────────────────────────────────────────────────────

function convertAllCaptures(captures, componentStatesList) {
  const GAP = 120;
  let offsetX = 0;
  return captures.map((cap, i) => {
    // componentStatesList[i] is an array of { rect, states } for this viewport
    const statesMap = buildStatesMap(componentStatesList && componentStatesList[i]);
    const frame = convertCapture(cap, offsetX, statesMap);
    offsetX += cap.width + GAP;
    return frame;
  });
}

function buildStatesMap(statesList) {
  if (!statesList || !statesList.length) return null;
  const map = new Map();
  for (const entry of statesList) {
    if (entry && entry.rect) {
      const key = `${entry.rect.x},${entry.rect.y},${entry.rect.w},${entry.rect.h}`;
      map.set(key, entry.states);
    }
  }
  return map.size > 0 ? map : null;
}

module.exports = { convertCapture, convertAllCaptures };
