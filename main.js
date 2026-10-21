// Starts the game: draws the shop floor, handles input and runs the frame loop.

import { TILE, tileKey } from "./grid.js";
import { money } from "./format.js";
import { Draw, INK, drawAnts } from "./draw.js";
import { HAND, drawItem } from "./items.js";
import { Camera, Game, PLANTER, STALL, YARD } from "./game.js";
import { Save } from "./save.js";
import { UI } from "./ui.js";

const TAP_SLOP = 8; // screen px a pointer can move before a tap becomes a drag

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function layout() {
  Game.dpr = window.devicePixelRatio || 1;
  Game.width = canvas.clientWidth;
  Game.height = canvas.clientHeight;
  canvas.width = Math.round(Game.width * Game.dpr);
  canvas.height = Math.round(Game.height * Game.dpr);
  // Fit once at start. Later resizes (a window resize, a phone's address bar sliding) keep your view.
  if (!Camera.fitted) {
    Camera.fit();
  } else {
    Camera.zoom = Math.min(Camera.maxZoom, Math.max(Camera.minZoom, Camera.zoom));
    Camera.clamp();
  }
}

// The yard along the top and left walls. Its corner and the first square of each wall are the
// entrance plaza; past that, each wall gets a planter bed and a row of parking spaces, which
// grow with the floor.
function drawYard() {
  const fw = Game.floor.cols * TILE;
  const fh = Game.floor.rows * TILE;

  // Asphalt along both walls
  ctx.fillStyle = "#55595f";
  ctx.fillRect(-YARD, -YARD, fw + YARD, YARD);
  ctx.fillRect(-YARD, 0, YARD, fh);

  // Planter beds against the wall, with a concrete curb and a shrub every half square
  ctx.fillStyle = "#c9c5bc";
  ctx.fillRect(TILE, -PLANTER - 3, fw - TILE, PLANTER + 3);
  ctx.fillRect(-PLANTER - 3, TILE, PLANTER + 3, fh - TILE);
  ctx.fillStyle = "#6fa84a";
  ctx.fillRect(TILE, -PLANTER, fw - TILE, PLANTER);
  ctx.fillRect(-PLANTER, TILE, PLANTER, fh - TILE);
  ctx.fillStyle = "#4e8a33";
  for (let x = TILE + STALL / 2; x < fw; x += STALL) drawShrub(x, -PLANTER / 2, 5);
  for (let y = TILE + STALL / 2; y < fh; y += STALL) drawShrub(-PLANTER / 2, y, 5);

  // Parking space lines, square to the wall
  ctx.strokeStyle = "#f2f2f4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = TILE; x <= fw; x += STALL) {
    ctx.moveTo(x, -YARD + 6);
    ctx.lineTo(x, -PLANTER - 6);
  }
  for (let y = TILE; y <= fh; y += STALL) {
    ctx.moveTo(-YARD + 6, y);
    ctx.lineTo(-PLANTER - 6, y);
  }
  ctx.stroke();

  drawEntrancePlaza();
}

function drawShrub(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Concrete plaza in the corner, reaching along each wall to its doors, with a round planter
// in the corner and a small planter box either side of each door.
function drawEntrancePlaza() {
  ctx.fillStyle = "#d9d6cf";
  ctx.fillRect(-YARD, -YARD, YARD + TILE, YARD);
  ctx.fillRect(-YARD, 0, YARD, TILE);

  // Paver seams
  ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 6; i++) {
    const at = -YARD + (i * (YARD + TILE)) / 6;
    ctx.moveTo(at, -YARD);
    ctx.lineTo(at, at < 0 ? TILE : 0);
    ctx.moveTo(-YARD, at);
    ctx.lineTo(at < 0 ? TILE : 0, at);
  }
  ctx.stroke();

  // Round planter in the corner
  ctx.fillStyle = "#c9c5bc";
  drawShrub(-YARD / 2, -YARD / 2, 20);
  ctx.fillStyle = "#6fa84a";
  drawShrub(-YARD / 2, -YARD / 2, 16);
  ctx.fillStyle = "#4e8a33";
  drawShrub(-YARD / 2 - 5, -YARD / 2 - 3, 6);
  drawShrub(-YARD / 2 + 5, -YARD / 2 + 4, 6);

  // Planter boxes beside the doors on the top wall, then the same on the left wall
  for (const at of [3, TILE - 13]) {
    drawPlanterBox(at, -12, 10, 12);
    drawPlanterBox(-12, at, 12, 10);
  }
}

function drawPlanterBox(x, y, w, h) {
  ctx.fillStyle = "#c9c5bc";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#4e8a33";
  drawShrub(x + w / 2, y + h / 2, Math.min(w, h) / 2 - 1);
}

// Glass double doors set into the top and left walls, over the wall line drawFloor draws.
function drawEntranceDoors() {
  const from = 16;
  const to = TILE - 16;
  ctx.fillStyle = "#9fd3e6";
  ctx.fillRect(from, -3, to - from, 6);
  ctx.fillRect(-3, from, 6, to - from);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(from, -3, to - from, 6);
  ctx.strokeRect(-3, from, 6, to - from);
  ctx.beginPath();
  ctx.moveTo(TILE / 2, -3);
  ctx.lineTo(TILE / 2, 3);
  ctx.moveTo(-3, TILE / 2);
  ctx.lineTo(3, TILE / 2);
  ctx.stroke();
}

function drawFloor() {
  const { cols, rows } = Game.floor;
  const fw = cols * TILE;
  const fh = rows * TILE;

  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.fillRect(8, 10, fw, fh);
  ctx.fillStyle = "#f2f2f4";
  ctx.fillRect(0, 0, fw, fh);

  ctx.lineWidth = 1 / Camera.zoom;
  ctx.strokeStyle = "#dcdce2";
  ctx.beginPath();
  for (let c = 1; c < cols; c++) {
    ctx.moveTo(c * TILE, 0);
    ctx.lineTo(c * TILE, fh);
  }
  for (let r = 1; r < rows; r++) {
    ctx.moveTo(0, r * TILE);
    ctx.lineTo(fw, r * TILE);
  }
  ctx.stroke();

  ctx.lineWidth = 4;
  ctx.strokeStyle = "#4a4f5c";
  ctx.strokeRect(0, 0, fw, fh);
}

// Dashed strips outside the floor edge; marching when you can afford them.
function drawExpanders() {
  for (const { rect: r, label, cost } of Game.expanders()) {
    const affordable = Game.cash >= cost;

    ctx.fillStyle = affordable ? "rgba(255, 255, 255, 0.25)" : "rgba(255, 255, 255, 0.1)";
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 8);
    ctx.fill();

    ctx.setLineDash([10, 6]);
    ctx.lineDashOffset = affordable ? -Game.time * 30 : 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = affordable ? "#ffffff" : "rgba(255, 255, 255, 0.4)";
    ctx.stroke();
    ctx.setLineDash([]);

    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = affordable ? "#ffffff" : "rgba(255, 255, 255, 0.5)";
    ctx.font = Draw.font(16, true);
    ctx.fillText(money(cost), cx, cy - 8);
    ctx.font = Draw.font(10, false);
    ctx.fillText(label, cx, cy + 9, r.w - 6);
    ctx.textAlign = "left";
  }
}

// With the Upgrade tool: outline every machine that has an upgrade left, with its price.
// Gold and marching when you can afford it.
function drawUpgradeMarkers() {
  if (Game.tool !== "upgrade") return;

  for (const m of Game.machines) {
    const cost = m.upgradeCost(Game);
    if (cost === null) continue;
    const affordable = Game.cash >= cost;
    const { x, y, w, h } = m.rect;

    drawAnts(ctx, { x: x - 2, y: y - 2, w: w + 4, h: h + 4 }, affordable ? "#e0a800" : "#9a9eaa", affordable ? Game.time : 0);

    // Price tag on the top edge
    ctx.font = Draw.font(13, true);
    const text = `▲ ${money(cost)}`;
    const tw = ctx.measureText(text).width + 12;
    const tx = x + w / 2 - tw / 2;
    ctx.fillStyle = affordable ? "#ffd23f" : "#d8d8de";
    ctx.beginPath();
    ctx.roundRect(tx, y - 9, tw, 20, 5);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + w / 2, y + 1);
    ctx.textAlign = "left";
  }
}

// Light green over the squares a machine with a placement rule can go, while it's dragged.
function drawAllowedTiles() {
  const allowed = Game.moving?.allowed;
  if (!allowed) return;
  ctx.fillStyle = "rgba(61, 220, 132, 0.12)";
  for (let row = 0; row < Game.floor.rows; row++) {
    for (let col = 0; col < Game.floor.cols; col++) {
      if (allowed.has(tileKey(col, row))) ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
    }
  }
}

// Green or red tint over the footprint of the machine being dragged.
function drawMoveGhost() {
  if (!Game.moving) return;
  const { machine, valid } = Game.moving;
  const { x, y, w, h } = machine.rect;
  ctx.fillStyle = valid ? "rgba(61, 220, 132, 0.25)" : "rgba(217, 48, 48, 0.3)";
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = 3;
  ctx.strokeStyle = valid ? "#2e9e5f" : "#d93030";
  ctx.strokeRect(x, y, w, h);
}

// The belt piece being dragged, on top of everything, with a green or red square under it.
function drawBeltGhost() {
  if (!Game.movingBelt) return;
  const { piece, valid } = Game.movingBelt;
  const x = piece.col * TILE;
  const y = piece.row * TILE;
  ctx.fillStyle = valid ? "rgba(61, 220, 132, 0.25)" : "rgba(217, 48, 48, 0.3)";
  ctx.fillRect(x, y, TILE, TILE);
  piece.draw(ctx, Game.time);
  piece.drawCargo(ctx);
  ctx.lineWidth = 3;
  ctx.strokeStyle = valid ? "#2e9e5f" : "#d93030";
  ctx.strokeRect(x, y, TILE, TILE);
}

// Win95 tooltip with a bold title and wrapped text, below and right of (x, y) in screen space.
function infoTip(ctx, title, text, x, y) {
  const maxWidth = 240;
  ctx.font = Draw.font(12, false);
  const lines = Draw.wrap(ctx, text, maxWidth);
  ctx.font = Draw.font(12, true);
  const width = Math.max(ctx.measureText(title).width, ...lines.map((l) => ctx.measureText(l).width)) + 12;
  const height = 8 + 16 * (lines.length + 1);
  const left = Math.round(Math.min(x + 14, Game.width - width - 4));
  const top = Math.round(Math.min(y + 18, Game.height - height - 4));

  ctx.fillStyle = "#FFFFE1";
  ctx.fillRect(left, top, width, height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#000";
  ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
  ctx.fillStyle = "#000";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(title, left + 6, top + 5);
  ctx.font = Draw.font(12, false);
  lines.forEach((line, i) => ctx.fillText(line, left + 6, top + 5 + 16 * (i + 1)));
}

// Win95 tooltip, drawn in screen space.
function tooltip(ctx, text, x, y, alpha) {
  ctx.globalAlpha = alpha;
  ctx.font = Draw.font(12, false);
  const w = Math.ceil(ctx.measureText(text).width) + 10;
  const h = 20;
  const left = Math.round(Math.max(4, Math.min(x - w / 2, Game.width - w - 4)));
  const top = Math.round(Math.max(4, y - h - 8));
  ctx.fillStyle = "#FFFFE1";
  ctx.fillRect(left, top, w, h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#000";
  ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
  ctx.fillStyle = "#000";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + 5, top + h / 2);
  ctx.globalAlpha = 1;
}

// Machine names in screen space so they stay readable at any zoom.
function drawLabels() {
  if (TILE * Camera.zoom < 36) return;

  ctx.font = Draw.font(11, true);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  for (const m of Game.machines) {
    const { x, y, w, h } = m.rect;
    const p = Camera.toScreen(x + w / 2, y + h);
    ctx.strokeStyle = "#f2f2f4";
    ctx.strokeText(m.title, p.x, p.y + 1);
    ctx.fillStyle = "#4a4f5c";
    ctx.fillText(m.title, p.x, p.y + 1);
  }
  ctx.textAlign = "left";
}

function drawFloaters() {
  for (const f of Game.floaters) {
    const p = Camera.toScreen(f.x, f.y);
    if (f.kind === "tip") {
      const alpha = f.age > 1.2 ? 1 - (f.age - 1.2) / 0.4 : 1;
      tooltip(ctx, f.text, p.x, p.y, alpha);
    } else {
      const rise = f.age * 30;
      ctx.globalAlpha = 1 - f.age;
      ctx.font = Draw.font(18, true);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#000";
      ctx.fillText(f.text, p.x + 1, p.y - rise + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, p.x, p.y - rise);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }
  }
}

function render() {
  const { dpr } = Game;
  const z = Camera.zoom;

  // Teal Win95 desktop behind the shop floor
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#008080";
  ctx.fillRect(0, 0, Game.width, Game.height);

  // World space. The dragged machine draws last so it sits on top.
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (Game.width / 2 - Camera.x * z), dpr * (Game.height / 2 - Camera.y * z));
  drawYard();
  drawFloor();
  drawEntranceDoors();
  drawAllowedTiles();
  drawExpanders();
  for (const b of Game.belts.values()) b.draw(ctx, Game.time);
  for (const b of Game.belts.values()) b.drawCargo(ctx);
  const dragged = Game.moving?.machine;
  for (const m of Game.machines) {
    if (m !== dragged) m.draw(ctx, Game);
  }
  drawMoveGhost();
  if (dragged) dragged.draw(ctx, Game);
  drawBeltGhost();
  drawUpgradeMarkers();

  // Screen space
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawLabels();
  drawFloaters();
  drawHoverInfo();

  UI.render(Game);
}

// Input. One finger or left mouse depends on the tool:
//   select: tap trays, drag machines to move them, drag the floor to pan
//   belt:   tap to place or rotate, drag to lay a line
//   erase:  tap or drag to remove belts
// Two fingers pan and zoom with any tool. Right or middle mouse drag pans. Scroll zooms.
const pointers = new Map(); // pointerId -> { x, y } in screen px
let drag = null; // { start: { x, y }, moved, pan, machine, grab: { x, y }, tile: { col, row } }
let pinch = null; // { dist, mid }

function localPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function pinchInfo() {
  const [a, b] = [...pointers.values()];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

const HOVER_DELAY_MS = 450;

// Track the machine or belt piece under a resting mouse, for its description tooltip.
function updateHover(p) {
  const w = Camera.toWorld(p.x, p.y);
  const { col, row } = Game.tileAt(w.x, w.y);
  const target = Game.machineAt(w.x, w.y) ?? Game.beltAt(col, row) ?? null;
  if (!target) {
    Game.hover = null;
  } else if (Game.hover?.target === target) {
    Game.hover.x = p.x;
    Game.hover.y = p.y;
  } else {
    Game.hover = { target, x: p.x, y: p.y, since: performance.now() };
  }
}

function drawHoverInfo() {
  const hover = Game.hover;
  if (!hover || performance.now() - hover.since < HOVER_DELAY_MS) return;
  const { target } = hover;
  const jammed = target.isJammed?.()
    ? ` Its OUT tray is full: clear it before upkeep goes up (now ${target.upkeepMultiplier()}x).`
    : "";
  const upkeep = target.upkeep ? ` Upkeep $${target.upkeep}/min.${jammed}` : "";
  const text = target.details ? target.details(Game) : target.description;
  infoTip(ctx, target.title, `${text}${upkeep}`, hover.x, hover.y);
}

// A cursor that shows the item in your hand: a small arrow with the item on a white card beside it.
// Built once per kind of item and kept, since drawing it on every mouse move would be wasteful.
const HELD_CURSOR_SIZE = 48;
const heldCursors = new Map();

function heldCursor(item) {
  if (!heldCursors.has(item)) {
    const icon = document.createElement("canvas");
    icon.width = HELD_CURSOR_SIZE;
    icon.height = HELD_CURSOR_SIZE;
    const c = icon.getContext("2d");
    c.lineWidth = 2;
    c.lineJoin = "round";

    // The card behind the item, so it stands out on any floor color
    c.fillStyle = "#ffffff";
    c.strokeStyle = INK;
    c.beginPath();
    c.roundRect(12, 12, 34, 34, 6);
    c.fill();
    c.stroke();
    drawItem(c, item, 17, 17, 24);

    // The arrow's tip is the cursor's hot spot, at the top-left corner
    c.beginPath();
    c.moveTo(1, 1);
    c.lineTo(1, 17);
    c.lineTo(5.5, 12.5);
    c.lineTo(9, 19);
    c.lineTo(12, 17.5);
    c.lineTo(8.5, 11);
    c.lineTo(15, 11);
    c.closePath();
    c.fillStyle = "#ffffff";
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 1.5;
    c.stroke();

    heldCursors.set(item, `url(${icon.toDataURL()}) 1 1, pointer`);
  }
  return heldCursors.get(item);
}

function hoverCursor(p) {
  if (Game.tool !== "select") return "crosshair";
  if (Game.hand !== HAND.EMPTY) return heldCursor(Game.hand);
  const w = Camera.toWorld(p.x, p.y);
  const { col, row } = Game.tileAt(w.x, w.y);
  const overSomething = Game.machineAt(w.x, w.y) || Game.expanderAt(w.x, w.y) || Game.beltAt(col, row);
  return overSomething ? "pointer" : "grab";
}

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerleave", () => {
  Game.hover = null;
});

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  Game.hover = null; // pressing hides the description tooltip
  const p = localPoint(e);
  pointers.set(e.pointerId, p);

  if (pointers.size === 1) {
    const w = Camera.toWorld(p.x, p.y);
    // Only the select tool moves machines and belts. Remember where we grabbed a machine so it doesn't jump.
    const tile = Game.tileAt(w.x, w.y);
    const machine = Game.tool === "select" ? Game.machineAt(w.x, w.y) ?? null : null;
    const piece = Game.tool === "select" && !machine ? Game.beltAt(tile.col, tile.row) ?? null : null;
    const grab = machine ? { x: w.x - machine.col * TILE, y: w.y - machine.row * TILE } : null;
    drag = { start: p, moved: false, pan: e.button !== 0, button: e.button, machine, piece, grab, tile };
  } else if (pointers.size === 2) {
    // A second finger cancels the tap or the move and starts a pinch
    drag.moved = true;
    drag.pan = true;
    drag.machine = null;
    drag.piece = null;
    if (Game.moving) {
      Game.moving.valid = false;
      Game.endMove();
    }
    if (Game.movingBelt) {
      Game.movingBelt.valid = false;
      Game.endMoveBelt();
    }
    pinch = pinchInfo();
  }
});

// Only the belt and erase tools paint along a drag; the others pan.
function dragBuilds() {
  return Game.tool === "belt" || Game.tool === "express" || Game.tool === "erase";
}

// First real movement of a one-finger drag.
function startDrag() {
  drag.moved = true;
  if (drag.pan) return;
  const { col, row } = drag.tile;
  if (drag.machine) Game.startMove(drag.machine);
  else if (drag.piece) Game.startMoveBelt(drag.piece);
  else if (Game.tool === "erase") Game.eraseBelts(drag.tile, drag.tile);
  else if (dragBuilds()) Game.setBelt(col, row, Game.beltDir);
}

canvas.addEventListener("pointermove", (e) => {
  const p = localPoint(e);

  if (!pointers.has(e.pointerId)) {
    canvas.style.cursor = hoverCursor(p);
    updateHover(p);
    return;
  }

  const prev = pointers.get(e.pointerId);
  pointers.set(e.pointerId, p);

  if (pointers.size === 2) {
    const now = pinchInfo();
    Camera.zoomAt(now.mid.x, now.mid.y, now.dist / pinch.dist);
    Camera.pan(now.mid.x - pinch.mid.x, now.mid.y - pinch.mid.y);
    pinch = now;
    return;
  }
  if (pointers.size !== 1) return;

  if (!drag.moved) {
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) <= TAP_SLOP) return;
    startDrag();
  }

  const w = Camera.toWorld(p.x, p.y);
  if (Game.moving) {
    canvas.style.cursor = "grabbing";
    Game.moveTo(Math.round((w.x - drag.grab.x) / TILE), Math.round((w.y - drag.grab.y) / TILE));
  } else if (Game.movingBelt) {
    canvas.style.cursor = "grabbing";
    const tile = Game.tileAt(w.x, w.y);
    Game.moveBeltTo(tile.col, tile.row);
  } else if (drag.pan || !dragBuilds()) {
    canvas.style.cursor = "grabbing";
    Camera.pan(p.x - prev.x, p.y - prev.y);
  } else {
    const tile = Game.tileAt(w.x, w.y);
    if (tile.col === drag.tile.col && tile.row === drag.tile.row) return;
    if (Game.tool === "erase") Game.eraseBelts(drag.tile, tile);
    else Game.layBelts(drag.tile, tile);
    drag.tile = tile;
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;

  if (Game.moving) {
    if (e.type === "pointercancel") Game.moving.valid = false;
    Game.endMove();
  } else if (Game.movingBelt) {
    if (e.type === "pointercancel") Game.movingBelt.valid = false;
    Game.endMoveBelt();
  } else if (e.type === "pointerup" && drag && !drag.moved && drag.button === 2) {
    // Right-click (without dragging) drops whatever tool you're holding and goes back to Select
    if (Game.tool !== "select") Game.setTool("select");
  } else if (e.type === "pointerup" && pointers.size === 1 && drag && !drag.moved && !drag.pan) {
    const w = Camera.toWorld(drag.start.x, drag.start.y);
    Game.handleTap(w.x, w.y);
  }

  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) {
    const p = localPoint(e);
    const w = Camera.toWorld(p.x, p.y);
    Game.commitBuild(w.x, w.y);
    drag = null;
    canvas.style.cursor = hoverCursor(localPoint(e));
  }
}

// Keyboard shortcuts for the tools, plus F to view the whole floor. Keys pressed with Ctrl, Cmd
// or Alt belong to the browser (Ctrl+F finds, Cmd+S saves), so they're left alone.
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.toLowerCase() === "f") {
    Camera.fit();
    return;
  }
  const tools = { v: "select", escape: "select", b: "belt", x: "express", s: "splitter", r: "bridge", e: "erase", u: "upgrade" };
  const tool = tools[e.key.toLowerCase()];
  if (tool && tool !== Game.tool) Game.setTool(tool);
});

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const p = localPoint(e);
  Camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

window.addEventListener("resize", layout);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    Game.update(dt);
    render();
  } catch (error) {
    // Stop instead of running on in a broken state, and say so. The Start menu is plain DOM
    // and still works, so the shop can be saved to a file.
    console.error(error);
    UI.showCrash(error);
    return;
  }
  requestAnimationFrame(frame);
}

// Pick up the autosaved shop, if there is one, before the first frame.
const saved = Save.read(Game);
for (const machine of Game.machines) Game.turnPortsInward(machine);

UI.init({
  onTool: (tool) => Game.setTool(tool),
  onBuy: (entry) => Game.buy(entry),
  onFit: () => Camera.fit(),
  onNewShop: () => Save.newShop(),
  onSaveFile: () => Save.download(Game),
  onOpenFile: (file) => Save.open(file, Game),
});
if (saved === "restored") UI.welcomeBack();
if (saved === "failed") UI.saveFailed();
layout();
Save.startAutosave(Game);
requestAnimationFrame(frame);
