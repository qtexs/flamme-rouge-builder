/* ==========================================
   Flamme Rouge Stage Builder — script.js
   ========================================== */

/* -----------------------------
   DOM: major elements & panels
   ----------------------------- */
const tilePicker = document.getElementById("tile-picker");
const svgStage   = document.getElementById("build-area");
const camera     = document.getElementById("camera");
const stageRoot  = document.getElementById("stage-root");

const labelLayer      = document.getElementById("label-layer");
const checkpointLayer = document.getElementById("checkpoint-layer");

// Toolbar / actions
const undoBtn  = document.getElementById("undo-btn");
const resetBtn = document.getElementById("reset-btn");
const fitBtn   = document.getElementById("fit-btn");

// Meta Information (Stage Setup + counters)
const setupBadgesEl = document.getElementById("setup-badges");
const cntTotalEl  = document.getElementById("cnt-total");
const cntLongEl   = document.getElementById("cnt-long");
const cntMediumEl = document.getElementById("cnt-medium");
const cntTurnsEl  = document.getElementById("cnt-turns");
const cntTrackEl  = document.getElementById("cnt-track");
const cntRacingEl = document.getElementById("cnt-racing");

// Stage Stats 2 DOM (works with either ct-* or cnt-* ids)
const elFlat   = document.getElementById("ct-flat")     || document.getElementById("cnt-flat");
const elAsc    = document.getElementById("ct-ascent")   || document.getElementById("cnt-asc");
const elDesc   = document.getElementById("ct-descent")  || document.getElementById("cnt-desc");
const elSupply = document.getElementById("ct-supply")   || document.getElementById("cnt-supply");
const elCobb   = document.getElementById("ct-cobble")   || document.getElementById("cnt-cobb");
const elSlip   = document.getElementById("ct-slippery") || document.getElementById("cnt-slip");

/* -----------------------------
   State
   ----------------------------- */
let placed = [];                // { g, prefix, tx, ty, rot, socket, goals, labelGroup, meta }
let nextId = 1;
let cameraRotation = 0;         // degrees
let manualZoom = 1;

let tileCounts = {};            // { baseId: count }
let tileCounterEls = {};        // { id: counterElement }

let checkpoints = [];
let cpPickMode = false;
let cpPending = { color: "red", label: "A" }; // defaults

// Optional values (reserved for future)
let stageSprintPoints = 0;
let stageKOMPoints    = 0;

// --- Download modal init guard ---
let _dlInited = false;

// Which tiles count as 1 or 2 squares in racing length calculation
const racingLenOne = new Set(["a", "1-upp", "u", "v"]);
const racingLenTwo = new Set(["a-upp", "1", "u-upp", "v-upp"]);

// Checkpoint color map
const CP_COLORS = {
  red:    "#f8333c",
  green:  "#6bbf59",
  blue:   "#00bbf9",
  yellow: "#f5b700",
};

// UI font for tiny labels (checkpoints + profile numbers)
const FONT_OSWALD = `Oswald, sans-serif`;

/* -----------------------------
   Tiny store + event bus
   ----------------------------- */
const Stage = {
  name: "Custom Stage",
  placed: [],
  checkpoints: [],
  listeners: new Set(),
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() {
    const snap = { placed: this.placed, checkpoints: this.checkpoints };
    this.listeners.forEach(fn => fn(snap));
  }
};
Stage.placed = placed;
Stage.checkpoints = checkpoints;

/* -----------------------------
   Init
   ----------------------------- */
init();

async function init() {
  await loadTiles();

  // Toolbar
  if (undoBtn)  undoBtn.addEventListener("click", undo);
  if (fitBtn)   fitBtn.addEventListener("click", fitToScreen);

  const rotL = document.getElementById("rotate-left-btn");
  const rotR = document.getElementById("rotate-right-btn");
  const zoomIn = document.getElementById("zoom-in-btn");
  const zoomOut = document.getElementById("zoom-out-btn");

  if (rotL)   rotL.addEventListener("click", () => rotateCamera(-15));
  if (rotR)   rotR.addEventListener("click", () => rotateCamera( 15));
  if (zoomIn) zoomIn.addEventListener("click", () => { manualZoom *= 1.1; updateCamera(); });
  if (zoomOut)zoomOut.addEventListener("click", () => { manualZoom /= 1.1; updateCamera(); });

  // Sprint/KOM inputs
  const inpSprints = document.getElementById("inp-sprints");
  const inpKoms    = document.getElementById("inp-koms");
  if (inpSprints) inpSprints.addEventListener("input", () => {
    const v = Math.max(0, parseInt(inpSprints.value || "0", 10) || 0);
    inpSprints.value = v; stageSprintPoints = v;
  });
  if (inpKoms) inpKoms.addEventListener("input", () => {
    const v = Math.max(0, parseInt(inpKoms.value || "0", 10) || 0);
    inpKoms.value = v; stageKOMPoints = v;
  });

  // Stage name
  const stageNameInput = document.getElementById("stage-name");
  if (stageNameInput) {
    stageNameInput.value = "Custom Stage";
    Stage.name = stageNameInput.value;
    stageNameInput.addEventListener("input", () => {
      Stage.name = (stageNameInput.value || "").trim() || "Custom Stage";
    });
  }

  // Checkpoint color swatches
  document.querySelectorAll(".cp-swatch").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cp-swatch").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      const c = btn.getAttribute("data-color");
      cpPending.color = c in CP_COLORS ? c : "red";
    });
  });

  // Reset stage
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (!confirm("Reset stage? This removes all tiles and checkpoints.")) return;

      placed.forEach(p => p.g.remove());
      placed.length = 0;
      labelLayer.innerHTML = "";

      checkpoints.forEach(cp => cp.g.remove());
      checkpoints.length = 0;

      Object.keys(tileCounts).forEach(k => tileCounts[k] = 0);
      Object.keys(tileCounterEls).forEach(id => {
        const base = id.replace(/-upp$/, "");
        tileCounterEls[id].textContent = tileCounts[base] || 0;
      });

      manualZoom = 1;
      cameraRotation = 0;
      camera.setAttribute("transform", "");

      Stage.emit();
      setupDownloadModal();
    });
  }

  // CP label input
  const cpLabelInput = document.getElementById("cp-label");
  cpLabelInput.value = "A";
  cpLabelInput.addEventListener("input", () => {
    const v = (cpLabelInput.value || "").toUpperCase().slice(0,2);
    cpLabelInput.value = v;
    cpPending.label = v || "A";
  });

  // Add/remove checkpoints
  document.getElementById("cp-add-btn").addEventListener("click", () => {
    cpPending.label = (cpLabelInput.value || "A").toUpperCase().slice(0,2);
    cpPickMode = true;
    svgStage.style.cursor = "crosshair";
  });
  document.getElementById("cp-remove-last-btn").addEventListener("click", removeLastCheckpoint);

  svgStage.addEventListener("click", onStageClickForCheckpoint);
  ensureCheckpointHaloFilter();

  // Re-render hooks
  Stage.onChange(renderMetaFromStage);
  Stage.onChange(renderStats2FromStage);
  Stage.onChange(renderStageProfile);
  Stage.emit(); // initial paint
  setupDownloadModal();
}

/* -----------------------------
   Fit / Rotate / Camera
   ----------------------------- */
function rotateCamera(deltaDeg) { cameraRotation += deltaDeg; updateCamera(); }

function fitToScreen() {
  if (!placed.length) {
    manualZoom = 1;
    camera.setAttribute("transform", "");
    return;
  }
  manualZoom = 1;
  updateCamera();
}

function updateCamera() {
  if (!placed.length) return;

  const pts = placed
    .filter(p => p.socket && p.socket.center)
    .map(p => {
      const pr = rotatePoint(p.socket.center, p.rot);
      return { x: p.tx + pr.x, y: p.ty + pr.y };
    });
  if (!pts.length) return;

  const cx = (Math.min(...pts.map(p=>p.x)) + Math.max(...pts.map(p=>p.x))) / 2;
  const cy = (Math.min(...pts.map(p=>p.y)) + Math.max(...pts.map(p=>p.y))) / 2;

  const ang = cameraRotation * Math.PI / 180;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const rpts = pts.map(p => {
    const dx = p.x - cx, dy = p.y - cy;
    return { x: cx + dx*cos - dy*sin, y: cy + dx*sin + dy*cos };
  });

  let minX = Math.min(...rpts.map(p=>p.x));
  let maxX = Math.max(...rpts.map(p=>p.x));
  let minY = Math.min(...rpts.map(p=>p.y));
  let maxY = Math.max(...rpts.map(p=>p.y));
  let w = Math.max(1, maxX - minX);
  let h = Math.max(1, maxY - minY);

  const pad = 200, VW = 4000, VH = 3000;
  const scaleX = (VW - pad*2) / w;
  const scaleY = (VH - pad*2) / h;

  let scale = Math.min(scaleX, scaleY);
  scale = Math.min(scale, 2.5);
  scale *= manualZoom;

  const rcx = (minX + maxX) / 2;
  const rcy = (minY + maxY) / 2;

  camera.setAttribute(
    "transform",
    `translate(${VW/2}, ${VH/2}) rotate(${cameraRotation}) scale(${scale}) translate(${-rcx}, ${-rcy})`
  );

  // Keep badges exactly on their own tile centers and upright
  placed.forEach(t => {
    if (!t.labelGroup || !t.socket?.center) return;
    const pr = rotatePoint(t.socket.center, t.rot);
    const gx = t.tx + pr.x;
    const gy = t.ty + pr.y;
    t.labelGroup.setAttribute("transform", `translate(${gx}, ${gy}) rotate(${-cameraRotation})`);
  });

  updateCheckpointMarkers();
}

/* -----------------------------
   Load tiles (manifest + thumbs)
   ----------------------------- */
async function loadTiles() {
  tilePicker.textContent = "Loading tiles…";
  let entries = [];

  try {
    const r = await fetch("tiles/tiles.json");
    if (!r.ok) throw new Error(`tiles.json ${r.status}`);
    const manifest = await r.json();

    // Normalize
    entries = manifest.map(m => ({
      id: m.id,
      file: m.file,
      label: m.label ?? m.id,
      theme: m.theme ?? "light",
      stats: Object.assign({ flat:0, asc:0, desc:0, supply:0, cobb:0, slip:0 }, m.stats || {}),
      track: Array.isArray(m.track) ? m.track.slice() : []
    }));

  } catch (e) {
    console.error("Failed to load tiles.json.", e);
    tilePicker.textContent = "Failed to load tiles.";
    return;
  }

  tilePicker.textContent = "";

  const nodes = await Promise.all(entries.map(async (item) => {
    try {
      const res = await fetch(`tiles/${item.file}`);
      if (!res.ok) throw new Error(`${item.file} ${res.status}`);
      const svgText = await res.text();

      const wrapper = document.createElement("div");
      wrapper.className = "tile-thumb";
      wrapper.title = item.label;

      const thumb = stringToSVG(svgText);
      if (!thumb) throw new Error("SVG parse failed");
      thumb.addEventListener("click", () => placeTile(svgText, item));
      wrapper.appendChild(thumb);

      const label = document.createElement("div");
      label.className = `tile-label ${item.theme === "dark" ? "label-dark" : "label-light"}`;
      label.textContent = item.label;
      wrapper.appendChild(label);

      const counter = document.createElement("div");
      counter.className = "tile-counter";
      const baseId = item.id.replace(/-upp$/, "");
      counter.textContent = tileCounts[baseId] || 0;
      wrapper.appendChild(counter);

      tileCounterEls[item.id] = counter;
      return wrapper;
    } catch (err) {
      console.warn("Skipping broken tile:", item, err);
      return null;
    }
  }));

  nodes.forEach(n => n && tilePicker.appendChild(n));
}

/* -----------------------------
   Placement & snapping
   ----------------------------- */
function placeTile(svgText, itemMeta) {
  const baseId = itemMeta.id.replace(/-upp$/, "");
  tileCounts[baseId] = (tileCounts[baseId] || 0) + 1;
  const frontId = baseId, backId = baseId + "-upp";
  if (tileCounterEls[frontId]) tileCounterEls[frontId].textContent = tileCounts[baseId];
  if (tileCounterEls[backId])  tileCounterEls[backId].textContent  = tileCounts[baseId];

  const svg = stringToSVG(svgText);
  if (!svg) return;

  const prefix = `t${nextId++}-`;
  namespaceIds(svg, prefix);

  const socket = readSocket(svg, prefix);
  if (!socket) { console.warn("Tile missing entry/exit or dir markers; skipping."); return; }

  const goals = collectGoals(svg, prefix);

  const g = createGroup();
  g.setAttribute("data-prefix", prefix);
  g.appendChild(svg);

  let tx, ty, rot;

  if (placed.length === 0) {
    const cx = 2000, cy = 1500;
    rot = 0;
    const eRot = rotatePoint(socket.entry, rot);
    tx = cx - eRot.x; ty = cy - eRot.y;
  } else {
    const prev = placed[placed.length - 1];
    const prevExitGlobal = localToGlobal(prev, prev.socket.exit);
    const prevExitAngleGlobal = prev.rot + prev.socket.exitAngle;
    rot = prevExitAngleGlobal - socket.entryAngle;
    const thisEntryRot = rotatePoint(socket.entry, rot);
    tx = prevExitGlobal.x - thisEntryRot.x;
    ty = prevExitGlobal.y - thisEntryRot.y;
  }

  g.setAttribute("transform", `translate(${tx},${ty}) rotate(${toDeg(rot)})`);
  stageRoot.appendChild(g);

  // Label badge on stage (stays upright)
  let labelGroup = null;
  if (socket.center && itemMeta) {
    const pr = rotatePoint(socket.center, rot);
    const gx = tx + pr.x, gy = ty + pr.y;

    labelGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");

    const padding = 8, fontSize = 44;
    const textLen = itemMeta.label.length;
    const textWidth = textLen * fontSize * 0.6;
    const rectW = textWidth + padding * 2;
    const rectH = fontSize + padding * 2;

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", -rectW / 2);
    rect.setAttribute("y", -rectH / 2);
    rect.setAttribute("width", rectW);
    rect.setAttribute("height", rectH);
    rect.setAttribute("rx", 3);
    rect.setAttribute("ry", 3);
    rect.setAttribute("fill", itemMeta.theme === "dark" ? "#000" : "#fff");
    rect.setAttribute("stroke", itemMeta.theme === "dark" ? "#fff" : "#000");
    rect.setAttribute("stroke-width", 0.5);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", fontSize);
    text.setAttribute("y", fontSize / 3);
    text.setAttribute("fill", itemMeta.theme === "dark" ? "#fff" : "#000");
    text.setAttribute("font-family", "Oswald, sans-serif");
    text.setAttribute("font-weight", "600");
    text.textContent = itemMeta.label;

    labelGroup.appendChild(rect);
    labelGroup.appendChild(text);
    labelGroup.setAttribute("transform", `translate(${gx}, ${gy}) rotate(${-cameraRotation})`);
    labelLayer.appendChild(labelGroup);
  }

  placed.push({ g, prefix, tx, ty, rot, socket, goals, labelGroup, meta: itemMeta || null });
  updateCamera();
  Stage.emit();

  renderStats2FromStage({ placed });
  renderMetaFromStage({ placed });
}

/* -----------------------------
   Checkpoints
   ----------------------------- */
function onStageClickForCheckpoint(e) {
  if (!cpPickMode) return;
  const g = e.target.closest('g[data-prefix]');
  if (!g) return;

  const prefix = g.getAttribute("data-prefix");
  const tileIdx = placed.findIndex(p => p.prefix === prefix);
  if (tileIdx < 0) return;

  const tile = placed[tileIdx];
  const keys = Object.keys(tile.goals || {});
  if (!keys.length) { alert("That tile has no goal anchors."); return; }

  let key = keys[0];
  if (keys.length > 1) {
    const choose = prompt(`Choose goal key:\n${keys.join(", ")}`, keys[0]);
    if (!choose) return;
    if (!tile.goals[choose]) { alert("Not a valid key on this tile."); return; }
    key = choose;
  }

  addCheckpoint(tileIdx, key, cpPending.color, cpPending.label);
  cpPickMode = false;
  svgStage.style.cursor = "default";
}

function ensureCheckpointHaloFilter() {
  if (svgStage.querySelector("#cpHalo")) return;
  let defs = svgStage.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svgStage.prepend(defs);
  }
  const ns = "http://www.w3.org/2000/svg";
  const f = document.createElementNS(ns, "filter");
  f.setAttribute("id", "cpHalo");
  f.setAttribute("x", "-20%");
  f.setAttribute("y", "-20%");
  f.setAttribute("width", "140%");
  f.setAttribute("height", "140%");
  f.setAttribute("color-interpolation-filters", "sRGB");

  const morph = document.createElementNS(ns, "feMorphology");
  morph.setAttribute("in", "SourceAlpha");
  morph.setAttribute("operator", "dilate");
  morph.setAttribute("radius", "2");
  morph.setAttribute("result", "spread");

  const flood = document.createElementNS(ns, "feFlood");
  flood.setAttribute("flood-color", "#fff");
  flood.setAttribute("flood-opacity", "1");
  flood.setAttribute("result", "white");

  const halo = document.createElementNS(ns, "feComposite");
  halo.setAttribute("in", "white");
  halo.setAttribute("in2", "spread");
  halo.setAttribute("operator", "in");
  halo.setAttribute("result", "halo");

  const merge = document.createElementNS(ns, "feMerge");
  const n1 = document.createElementNS(ns, "feMergeNode"); n1.setAttribute("in", "halo");
  const n2 = document.createElementNS(ns, "feMergeNode"); n2.setAttribute("in", "SourceGraphic");
  merge.append(n1, n2);

  f.append(morph, flood, halo, merge);
  defs.appendChild(f);
}

function addCheckpoint(tileIdx, key, colorName, label) {
  const tile = placed[tileIdx];
  const pair = tile?.goals?.[key];
  if (!pair) return;

  const aG = localToGlobal(tile, pair.a);
  const bG = localToGlobal(tile, pair.b);
  const col = CP_COLORS[colorName] || CP_COLORS.red;

  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.classList.add("checkpoint");

  const core = document.createElementNS("http://www.w3.org/2000/svg", "g");
  core.setAttribute("filter", "url(#cpHalo)");
  g.appendChild(core);

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", aG.x); line.setAttribute("y1", aG.y);
  line.setAttribute("x2", bG.x); line.setAttribute("y2", bG.y);
  line.setAttribute("stroke", col);
  line.setAttribute("stroke-width", 8);
  line.setAttribute("stroke-linecap", "square");
  core.appendChild(line);

  const mid = { x: (aG.x + bG.x)/2, y: (aG.y + bG.y)/2 };
  const markerG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  markerG.setAttribute("transform", `translate(${mid.x}, ${mid.y})`);
  core.appendChild(markerG);

  const r = 32;
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("r", r);
  circle.setAttribute("cx", 0);
  circle.setAttribute("cy", 0);
  circle.setAttribute("fill", col);
  markerG.appendChild(circle);

  const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("font-size", 42);
  t.setAttribute("y", 16);
  t.setAttribute("fill", "#fff");
  t.setAttribute("font-weight", "600");
  t.setAttribute("font-family", FONT_OSWALD);
  t.textContent = (label || "A").toUpperCase().slice(0, 2);
  markerG.appendChild(t);

  checkpointLayer.appendChild(g);

  checkpoints.push({ g, tileIdx, key, aLocal: pair.a, bLocal: pair.b, color: colorName, label: t, markerG });
  updateCheckpointMarkers();
  Stage.emit();
}

function removeLastCheckpoint() {
  const last = checkpoints.pop();
  if (!last) return;
  last.g.remove();
  Stage.emit();
}

function updateCheckpointMarkers() {
  const angle = -cameraRotation;
  checkpoints.forEach(cp => {
    const tile = placed[cp.tileIdx];
    if (!tile) return;
    const aG = localToGlobal(tile, cp.aLocal);
    const bG = localToGlobal(tile, cp.bLocal);
    const mid = { x: (aG.x + bG.x)/2, y: (aG.y + bG.y)/2 };
    cp.markerG.setAttribute("transform", `translate(${mid.x}, ${mid.y}) rotate(${angle})`);
  });
}

/* -----------------------------
   Undo
   ----------------------------- */
function undo() {
  const last = placed.pop();
  if (!last) return;
  last.g.remove();
  if (last.labelGroup) last.labelGroup.remove();

  if (last.meta) {
    const baseId = last.meta.id.replace(/-upp$/, "");
    if (tileCounts[baseId] > 0) {
      tileCounts[baseId]--;
      const frontId = baseId, backId = baseId + "-upp";
      if (tileCounterEls[frontId]) tileCounterEls[frontId].textContent = tileCounts[baseId];
      if (tileCounterEls[backId])  tileCounterEls[backId].textContent  = tileCounts[baseId];
    }
  }
  updateCamera();
  Stage.emit();

  renderStats2FromStage({ placed });
  renderMetaFromStage({ placed });
}

/* -----------------------------
   SVG & Math helpers
   ----------------------------- */
function toDeg(rad){ return rad * 180 / Math.PI; }
function rotatePoint(p, rad){
  const c = Math.cos(rad), s = Math.sin(rad);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
function localToGlobal(item, point){
  const pr = rotatePoint(point, item.rot);
  return { x: item.tx + pr.x, y: item.ty + pr.y };
}
function createGroup(){ return document.createElementNS("http://www.w3.org/2000/svg", "g"); }
function stringToSVG(text){
  const div = document.createElement("div");
  div.innerHTML = text.trim();
  return div.querySelector("svg");
}

// Remove helper dots/lines so they never appear in export
function stripHelperMarkers(parent) {
  if (!parent) return;
  const sel = [
    '[id$="entry-point"]',
    '[id$="exit-point"]',
    '[id$="center-point"]',
    '[id$="entry-dir"]',
    '[id$="exit-dir"]',
    // goal anchors on placed tiles (after namespacing they start with tN-)
    '[id^="t"][id*="goal-"]'
  ].join(',');
  parent.querySelectorAll(sel).forEach(n => n.remove());
}

// Read entry/exit points + their tangent directions
function readSocket(svg, prefix) {
  const ep = svg.querySelector(`#${CSS.escape(prefix + "entry-point")}`);
  const xp = svg.querySelector(`#${CSS.escape(prefix + "exit-point")}`);
  const ed = svg.querySelector(`#${CSS.escape(prefix + "entry-dir")}`);
  const xd = svg.querySelector(`#${CSS.escape(prefix + "exit-dir")}`);
  const cp = svg.querySelector(`#${CSS.escape(prefix + "center-point")}`);
  if (!ep || !xp || !ed || !xd) return null;
  const entry    = getXY(ep);
  const exit     = getXY(xp);
  const entryDir = getXY(ed);
  const exitDir  = getXY(xd);
  const center   = cp ? getXY(cp) : null;
  const entryAngle = Math.atan2(entryDir.y - entry.y, entryDir.x - entry.x);
  const exitAngle  = Math.atan2(exitDir.y - exit.y,  exitDir.x - exit.x);
  return { entry, exit, entryAngle, exitAngle, center };
}
function getXY(el){
  if (el.hasAttribute("cx")) return { x:+el.getAttribute("cx"), y:+el.getAttribute("cy") };
  if (el.hasAttribute("x"))  return { x:+el.getAttribute("x"),  y:+el.getAttribute("y")  };
  if (el.hasAttribute("x1")) return { x:+el.getAttribute("x1"), y:+el.getAttribute("y1") };
  return { x:0, y:0 };
}
function collectGoals(svg, prefix) {
  const nodes = svg.querySelectorAll(`[id^="${CSS.escape(prefix + "goal-")}"]`);
  const pairs = {};
  nodes.forEach(node => {
    const id = node.id;
    const raw = id.slice(prefix.length + "goal-".length);
    const isB = raw.endsWith("b");
    const key = isB ? raw.slice(0, -1) : raw;
    const pt = getXY(node);
    if (!pairs[key]) pairs[key] = {};
    if (isB) pairs[key].b = pt; else pairs[key].a = pt;
  });
  Object.keys(pairs).forEach(k => { if (!pairs[k].a || !pairs[k].b) delete pairs[k]; });
  return pairs;
}
function namespaceIds(svg, prefix){
  const all = svg.querySelectorAll("[id]");
  all.forEach(el => {
    const old = el.id;
    el.id = prefix + old;

    const ATTRS = ["fill","stroke","filter","clip-path","mask","href","xlink:href"];
    const urlOld = `url(#${old})`;
    const urlNew = `url(#${el.id})`;
    const hashOld = `#${old}`;
    const hashNew = `#${el.id}`;

    svg.querySelectorAll("*").forEach(node => {
      for (const a of ATTRS) {
        if (!node.hasAttribute(a)) continue;
        const v = node.getAttribute(a);
        if (!v) continue;
        if (v.includes(urlOld)) node.setAttribute(a, v.replaceAll(urlOld, urlNew));
        if (v === hashOld)      node.setAttribute(a, hashNew);
      }
    });
  });
}

/* -----------------------------
   Meta (setup & counters)
   ----------------------------- */
function maxLengthForTileGoals(tile) {
  const keys = Object.keys(tile.goals || {});
  let maxNum = 0;
  for (const k of keys) {
    const n = parseInt(k, 10);
    if (!Number.isNaN(n)) maxNum = Math.max(maxNum, n);
  }
  if (maxNum >= 6) return 6;
  if (maxNum >= 3) return 3;
  if (maxNum >= 2) return 2;
  return 0;
}
function racingLengthForTile(tile) {
  const id = tile?.meta?.id || "";
  if (racingLenOne.has(id)) return 1;
  if (racingLenTwo.has(id)) return 2;
  return maxLengthForTileGoals(tile);
}
function computeMetrics(stage) {
  const placed = stage.placed || [];
  let long = 0, medium = 0, turns = 0, track = 0, racing = 0;
  for (const t of placed) {
    const len = maxLengthForTileGoals(t);
    if (len === 6) long++;
    else if (len === 3) medium++;
    else if (len === 2) turns++;
    track  += len;
    racing += racingLengthForTile(t);
  }
  return {
    total: placed.length,
    long, medium, turns, track, racing,
    setup: placed.map(t => ({
      label: (t.meta && t.meta.label) ? t.meta.label : (t.meta?.id || "?"),
      dark: (t.meta?.id || "").endsWith("-upp") || t.meta?.theme === "dark"
    }))
  };
}
function renderSetupBadgesFromMetrics(metrics) {
  if (!setupBadgesEl) return;
  setupBadgesEl.innerHTML = "";
  metrics.setup.forEach(s => {
    const badge = document.createElement("span");
    badge.className = "badge " + (s.dark ? "label-dark" : "label-light");
    badge.textContent = s.label;
    setupBadgesEl.appendChild(badge);
  });
}
function renderMetaFromStage(stageSnap) {
  const m = computeMetrics(stageSnap);
  if (cntTotalEl)  cntTotalEl.textContent  = m.total;
  if (cntLongEl)   cntLongEl.textContent   = m.long;
  if (cntMediumEl) cntMediumEl.textContent = m.medium;
  if (cntTurnsEl)  cntTurnsEl.textContent  = m.turns;
  if (cntTrackEl)  cntTrackEl.textContent  = m.track;
  if (cntRacingEl) cntRacingEl.textContent = m.racing;
  renderSetupBadgesFromMetrics(m);
}

/* -----------------------------
   Stage Stats 2 (sum from tiles)
   ----------------------------- */
function computeSquareTotals(stage) {
  const out = { flat:0, asc:0, desc:0, supply:0, cobb:0, slip:0 };
  const list = stage.placed || [];
  for (const t of list) {
    const s = t.meta?.stats;
    if (!s) continue;
    out.flat   += s.flat   || 0;
    out.asc    += s.asc    || 0;
    out.desc   += s.desc   || 0;
    out.supply += s.supply || 0;
    out.cobb   += s.cobb   || 0;
    out.slip   += s.slip   || 0;
  }
  return out;
}
function renderStats2FromStage(stageSnap) {
  const s = computeSquareTotals(stageSnap);
  if (elFlat)   elFlat.textContent   = s.flat;
  if (elAsc)    elAsc.textContent    = s.asc;
  if (elDesc)   elDesc.textContent   = s.desc;
  if (elSupply) elSupply.textContent = s.supply;
  if (elCobb)   elCobb.textContent   = s.cobb;
  if (elSlip)   elSlip.textContent   = s.slip;
}

/* -----------------------------
   Stage Profile (DOM + SVG)
   ----------------------------- */
const PROFILE_COLORS = {
  flat:   "#d9d9d9",
  asc:    "#ff0000",
  desc:   "#6169ff",
  supply: "#7ccbf3",
  cobb:   "#8c865b",
  slip:   "#580dd8",
  yellow: "#e6e142" // visual only; not counted as distance
};

let profile = null; // {root, svg, frame, gSeg, gMarkers, w, h}

function ensureStageProfileDOM() {
  if (profile) return profile;

  const host  = document.getElementById("stage-profile");
  const frame = host.querySelector(".sp-frame");
  const svg   = frame.querySelector("svg");

  const gSeg     = document.createElementNS(svg.namespaceURI, "g"); // colored segments
  const gMarkers = document.createElementNS(svg.namespaceURI, "g"); // markers & numbers
  svg.append(gSeg, gMarkers);

  profile = { root: host, frame, svg, gSeg, gMarkers, w: 800, h: 200 };

  // Measure the FRAME, not the svg
  const ro = new ResizeObserver(() => {
    const r = frame.getBoundingClientRect();
    profile.w = Math.max(320, r.width);
    profile.h = Math.max(140, r.height);
    renderStageProfile({ placed: Stage.placed, checkpoints: Stage.checkpoints });
  });
  ro.observe(frame);

  return profile;
}

// Helpers used by profile
function renderStageProfile(stageSnap) {
  ensureStageProfileDOM();
  const { svg, gSeg, gMarkers, w, h } = profile;

  gSeg.innerHTML = "";
  gMarkers.innerHTML = "";

  // Tiles that have a track
  const placedAll = stageSnap.placed || [];
  const tiles = [];
  const profileIndexByPlaced = new Map();
  placedAll.forEach((p, idx) => {
    const tr = p?.meta?.track;
    if (Array.isArray(tr) && tr.length) {
      profileIndexByPlaced.set(idx, tiles.length);
      tiles.push(p);
    }
  });

  if (!tiles.length) {
    const t = document.createElementNS(svg.namespaceURI, "text");
    t.setAttribute("x", w/2);
    t.setAttribute("y", h/2);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("class", "sp-text");
    t.setAttribute("font-family", FONT_OSWALD);
    t.setAttribute("font-weight", "600");
    t.textContent = "Place tiles to see profile";
    gMarkers.appendChild(t);
    return;
  }

  // Geometry inside the frame
  const INNER_PAD = 8;
  const innerW = Math.max(1, w - INNER_PAD*2);
  const innerH = Math.max(1, h - INNER_PAD*2);

  let xCursor = INNER_PAD;
  const clampX = x => Math.max(INNER_PAD, Math.min(INNER_PAD + innerW, x));

  // vertical band
  const yMin  = INNER_PAD + innerH * 0.18;
  const yMax  = INNER_PAD + innerH * 0.85;
  const bandH = yMax - yMin;

  // numbers baseline
  const countY = Math.min(INNER_PAD + innerH - 8, yMax + 30);
  const COUNT_NUM_OFFSET = 2;

  // spans per tile
  const totalLen = tiles.reduce((s,t)=> s + t.meta.track.length, 0) || 1;
  const spans = tiles.map(t => {
    const wTile = innerW * (t.meta.track.length / totalLen);
    const span = { x0: xCursor, x1: xCursor + wTile };
    xCursor += wTile;
    return span;
  });

  // steps and cumulative range
  const steps = [];
  tiles.forEach(t => t.meta.track.forEach(k => steps.push(k==="asc"?1 : k==="desc"?-1 : 0)));

  let acc=0, minAcc=0, maxAcc=0;
  for (const s of steps) {
    acc += s;
    if (acc < minAcc) minAcc = acc;
    if (acc > maxAcc) maxAcc = acc;
  }

  // fixed baseline + scaled rise
  const biasedBaseY = yMin + bandH * 0.8;
  const capAbove = Math.max(1, biasedBaseY - yMin);
  const capBelow = Math.max(1, yMax - biasedBaseY);
  const needAbove = Math.max(1, maxAcc);
  const needBelow = Math.max(1, Math.abs(Math.min(0, minAcc)));
  const maxRisePerStep = bandH / 30;
  const rise = Math.min(capAbove / needAbove, capBelow / needBelow, maxRisePerStep);

  let y = biasedBaseY;

  // flatten to straight segments
  const flat = [];
  tiles.forEach((tile, ti) => {
    const track = tile.meta.track;
    const span  = spans[ti];
    const k = track.length;

    for (let i = 0; i < k; i++) {
      const kind = track[i];
      const x0 = span.x0 + (i / k)     * (span.x1 - span.x0);
      const x1 = span.x0 + ((i+1) / k) * (span.x1 - span.x0);
      const y0 = y;

      let y1 = y0;
      if (kind === "asc")  y1 = y0 - rise;  // up = smaller y
      if (kind === "desc") y1 = y0 + rise;  // down = larger y

      if (y1 < yMin) y1 = yMin;
      if (y1 > yMax) y1 = yMax;

      y = y1;
      flat.push({ tileIdx: ti, idxInTile: i, kind, x0, x1, y0, y1 });
    }
  });

  // counts (non-yellow)
  const totalSquares = flat.reduce((a, s) => a + (s.kind === "yellow" ? 0 : 1), 0);
  const cum = new Array(flat.length + 1).fill(0);
  for (let i = 0; i < flat.length; i++) {
    cum[i + 1] = cum[i] + (flat[i].kind === "yellow" ? 0 : 1);
  }

  // Catmull–Rom -> Bezier smoothing
  const knots = [];
  if (flat.length){
    knots.push({ x: flat[0].x0, y: flat[0].y0 });
    flat.forEach(s => knots.push({ x: s.x1, y: s.y1 }));
  }

  function bezierSegmentsFromKnots(pts){
    const n = pts.length - 1;
    const segs = [];
    if (n <= 0) return segs;
    for (let i=0; i<n; i++){
      const p0 = pts[Math.max(0, i-1)];
      const p1 = pts[i];
      const p2 = pts[i+1];
      const p3 = pts[Math.min(n, i+2)];
      const c1 = { x: p1.x + (p2.x - p0.x)/6, y: p1.y + (p2.y - p0.y)/6 };
      const c2 = { x: p2.x - (p3.x - p1.x)/6, y: p2.y - (p3.y - p1.y)/6 };
      c1.y = Math.min(yMax, Math.max(yMin, c1.y));
      c2.y = Math.min(yMax, Math.max(yMin, c2.y));
      segs.push({ p1, p2, c1, c2 });
    }
    return segs;
  }
  const beziers = bezierSegmentsFromKnots(knots);

  function evalYAtX(x){
    if (!beziers.length) return biasedBaseY;
    let s = beziers.findIndex(b => x >= b.p1.x && x <= b.p2.x);
    if (s < 0) s = (x < beziers[0].p1.x) ? 0 : beziers.length - 1;
    const b = beziers[s];
    const t = (b.p2.x === b.p1.x) ? 0 : (x - b.p1.x) / (b.p2.x - b.p1.x);
    const mt = 1 - t;
    const y =
      mt*mt*mt * b.p1.y +
      3*mt*mt*t * b.c1.y +
      3*mt*t*t * b.c2.y +
      t*t*t * b.p2.y;
    return Math.min(yMax, Math.max(yMin, y));
  }

  // green fill to the number baseline
  if (flat.length){
    const N = 8;
    let d = "";
    flat.forEach((seg, si) => {
      for (let j=0; j<=N; j++){
        const x = seg.x0 + (j/N) * (seg.x1 - seg.x0);
        const y = evalYAtX(x);
        d += (si===0 && j===0) ? `M ${x} ${y}` : ` L ${x} ${y}`;
      }
    });
    const lastX  = flat.at(-1).x1;
    const firstX = flat[0].x0;
    d += ` L ${lastX} ${countY} L ${firstX} ${countY} Z`;

    const area = document.createElementNS(svg.namespaceURI, "path");
    area.setAttribute("d", d);
    area.setAttribute("fill", "#8FD57D");
    area.setAttribute("fill-opacity", "0.80");
    gSeg.appendChild(area);
  }

  // colored line on top
  const strokeW = 4;
  flat.forEach(seg => {
    const N = 8;
    let d = "";
    for (let j=0; j<=N; j++){
      const x = seg.x0 + (j/N) * (seg.x1 - seg.x0);
      const y = evalYAtX(x);
      d += (j===0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
    }
    const p = document.createElementNS(svg.namespaceURI,"path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", PROFILE_COLORS[seg.kind] || "#000");
    p.setAttribute("stroke-width", String(strokeW));
    p.setAttribute("stroke-linecap","round");
    p.setAttribute("stroke-linejoin","round");
    gSeg.appendChild(p);
  });

  // bottom baseline for the numbers
  const base = document.createElementNS(svg.namespaceURI, "line");
  base.setAttribute("x1", INNER_PAD);
  base.setAttribute("x2", INNER_PAD + innerW);
  base.setAttribute("y1", countY);
  base.setAttribute("y2", countY);
  base.setAttribute("stroke", "#000");
  base.setAttribute("stroke-width", "0.5");
  base.setAttribute("stroke-opacity", "0.25");
  gMarkers.appendChild(base);

  // markers & counts
  const markersForNumbers = []; // { x, count, kind }

  function marker(x, label, count, color, isStartFinish = false) {
    const DROP_GAP = 14; // gap so dotted line doesn't touch the number
    x = clampX(x);

    const yCurve = evalYAtX(x);
    const leaderTopY = yCurve - 26;
    const dotY = leaderTopY - 6;

    // short solid leader up to the curve
    const leader = document.createElementNS(svg.namespaceURI, "line");
    leader.setAttribute("x1", x); leader.setAttribute("x2", x);
    leader.setAttribute("y1", leaderTopY); leader.setAttribute("y2", yCurve);
    leader.setAttribute("stroke", "#000");
    leader.setAttribute("stroke-width", "1");
    gMarkers.appendChild(leader);

    // dotted drop down toward the baseline
    const drop = document.createElementNS(svg.namespaceURI, "line");
    drop.setAttribute("x1", x); drop.setAttribute("x2", x);
    drop.setAttribute("y1", yCurve); drop.setAttribute("y2", countY - DROP_GAP);
    drop.setAttribute("stroke", "#000");
    drop.setAttribute("stroke-width", "0.8");
    drop.setAttribute("stroke-dasharray", "2 3");
    drop.setAttribute("stroke-linecap", "round");
    gMarkers.appendChild(drop);

    // circle
    const circle = document.createElementNS(svg.namespaceURI, "circle");
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", dotY);
    circle.setAttribute("r", "10");
    circle.setAttribute("fill", isStartFinish ? "#e6e142" : (color || "#000"));
    gMarkers.appendChild(circle);

    // label inside the circle
    const tt = document.createElementNS(svg.namespaceURI, "text");
    tt.setAttribute("x", x);
    tt.setAttribute("y", dotY);
    tt.setAttribute("text-anchor", "middle");
    tt.setAttribute("alignment-baseline", "middle");
    tt.setAttribute("dominant-baseline", "middle");
    tt.setAttribute("dy", "0.1em");
    tt.setAttribute("fill", "#fff");
    tt.setAttribute("font-weight", "600");
    tt.setAttribute("font-family", FONT_OSWALD);
    tt.setAttribute("font-size", "14");
    tt.textContent = label;
    gMarkers.appendChild(tt);

    markersForNumbers.push({ x, count, kind: isStartFinish ? "sf" : "cp" });
  }

  // first/last non-yellow are start/finish
  let startIdx = flat.findIndex(s => s.kind !== "yellow"); if (startIdx < 0) startIdx = 0;
  let finishIdx = flat.length - 1;
  for (let i = flat.length - 1; i >= 0; i--) { if (flat[i].kind !== "yellow") { finishIdx = i; break; } }

  const startX  = clampX(flat[startIdx].x0);
  const finishX = clampX(flat[finishIdx].x1);

  marker(startX,  "S", 0, null, true);
  marker(finishX, "F", totalSquares, null, true);

  // checkpoints
  (stageSnap.checkpoints || []).forEach(cp => {
    const profIdx = profileIndexByPlaced.get(cp.tileIdx);
    if (profIdx === undefined) return;

    const tile = tiles[profIdx];
    const span = spans[profIdx];

    // project checkpoint onto tile chord
    const a = cp.aLocal, b = cp.bLocal;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const A = tile.socket.entry, B = tile.socket.exit;
    const vx = B.x - A.x, vy = B.y - A.y, wx = mid.x - A.x, wy = mid.y - A.y;
    const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / (vx * vx + vy * vy || 1)));
    const x = clampX(span.x0 + t * (span.x1 - span.x0));

    // count of non-yellow squares before this x
    let idx = flat.findIndex(s => x >= s.x0 && x <= s.x1);
    if (idx < 0) idx = (x < flat[0].x0) ? 0 : flat.length - 1;
    const countAtX = cum[idx];

    const color = CP_COLORS[cp.color] || CP_COLORS.red;
    const label = (cp.label?.textContent || cp.label || "A").toString().slice(0, 2);
    marker(x, label, countAtX, color, false);
  });

  // print each bottom number ONCE
  const perCount = new Map(); // count -> { x, display, priority }
  for (const m of markersForNumbers) {
    const priority = (m.kind === "sf") ? 2 : 1;
    const display  = (m.kind === "sf") ? m.count : (m.count + 1); // +1 ONLY for checkpoints
    const current  = perCount.get(m.count);
    if (!current || priority > current.priority || (priority === current.priority && m.x < current.x)) {
      perCount.set(m.count, { x: m.x, display, priority });
    }
  }

  [...perCount.values()]
    .sort((a, b) => a.x - b.x)
    .forEach(({ x, display }) => {
      const ct = document.createElementNS(svg.namespaceURI, "text");
      ct.setAttribute("x", x);
      ct.setAttribute("y", countY - COUNT_NUM_OFFSET);
      ct.setAttribute("text-anchor", "middle");
      ct.setAttribute("class", "sp-count");
      ct.setAttribute("fill", "#000");
      ct.setAttribute("font-size", "13");
      ct.setAttribute("font-weight", "600");
      ct.setAttribute("font-family", FONT_OSWALD);
      ct.textContent = String(display);
      gMarkers.appendChild(ct);
    });
}

/* -----------------------------
   Download modal & export
   ----------------------------- */
function setupDownloadModal(){
  if (_dlInited) return;   // already wired
  const btn = document.getElementById('btn-download');
  if (!btn) return;

  // Enable the button in the UI
  btn.removeAttribute('disabled');
  btn.title = '';

  const modal = document.getElementById('dl-modal');
  const cvs   = document.getElementById('dl-canvas');
  const bgSel = document.getElementById('dl-bg');
  const bChk  = document.getElementById('dl-border');
  const cancel= document.getElementById('dl-cancel');
  const down  = document.getElementById('dl-download');

  // Optional modules toggles
  const modPoints = document.getElementById('dl-mod-points');
  const modProfile= document.getElementById('dl-mod-profile');
  const modStats  = document.getElementById('dl-mod-stats');

  // Banner type options (already added)
  const typeEnable = document.getElementById('dl-type-enable');
  const typeTextInp= document.getElementById('dl-type-text');
  const typeIconSel= document.getElementById('dl-type-icon');

  const opts = {
    bg: 'cream',
    border: false,
    // banner type
    typeEnabled: false, typeText: '', typeIcon: '',
    // modules
    modPoints: false,
    modProfile: false,
    modStats: false,
  };

  async function refresh(){
    try {
      opts.bg     = bgSel.value;
      opts.border = !!bChk.checked;

      // banner type
      opts.typeEnabled = !!typeEnable.checked;
      opts.typeText    = (typeTextInp.value || '').trim();
      opts.typeIcon    = typeIconSel.value || '';

      // module toggles
      opts.modPoints  = !!(modPoints  && modPoints.checked);
      opts.modProfile = !!(modProfile && modProfile.checked);
      opts.modStats   = !!(modStats   && modStats.checked);

      await renderDownloadPreview(cvs, opts, /* includeSetup */ true);
    } catch (err) {
      console.error('Preview failed:', err);
      const ctx = cvs.getContext('2d');
      cvs.width = 800; cvs.height = 400;
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,cvs.width,cvs.height);
      ctx.fillStyle = '#b00'; ctx.font = '700 18px Oswald, sans-serif';
      ctx.fillText('Preview failed — see console', 20, 30);
    }
  }

  const show = () => {
    modal.hidden = false;
    const on = !!(typeEnable && typeEnable.checked);
    if (typeTextInp) typeTextInp.disabled = !on;
    if (typeIconSel) typeIconSel.disabled = !on;
    refresh();
  };
  const hide = () => { modal.hidden = true;  };

  btn.addEventListener('click', show);
  [bChk, typeEnable, modPoints, modProfile, modStats]
    .forEach(el => el && el.addEventListener('change', refresh));
  [bgSel, typeTextInp, typeIconSel]
    .forEach(el => el && el.addEventListener('input', refresh));
  typeEnable && typeEnable.addEventListener('change', () => {
    const on = !!typeEnable.checked;
    typeTextInp.disabled = !on;
    typeIconSel.disabled = !on;
    refresh();
  });
  cancel && cancel.addEventListener('click', hide);

  down && down.addEventListener('click', async () => {
    try {
      await renderDownloadPreview(cvs, opts, true);
      await saveCanvasAsPng(cvs, Stage.name || 'Stage');
    } catch (err1) {
      console.warn('Export failed (with setup); retrying without setup…', err1);
      try {
        await renderDownloadPreview(cvs, opts, false);
        await saveCanvasAsPng(cvs, Stage.name || 'Stage');
      } catch (err2) {
        console.error('Download failed on both attempts:', err2);
        alert('Download failed. Check the console for details.');
      }
    }
  });
  _dlInited = true;
}

/* ---- Export layout constants ---- */
const DL_P          = 12;   // outer page padding
const DL_GAP        = 8;    // default gap between modules
const DL_GAP_AFTER_SETUP = 8; // extra air before the Stage Profile
const DL_DIVIDER_PAD = 10; // space around the divider line

const DL_BANNER_H   = 44;   // banner height
const DL_STAGE_H    = 300;  // fixed “The Stage”
const DL_STAGE_PAD  = 8;    // inner padding inside the stage block

// Optional module heights
const DL_PROFILE_H  = 160;  // fixed slot for the profile image
const DL_PROFILE_TITLE_GAP = 18; // space reserved above the image for the title
const DL_STATS_H    = 28;   // single compact row (now houses Stage Points + Stage Stats)

/* -----------------------------
   Export rendering (modules)
   ----------------------------- */
async function renderDownloadPreview(canvas, options, includeSetup = true){
  await ensureExportFonts();

  const W = 560;
  const contentW = W - DL_P*2;

  // Stage snapshot first
  const stageSnap = await snapshotStageAsImageCROPPED();

  // Stage Setup metrics
  let setupRowMetrics = null;
  let setupRowH = 0;
  if (includeSetup) {
    setupRowMetrics = measureSetupRow(W);
    setupRowH = setupRowMetrics ? setupRowMetrics.rowH : 0;
  }

  // Modules (in order)
  const modules = [];

  // 1) Banner
  modules.push({
    id: 'banner',
    h: DL_BANNER_H,
    async draw(ctx, y){
      const red = getComputedStyle(document.documentElement).getPropertyValue('--fr-red').trim() || '#b22222';
      ctx.fillStyle = red;
      ctx.fillRect(DL_P, y, contentW, DL_BANNER_H);

      ctx.fillStyle = '#fff';
      ctx.font = '700 24px Oswald, sans-serif';
      ctx.textBaseline = 'middle';

      const midY = y + DL_BANNER_H/2;
      const pad = 14;

      if (options.typeEnabled && ((options.typeText && options.typeText.length) || (options.typeIcon && options.typeIcon.length))) {
        ctx.textAlign = 'left';
        ctx.fillText(Stage.name || 'Custom Stage', DL_P + pad, midY);

        const typeStr = (options.typeText || '').trim();
        const iconStr = (options.typeIcon || '');
        const fullType = typeStr + (iconStr ? ' ' + iconStr : '');
        ctx.textAlign = 'right';
        ctx.fillText(fullType, DL_P + contentW - pad, midY);
      } else {
        ctx.textAlign = 'center';
        ctx.fillText(Stage.name || 'Custom Stage', DL_P + contentW/2, midY);
      }
    }
  });

  // 2) The Stage (always)
  modules.push({
    id: 'stage',
    h: DL_STAGE_H + DL_DIVIDER_PAD,
    async draw(ctx, y){
      const blockX = DL_P;
      const blockW = contentW;
      const targetW = blockW - DL_STAGE_PAD*2;
      const targetH = DL_STAGE_H - DL_STAGE_PAD*2;

      const iw = stageSnap.img.width;
      const ih = stageSnap.img.height;
      const scale = Math.min(targetW / iw, targetH / ih);
      const drawW = Math.round(iw * scale);
      const drawH = Math.round(ih * scale);

      const dx = blockX + DL_STAGE_PAD + Math.floor((targetW - drawW)/2);
      const dy = y      + DL_STAGE_PAD + Math.floor((targetH - drawH)/2);
      ctx.drawImage(stageSnap.img, dx, dy, drawW, drawH);

      // divider between Stage and Setup (only when Setup is shown)
      if (includeSetup) {
        ctx.beginPath();
        const divY = y + DL_STAGE_H + DL_DIVIDER_PAD/2;
        ctx.moveTo(DL_P, divY);
        ctx.lineTo(DL_P + contentW, divY);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  });

  // 3) Stage Setup
  if (includeSetup && setupRowMetrics){
    modules.push({
      id: 'setup',
      h: setupRowH + DL_GAP_AFTER_SETUP,
      async draw(ctx, y){
        drawSetupRow(ctx, y, W, setupRowMetrics);
      }
    });
  }

  // 4) Stage Profile (optional) — scale uniformly, keep aspect ratio
  let profileSnap = null;
  if (options.modProfile){
    profileSnap = await snapshotStageProfileSVGAsImage(contentW);
  }

  const DL_PROFILE_SCALE = 0.90; // draw at 90% of the available width

  if (options.modProfile && profileSnap){
    // scale width, then derive height from the image's native ratio
    const profileDrawW = Math.round(contentW * DL_PROFILE_SCALE);
    const profileDrawH = Math.round(profileSnap.h * (profileDrawW / profileSnap.w));

    modules.push({
      id: 'profile',
      h: profileDrawH,
      async draw(ctx, y){
        // center horizontally inside the content area
        const dx = DL_P + Math.round((contentW - profileDrawW) / 2);
        ctx.drawImage(profileSnap.img, dx, y, profileDrawW, profileDrawH);
      }
    });
  }

  // 5) Combined row (Points + Stats) — now BELOW the profile
  const showPoints = !!options.modPoints;
  const showStats  = !!options.modStats;
  if (showPoints || showStats){
    modules.push({
      id: 'statsRow',
      h: DL_STATS_H,
      async draw(ctx, y){
        const rowY = y + DL_STATS_H/2;

        // measure helper
        function m(txt, font){
          const prev = ctx.font;
          ctx.font = font;
          const w = ctx.measureText(String(txt)).width;
          ctx.font = prev;
          return w;
        }

        // Points group
        const DOT_W_P = 18;
        const GAP_LBL = 4;
        const GAP_VAL = 8;

        let sprintLabelW = 0, komLabelW = 0, sprintValW = 0, komValW = 0, ptsW = 0;
        if (showPoints){
          sprintLabelW = m('Sprint Points', '600 14px Oswald, sans-serif');
          komLabelW    = m('KOM Points',    '600 14px Oswald, sans-serif');
          sprintValW   = m(stageSprintPoints, '700 14px Oswald, sans-serif');
          komValW      = m(stageKOMPoints,    '700 14px Oswald, sans-serif');
          ptsW = DOT_W_P + sprintLabelW + GAP_LBL + sprintValW
              + GAP_VAL
              + DOT_W_P + komLabelW + GAP_LBL + komValW;
        }

        // Stats group
        let statsW = 0;
        const items = showStats ? (() => {
          const s = computeSquareTotals(Stage);
          return [
            { color:'#d9d9d9', val:s.flat  },
            { color:'#ff0000', val:s.asc   },
            { color:'#6169ff', val:s.desc  },
            { color:'#7ccbf3', val:s.supply},
            { color:'#8c865b', val:s.cobb  },
            { color:'#580dd8', val:s.slip  },
          ];
        })() : [];

        const title = showStats ? 'Stage Stats:' : '';
        const titleW = showStats ? m(title, '700 14px Oswald, sans-serif') : 0;
        const DOT_W_S = 16;
        if (showStats){
          statsW = titleW + 12;
          items.forEach((it, i) => {
            statsW += DOT_W_S + m(it.val, '600 14px Oswald, sans-serif') + (i < items.length-1 ? 10 : 0);
          });
        }

        const GROUP_GAP = (showPoints && showStats) ? 28 : 0;
        const rowW = ptsW + GROUP_GAP + statsW;
        let x = DL_P + Math.round((contentW - rowW)/2);

        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#000';

        // Points
        if (showPoints){
          // Sprint dot
          ctx.beginPath(); ctx.arc(x + 8, rowY - 2, 7, 0, Math.PI*2);
          ctx.fillStyle = '#6bbf59'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
          x += DOT_W_P;

          // Sprint label + value
          ctx.font = '600 14px Oswald, sans-serif';
          ctx.fillStyle = '#000';
          ctx.fillText('Sprint Points', x, rowY); x += sprintLabelW + GAP_LBL;
          ctx.font = '700 14px Oswald, sans-serif';
          ctx.fillText(String(stageSprintPoints ?? 0), x, rowY); x += sprintValW + GAP_VAL;

          // KOM dot
          ctx.beginPath(); ctx.arc(x + 8, rowY - 2, 7, 0, Math.PI*2);
          ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
          ctx.beginPath(); ctx.arc(x + 8, rowY - 2, 2.5, 0, Math.PI*2); ctx.fillStyle = '#f8333c'; ctx.fill();
          x += DOT_W_P;

          // KOM label + value
          ctx.font = '600 14px Oswald, sans-serif';
          ctx.fillStyle = '#000';
          ctx.fillText('KOM Points', x, rowY); x += komLabelW + GAP_LBL;
          ctx.font = '700 14px Oswald, sans-serif';
          ctx.fillText(String(stageKOMPoints ?? 0), x, rowY); x += komValW;
        }

        if (showPoints && showStats) x += GROUP_GAP;

        // Stats
        if (showStats){
          ctx.font = '700 14px Oswald, sans-serif';
          ctx.fillStyle = '#000';
          ctx.fillText(title, x, rowY);
          x += titleW + 12;

          ctx.font = '600 14px Oswald, sans-serif';
          items.forEach((it, idx) => {
            ctx.beginPath(); ctx.arc(x + 7, rowY - 2, 6, 0, Math.PI*2);
            ctx.fillStyle = it.color; ctx.fill();
            ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
            x += DOT_W_S;

            const txt = String(it.val ?? 0);
            ctx.fillStyle = '#000';
            ctx.fillText(txt, x, rowY);
            x += ctx.measureText(txt).width;

            if (idx < items.length - 1) x += 8;
          });
        }
      }
    });
}

  // Canvas height
  let H = DL_P;
  modules.forEach((m, i) => { H += m.h; if (i < modules.length - 1) H += DL_GAP; });
  H += DL_P;
  if (options.border) H += 2;

  // Draw
  canvas.width  = W;
  canvas.height = Math.round(H);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Background
  if (options.bg !== 'transparent') {
    const cream = getComputedStyle(document.documentElement).getPropertyValue('--fr-cream').trim() || '#f9f5e3';
    ctx.fillStyle = (options.bg === 'cream') ? cream : '#ffffff';
    ctx.fillRect(0,0,canvas.width, canvas.height);
  }

  // Pass
  let y = DL_P;
  for (let i=0; i<modules.length; i++){
    await modules[i].draw(ctx, y);
    y += modules[i].h;
    if (i < modules.length - 1) y += DL_GAP;
  }

  if (options.border) {
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W-1, canvas.height-1);
  }
}

/* ---------- Stage Setup row: measure & draw ---------- */

// ---- Stage Setup badge "design tokens" (export) ----
const SETUP_FS      = 14; // badge text size
const SETUP_PAD_X   = 3;
const SETUP_PAD_Y   = 5;
const SETUP_GAP     = 1;
const SETUP_LABEL   = 'Stage Setup:';
const SETUP_LABEL_G = 12;

// Returns { rowH, startX, labelW, badges:[{label,dark,w,h}] }
function measureSetupRow(totalW){
  const m = computeMetrics(Stage);
  const badges = (m.setup || []).map(b => ({ label: b.label, dark: !!b.dark }));
  if (!badges.length) return null;

  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  x.font = `600 ${SETUP_FS}px Oswald, sans-serif`;

  const labelW = Math.ceil(x.measureText(SETUP_LABEL).width);

  const measured = badges.map(b => {
    const tw = x.measureText(b.label).width;
    const w  = Math.ceil(tw + SETUP_PAD_X*2);
    const h  = Math.ceil(SETUP_FS + SETUP_PAD_Y*2);
    return Object.assign({}, b, { w, h });
  });

  const badgesW  = measured.reduce((s,b)=> s + b.w, 0) + SETUP_GAP * Math.max(0, measured.length - 1);
  const rowH     = measured.length ? measured[0].h : (SETUP_FS + SETUP_PAD_Y*2);
  const contentW = totalW - DL_P*2;
  const totalRowW= labelW + SETUP_LABEL_G + badgesW;
  const startX   = DL_P + Math.max(0, Math.round((contentW - totalRowW) / 2));

  return { rowH, startX, labelW, badges: measured };
}

function drawSetupRow(ctx, y, totalW, m){
  const { rowH, startX, labelW, badges } = m;
  ctx.textBaseline = 'middle';

  // Label
  ctx.font = `600 ${SETUP_FS}px Oswald, sans-serif`;
  ctx.fillStyle = '#000';
  ctx.textAlign = 'left';
  const labelY = y + Math.round(rowH/2);
  ctx.fillText(SETUP_LABEL, startX, labelY);

  // Badges
  let bx = startX + labelW + SETUP_LABEL_G;
  badges.forEach(b => {
    ctx.fillStyle = b.dark ? '#000' : '#fff';
    ctx.fillRect(bx, y, b.w, rowH);
    ctx.strokeStyle = b.dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, y + 0.5, b.w - 1, rowH - 1);

    ctx.font = `600 ${SETUP_FS}px Oswald, sans-serif`;
    ctx.fillStyle = b.dark ? '#fff' : '#000';
    ctx.textAlign = 'center';
    ctx.fillText(b.label, bx + b.w/2, y + rowH/2);

    bx += b.w + SETUP_GAP;
  });
}

/* ----------------------------
   Fonts for canvas & SVG image
   ---------------------------- */
async function ensureExportFonts(){
  try {
    await Promise.all([
      document.fonts.load(`700 24px "Oswald"`),   // banner
      document.fonts.load(`700 16px "Oswald"`),   // profile title
      document.fonts.load(`700 14px "Oswald"`),   // bold numbers/titles
      document.fonts.load(`600 14px "Oswald"`),   // rows
      document.fonts.load(`600 ${SETUP_FS}px "Oswald"`), // badges
      // Inter for tiny labels & numbers
      document.fonts.load(`600 11px "Oswald"`),
      document.fonts.load(`600 13px "Oswald"`),
      document.fonts.load(`700 42px "Oswald"`),
      document.fonts.ready
    ]);
  } catch (_) {}
}

/* Cache for embedded @font-face CSS (kept in case you snapshot other DOM later) */
let _embeddedOswaldCSS = null;

async function getEmbeddedOswaldCSS(){
  if (_embeddedOswaldCSS) return _embeddedOswaldCSS;
  try {
    const cssURL = 'https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&display=swap';
    const css = await (await fetch(cssURL, { mode: 'cors', credentials: 'omit' })).text();
    const urlRe = /url\((https:[^)]+\.woff2)\)/g;
    let out = css;
    const seen = new Set();
    const tasks = [];
    let m;
    while ((m = urlRe.exec(css))){
      const fontURL = m[1];
      if (seen.has(fontURL)) continue;
      seen.add(fontURL);
      tasks.push((async () => {
        const ab = await (await fetch(fontURL, { mode: 'cors', credentials: 'omit' })).arrayBuffer();
        const b64 = arrayBufferToBase64(ab);
        out = out.replaceAll(fontURL, `data:font/woff2;base64,${b64}`);
      })());
    }
    await Promise.all(tasks);
    _embeddedOswaldCSS = out;
  } catch (e) {
    _embeddedOswaldCSS = `/* fallback */`;
  }
  return _embeddedOswaldCSS;
}

let _embeddedInterCSS = null;
async function getEmbeddedInterCSS(){
  if (_embeddedInterCSS) return _embeddedInterCSS;
  try {
    // Inter with useful weights; you can add others if needed
    const cssURL = 'https://fonts.googleapis.com/css2?family=Inter:wght@600;700&display=swap';
    const css = await (await fetch(cssURL, { mode:'cors', credentials:'omit' })).text();
    const urlRe = /url\((https:[^)]+\.woff2)\)/g;
    let out = css;
    const seen = new Set();
    const tasks = [];
    let m;
    while ((m = urlRe.exec(css))) {
      const fontURL = m[1];
      if (seen.has(fontURL)) continue;
      seen.add(fontURL);
      tasks.push((async () => {
        const ab = await (await fetch(fontURL, { mode:'cors', credentials:'omit' })).arrayBuffer();
        const b64 = arrayBufferToBase64(ab);
        out = out.replaceAll(fontURL, `data:font/woff2;base64,${b64}`);
      })());
    }
    await Promise.all(tasks);
    _embeddedInterCSS = out;
  } catch {
    _embeddedInterCSS = `/* fallback: Inter not embedded */`;
  }
  return _embeddedInterCSS;
}

function arrayBufferToBase64(buf){
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

/* -----------------------------
   Stage snapshot (SVG -> image)
   ----------------------------- */

// Snapshot the stage, preserving camera rotation/zoom, and crop tightly.
async function snapshotStageAsImageCROPPED() {
  const src = document.getElementById('build-area');
  if (!src) throw new Error('SVG #build-area not found');

  const clone = src.cloneNode(true);

  // Hide helpers + keep Oswald
  const ns = 'http://www.w3.org/2000/svg';
  const style = document.createElementNS(ns, 'style');
  style.textContent = `
    text, tspan { font-family: 'Oswald', sans-serif;}
    [id$="entry-point"],
    [id$="exit-point"],
    [id$="center-point"],
    [id$="entry-dir"],
    [id$="exit-dir"],
    [id^="t"][id*="goal-"] { opacity:0 !important; pointer-events:none !important; }
  `;
  clone.appendChild(style);
  // Embed @font-face so the SVG rasterizes with Inter
  const ff = document.createElementNS(ns, 'style');
  ff.textContent = await getEmbeddedOswaldCSS();
  clone.prepend(ff);

  // Mount off-screen so getBBox/getScreenCTM are valid
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-100000px';
  host.style.top  = '0';
  document.body.appendChild(host);
  host.appendChild(clone);

  // Give Chrome one frame to settle layout
  await new Promise(r => requestAnimationFrame(r));

  const outer = clone;
  const cam   = clone.querySelector('#camera');
  if (!cam) throw new Error('No #camera in stage');

  const nodes = [
    ...cam.querySelectorAll('#stage-root g[data-prefix] > svg'),
    ...cam.querySelectorAll('#label-layer > g'),
    ...cam.querySelectorAll('#checkpoint-layer > g')
  ];

  let minX =  Infinity, minY =  Infinity, maxX = -Infinity, maxY = -Infinity;

  function growByNode(n) {
    if (!n) return;
    let bb;
    try { bb = n.getBBox(); } catch { return; }
    if (!bb || !isFinite(bb.width) || !isFinite(bb.height)) return;

    const sctmNode  = n.getScreenCTM?.();
    const sctmOuter = outer.getScreenCTM?.();
    if (!sctmNode || !sctmOuter) return;

    const toOuter = sctmOuter.inverse().multiply(sctmNode);

    const corners = [
      { x: bb.x,             y: bb.y },
      { x: bb.x + bb.width,  y: bb.y },
      { x: bb.x + bb.width,  y: bb.y + bb.height },
      { x: bb.x,             y: bb.y + bb.height }
    ];
    for (const p of corners) {
      const X = toOuter.a * p.x + toOuter.c * p.y + toOuter.e;
      const Y = toOuter.b * p.x + toOuter.d * p.y + toOuter.f;
      if (X < minX) minX = X;
      if (Y < minY) minY = Y;
      if (X > maxX) maxX = X;
      if (Y > maxY) maxY = Y;
    }
  }

  nodes.forEach(growByNode);

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    try {
      const bb = cam.getBBox();
      minX = bb.x; minY = bb.y; maxX = bb.x + bb.width; maxY = bb.y + bb.height;
    } catch {
      const vb = (outer.getAttribute('viewBox') || '0 0 4000 3000').trim().split(/\s+/).map(Number);
      minX = vb[0]; minY = vb[1]; maxX = vb[0] + vb[2]; maxY = vb[1] + vb[3];
    }
  }

  const PAD = 12;
  const vbX = Math.floor(minX) - PAD;
  const vbY = Math.floor(minY) - PAD;
  const vbW = Math.max(1, Math.ceil(maxX - minX) + PAD*2);
  const vbH = Math.max(1, Math.ceil(maxY - minY) + PAD*2);

  outer.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  outer.setAttribute('width',  vbW);
  outer.setAttribute('height', vbH);

  const xml  = new XMLSerializer().serializeToString(outer);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);

  let img;
  try {
    const bmp = await createImageBitmap(blob);
    const cnv = document.createElement('canvas');
    cnv.width = bmp.width; cnv.height = bmp.height;
    cnv.getContext('2d').drawImage(bmp, 0, 0);
    img = new Image();
    img.src = cnv.toDataURL('image/png');
    await new Promise(r => (img.onload = r, img.onerror = r));
  } catch {
    img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload  = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
  }

  URL.revokeObjectURL(url);
  host.remove();

  return { img, w: vbW, h: vbH };
}

// Snapshot ONLY the inner Stage Profile SVG — scale to targetWidth with viewBox
async function snapshotStageProfileSVGAsImage(targetWidth){
  const frame = document.querySelector('#stage-profile .sp-frame');
  if (!frame) return null;
  const svg = frame.querySelector('svg');
  if (!svg) return null;

  // Clone the live SVG
  const clone = svg.cloneNode(true);

  // Ensure Oswald in the snapshot
  const ns = 'http://www.w3.org/2000/svg';
  const style = document.createElementNS(ns, 'style');
  style.textContent = `text, tspan { font-family: 'Oswald', sans-serif;}`;
  clone.prepend(style);
  const ff = document.createElementNS(ns, 'style');
  ff.textContent = await getEmbeddedOswaldCSS();
  clone.prepend(ff);

  // Use the on-screen frame size as the coordinate space (what renderStageProfile used)
  const r = frame.getBoundingClientRect();
  const coordW = Math.max(1, Math.ceil(r.width));
  const coordH = Math.max(1, Math.ceil(r.height));

  // Critical: add a viewBox so scaling to any width keeps the correct ratio
  clone.setAttribute('viewBox', `0 0 ${coordW} ${coordH}`);
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Scale to the requested export width
  const outW = Math.max(1, Math.ceil(targetWidth || coordW));
  const outH = Math.max(1, Math.ceil(outW * (coordH / coordW)));
  clone.setAttribute('width',  String(outW));
  clone.setAttribute('height', String(outH));

  // Let layout settle
  await new Promise(rf => requestAnimationFrame(rf));

  const xml  = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);

  let img;
  try {
    const bmp = await createImageBitmap(blob);
    const cnv = document.createElement('canvas');
    cnv.width = bmp.width; cnv.height = bmp.height;
    cnv.getContext('2d').drawImage(bmp, 0, 0);
    img = new Image();
    img.src = cnv.toDataURL('image/png');
    await new Promise(r => (img.onload = r, img.onerror = r));
  } catch {
    img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload  = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
  }

  URL.revokeObjectURL(url);
  return { img, w: outW, h: outH };
}

/* -----------------------------
   Generic DOM -> Image (via FO)
   ----------------------------- */
async function snapshotHTMLElementToImage(el, targetWidth){
  const cloned = cloneWithInlineStyles(el);

  const meas = document.createElement('div');
  meas.style.position = 'fixed';
  meas.style.left = '-99999px';
  meas.style.top  = '0';
  meas.style.width = targetWidth + 'px';
  meas.style.background = 'transparent';
  meas.appendChild(cloned);
  document.body.appendChild(meas);
  await Promise.resolve();

  const rect = meas.getBoundingClientRect();
  const w = Math.ceil(rect.width);
  const h = Math.ceil(rect.height);

  const fontCSS = await getEmbeddedOswaldCSS();

  const xhtml =
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px">`+
      `<style>${fontCSS}</style>`+
      cloned.outerHTML +
    `</div>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`+
      `<foreignObject width="100%" height="100%">${xhtml}</foreignObject>`+
    `</svg>`;

  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);

  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
  URL.revokeObjectURL(url);
  meas.remove();

  return { img, w, h };
}

/* Inline relevant computed styles so FO snapshot is self-contained */
function cloneWithInlineStyles(node){
  const clone = node.cloneNode(false);

  node.childNodes.forEach(child => {
    if (child.nodeType === Node.ELEMENT_NODE) {
      clone.appendChild(cloneWithInlineStyles(child));
    } else {
      clone.appendChild(child.cloneNode(true));
    }
  });

  if (node.nodeType === Node.ELEMENT_NODE){
    const cs = getComputedStyle(node);
    const style = clone.style;

    const props = [
      // box/flex
      'display','flex-direction','flex-wrap','justify-content','align-items','gap',
      'row-gap','column-gap',
      'box-sizing','width','height','min-width','min-height','max-width','max-height',
      'margin','margin-top','margin-right','margin-bottom','margin-left',
      'padding','padding-top','padding-right','padding-bottom','padding-left',
      // text
      'font-family','font-size','font-weight','font-style','line-height','letter-spacing',
      'text-transform','text-align','white-space','color',
      // visuals
      'background','background-color','border','border-top','border-right',
      'border-bottom','border-left','border-radius','box-shadow',
      // misc
      'outline','outline-offset'
    ];
    props.forEach(p => { const v = cs.getPropertyValue(p); if (v) style.setProperty(p, v); });

    if (cs.display === 'inline' && (node.tagName === 'SPAN' || node.tagName === 'LABEL')) {
      style.display = 'inline-block';
    }
  }
  return clone;
}

/* -----------------------------
   Save canvas as PNG
   ----------------------------- */
async function saveCanvasAsPng(canvas, name){
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.download = (name || 'image') + '.png';
  a.href = url;
  a.click();
}
