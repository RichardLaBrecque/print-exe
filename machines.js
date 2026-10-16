// Machine definitions. Each machine sits on the shop-floor grid, owns its own
// state, decides whether a tap does anything, and draws itself in world space.
//
// Footprint layout, one tile column each:  [ IN ] [ body ... ] [ OUT ]
// A machine without an in or out tray just skips that column.

const TILE = 64;

// Every item in the game, by display name. Also what the player's hand can hold.
const HAND = {
  EMPTY: null,
  // The four states of paper: blank or printed, sheet or roll. Printed paper also carries
  // the job it was printed for (see JOBS). Saddle-stitch sheets come from either a desktop
  // printer or a sheeter, so tier 1 and tier 2 machines can feed each other.
  BLANK_SHEET: "Blank Sheet",
  BLANK_ROLL: "Blank Roll",
  SADDLE_SHEET: "Printed Sheet: Saddle-Stitch",
  COVER_SHEET: "Printed Sheet: Cover",
  GUTS_SHEET: "Printed Sheet: Guts",
  SADDLE_ROLL: "Printed Roll: Saddle-Stitch",
  COVER_ROLL: "Printed Roll: Cover",
  GUTS_ROLL: "Printed Roll: Guts",
  // Finished goods
  ZINE: "Zine",
  PERFECT_ZINE: "Perfect-Bound Zine",
  SADDLE_PALLET: "Pallet: Saddle-Stitched",
  PERFECT_PALLET: "Pallet: Perfect-Bound",
};

// Press job settings: Saddle-Stitch, Cover or Guts, in the order a tap cycles them.
const JOBS = [
  { name: "Saddle-Stitch", label: "SADDLE", roll: HAND.SADDLE_ROLL, sheet: HAND.SADDLE_SHEET, color: "#9b8cff" },
  { name: "Cover", label: "COVER", roll: HAND.COVER_ROLL, sheet: HAND.COVER_SHEET, color: "#e5703a" },
  { name: "Guts", label: "GUTS", roll: HAND.GUTS_ROLL, sheet: HAND.GUTS_SHEET, color: "#4caf50" },
];
const PRINTED_ROLLS = JOBS.map((job) => job.roll);
const PRINTED_SHEETS = JOBS.map((job) => job.sheet);

// The job a printed sheet or roll belongs to, or undefined for anything else.
function jobOf(item) {
  return JOBS.find((job) => job.roll === item || job.sheet === item);
}

// Rolls are too heavy to carry; only belts move them.
function canCarry(item) {
  return item !== HAND.BLANK_ROLL && !PRINTED_ROLLS.includes(item);
}

// Production ratios, built around a belt carrying 1 item a second:
//   2 printers (4 s each) feed 1 Auto Stapler (2 s each),
//   and 2 Auto Staplers fill 1 belt.
// The Auto Stapler is still slower than a person tapping quickly.
const PRINT_SECONDS = 4;
const AUTO_STAPLE_SECONDS = 2;
const STAPLER_UPGRADE_COST = 120;
const AUTO_STAPLER_UPKEEP = 6; // $ per minute, up from the Manual Stapler's 2
// An Outbox ships 2 Zines a second: enough for an Express Belt, or two full belts once upgraded.
const SHIP_SECONDS = 0.5;
// The Outbox upgrade adds a second IN port, for less than a second Outbox.
const OUTBOX_UPGRADE_COST = 50;
const TRAY_SIZE = 5;
const ZINE_PRICE = 10;
const INK = "#4a4f5c";

// Holds a count of one kind of item. Give it `item` for a fixed kind, `kinds` to take any
// of several (it then holds one kind at a time, like a job changeover), or neither to take anything.
class Tray {
  constructor({ item = null, kinds = null, capacity = TRAY_SIZE, endless = false, pullable = true }) {
    this.item = item; // the kind held now; null when it takes anything or a multi-kind tray is empty
    this.kinds = kinds;
    this.capacity = capacity;
    this.endless = endless; // never fills up or runs out
    this.pullable = pullable; // false when the machine pushes items out itself (the Paper Supply's chute)
    this.count = 0;
    this.lastServed = ""; // key of the belt served last, so belts take turns
  }

  // Save and load: only what changes during play.
  saveState() {
    return { item: this.item, count: this.count, lastServed: this.lastServed };
  }

  loadState(s) {
    this.item = s.item;
    this.count = s.count;
    this.lastServed = s.lastServed;
  }

  accepts(hand) {
    if (hand === HAND.EMPTY) return false;
    if (this.kinds) {
      if (!this.kinds.includes(hand)) return false;
      if (this.count > 0 && this.item !== hand) return false;
    } else if (this.item !== null && this.item !== hand) {
      return false;
    }
    return !this.isFull();
  }

  // Whether `item` could go in once there's room: right kind, and no other kind in the way.
  fits(item) {
    if (this.kinds) return this.kinds.includes(item) && (this.count === 0 || this.item === item);
    return this.item === null || this.item === item;
  }

  hasItem() { return this.endless || this.count > 0; }
  isFull() { return !this.endless && this.count >= this.capacity; }

  put(item) {
    if (this.kinds) this.item = item;
    if (!this.endless) this.count += 1;
  }

  // Removes one and returns it. Read the item from here, not from `item` afterwards:
  // a multi-kind tray forgets its kind once it's empty.
  take() {
    const item = this.item;
    if (!this.endless) this.count -= 1;
    if (this.kinds && this.count === 0) this.item = null;
    return item;
  }

  // What to draw in the slot: the kind held, or the first kind it takes.
  get shownItem() {
    return this.item ?? this.kinds?.[0] ?? null;
  }
}

class Machine {
  // Give `inTray` for one input, or `inputs: [{ label, tray }]` for several. Inputs stack
  // down the first column, one share of the rows each, so a belt feeds whichever it points at.
  //
  // `portIn` / `portOut` give the IN or OUT tray a single port instead: one edge of the tray
  // column, marked with a triangle. With several inputs, each gets its own IN port, which stays
  // beside that input's rows. An IN port only takes items from the square it faces; an OUT port
  // pushes up to `portRate` items a second onto the square it faces, and belts can't pull from
  // it. Hands still use the whole tray. Turn a port with the Belt tool.
  //
  // `wallOnly` machines (Outbox, Truck Dock and the paper supplies) take deliveries in or ship
  // goods out of the building, so they must touch the top or left wall. The floor only grows right and down, so those walls never move.
  constructor(title, {
    col, row, cols, rows, accent, upkeep = 0, description = "",
    inTray = null, inputs = null, outTray = null, portIn = false, portOut = false, portRate = BELT_SPEED,
    wallOnly = false,
  }) {
    this.title = title;
    this.description = description; // one or two sentences for the hover tooltip
    this.upkeep = upkeep; // $ per minute, billed with rent
    this.col = col;
    this.row = row;
    this.cols = cols;
    this.rows = rows;
    this.accent = accent;
    this.wallOnly = wallOnly;
    this.inputs = inputs ?? (inTray ? [{ label: "IN", tray: inTray }] : []);
    this.outTray = outTray;
    // { kind: "in" | "out", row, dir }: row offset in that tray column, facing DIRS[dir]
    this.ports = [
      ...(portIn ? this.inputs.map((_input, i) => ({ kind: "in", ...this.inputEdges(i)[0] })) : []),
      ...(portOut ? [{ kind: "out", ...this.portEdges("out")[0] }] : []),
    ];
    if (portOut) outTray.pullable = false;
    this.portRate = portRate;
    this.portTimer = 0; // 0..1; the OUT port pushes an item each time it reaches 1
    this.shake = 0;
  }

  // The first (usually only) input tray.
  get inTray() {
    return this.inputs[0]?.tray ?? null;
  }

  // World-space footprint in pixels.
  get rect() {
    return { x: this.col * TILE, y: this.row * TILE, w: this.cols * TILE, h: this.rows * TILE };
  }

  // Tappable parts: "in:0", "in:1", ... for each input, then "out" and "body".
  get parts() {
    return [...this.inputs.map((_input, i) => `in:${i}`), "out", "body"];
  }

  trayFor(part) {
    if (part === "out") return this.outTray;
    if (part?.startsWith("in:")) return this.inputs[Number(part.slice(3))].tray;
    return null;
  }

  // World-space rect for a part, or null if the machine doesn't have it.
  partRect(part) {
    const { x, y, w, h } = this.rect;
    const inW = this.inputs.length > 0 ? TILE : 0;
    const outW = this.outTray ? TILE : 0;

    if (part.startsWith("in:")) {
      const i = Number(part.slice(3));
      const share = Math.floor(this.rows / this.inputs.length) * TILE;
      const top = y + i * share;
      const last = i === this.inputs.length - 1;
      return { x, y: top, w: TILE, h: last ? y + h - top : share };
    }
    if (part === "out") return this.outTray ? { x: x + w - TILE, y, w: TILE, h } : null;
    if (w - inW - outW <= 0) return null;
    return { x: x + inW, y, w: w - inW - outW, h };
  }

  partAt(wx, wy) {
    for (const part of this.parts) {
      const r = this.partRect(part);
      if (r && wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return part;
    }
    return null;
  }

  contains(wx, wy) {
    const { x, y, w, h } = this.rect;
    return wx >= x && wx <= x + w && wy >= y && wy <= y + h;
  }

  // Tap handling, one trio per part ------------------------------------------

  canUse(game, part) {
    if (part?.startsWith("in:")) return this.trayFor(part).accepts(game.hand);
    if (part === "out") return game.hand === HAND.EMPTY && this.outTray.hasItem() && canCarry(this.outTray.item);
    if (part === "body") return this.canActivate(game);
    return false;
  }

  use(game, part) {
    if (part.startsWith("in:")) {
      this.trayFor(part).put(game.hand);
      game.hand = HAND.EMPTY;
    } else if (part === "out") {
      game.hand = this.outTray.take();
    } else {
      this.activate(game);
    }
  }

  hint(game, part) {
    if (part?.startsWith("in:")) {
      const tray = this.trayFor(part);
      if (game.hand === HAND.EMPTY) return `Drop ${tray.item ?? "anything"} here.`;
      if (tray.item !== null && tray.item !== game.hand) return `Only takes ${tray.item}.`;
      return "In tray is full.";
    }
    if (part === "out") {
      if (!canCarry(this.outTray.item)) return "Rolls are too heavy to carry. Move them with belts.";
      if (game.hand !== HAND.EMPTY) return "Your hands are full.";
      return "Nothing to collect yet.";
    }
    return this.bodyHint(game);
  }

  // Manual machines override these three.
  canActivate(_game) { return false; }
  activate(_game) {}
  bodyHint(_game) { return "Runs on its own."; }

  // Save and load. Subclasses add their own fields on top. `type` is the class name,
  // which save.js maps back to a constructor.
  saveState() {
    return {
      type: this.constructor.name,
      col: this.col,
      row: this.row,
      trays: this.allTrays().map((tray) => tray.saveState()),
      ports: this.ports.map((port) => ({ ...port })),
      portTimer: this.portTimer,
    };
  }

  // Saves from before ports keep each machine's default ports; saves from the one-port
  // version stored them as inPort and outPort. Production machines were saved with no ports
  // before they had them, so an empty list also keeps the defaults.
  loadState(s) {
    this.allTrays().forEach((tray, i) => tray.loadState(s.trays[i]));
    if (s.ports?.length > 0) {
      this.ports = s.ports.map((port) => ({ ...port }));
    } else {
      if (s.inPort && this.inPort) Object.assign(this.inPort, s.inPort);
      if (s.outPort && this.outPort) Object.assign(this.outPort, s.outPort);
    }
    this.portTimer = s.portTimer ?? 0;
  }

  allTrays() {
    return [...this.inputs.map((input) => input.tray), ...(this.outTray ? [this.outTray] : [])];
  }

  // Upgrades. Machines that can be upgraded override these.
  upgradeCost() { return null; } // price of the next upgrade, or null if none left
  upgradeHint() { return "No upgrades for this machine."; }
  upgrade() {}

  // 0..1 to show a progress bar in the body, or null for none.
  progress() { return null; }

  update(dt, game) {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
    if (this.outPort) {
      this.portTimer = Math.min(1, this.portTimer + dt * this.portRate);
      if (this.portTimer >= 1 && this.outTray.count > 0 && this.pushOut(game)) this.portTimer = 0;
    }
  }

  // Ports -------------------------------------------------------------------------------

  // Every outward edge of the IN (first) or OUT (last) column, in the order a tap turns
  // through them: the outer side of each tile, plus the top and bottom ends.
  portEdges(kind) {
    const side = kind === "in" ? 2 : 0; // left for IN, right for OUT
    const edges = [];
    for (let row = 0; row < this.rows; row++) {
      edges.push({ row, dir: side });
      if (row === 0) edges.push({ row, dir: 3 });
      if (row === this.rows - 1) edges.push({ row, dir: 1 });
    }
    return edges;
  }

  // Which input the tray column's row belongs to, matching how partRect splits the rows.
  inputAtRow(row) {
    const share = Math.floor(this.rows / this.inputs.length);
    return Math.min(Math.floor(row / share), this.inputs.length - 1);
  }

  // The IN column's edges beside one input's rows.
  inputEdges(i) {
    return this.portEdges("in").filter((e) => this.inputAtRow(e.row) === i);
  }

  // The edges a port can turn through: an IN port stays beside its own input.
  edgesFor(port) {
    return port.kind === "in" ? this.inputEdges(this.inputAtRow(port.row)) : this.portEdges("out");
  }

  // The first IN or OUT port; most machines have at most one of each.
  get inPort() {
    return this.ports.find((port) => port.kind === "in") ?? null;
  }

  get outPort() {
    return this.ports.find((port) => port.kind === "out") ?? null;
  }

  // A port's own square on the machine, and the square outside it that it faces.
  portTile(port) {
    return { col: this.col + (port.kind === "in" ? 0 : this.cols - 1), row: this.row + port.row };
  }

  portOutside(port) {
    const tile = this.portTile(port);
    const d = DIRS[port.dir];
    return { col: tile.col + d.x, row: tile.row + d.y };
  }

  // Edges of a column no other port of that kind is using.
  freeEdges(kind, except = null) {
    const taken = this.ports.filter((p) => p.kind === kind && p !== except);
    return this.portEdges(kind).filter((e) => !taken.some((p) => p.row === e.row && p.dir === e.dir));
  }

  // Add a port on the first free edge, preferring a tile without one (e.g. the Outbox upgrade).
  addPort(kind) {
    const free = this.freeEdges(kind);
    const edge = free.find((e) => !this.ports.some((p) => p.kind === kind && p.row === e.row)) ?? free[0];
    if (edge) this.ports.push({ kind, ...edge });
  }

  // Move the port to the next edge of its column, skipping edges another port is on.
  rotatePort(port) {
    const edges = this.edgesFor(port);
    const free = this.freeEdges(port.kind, port);
    const start = edges.findIndex((e) => e.row === port.row && e.dir === port.dir);
    for (let i = 1; i <= edges.length; i++) {
      const next = edges[(start + i) % edges.length];
      if (free.some((e) => e.row === next.row && e.dir === next.dir)) {
        port.row = next.row;
        port.dir = next.dir;
        return;
      }
    }
  }

  // The port a Belt tool tap on (col, row) turns: on a ported tray column, the port on the
  // tapped tile if there is one, otherwise the column's first port.
  portAtTile(col, row) {
    const part = this.partAt((col + 0.5) * TILE, (row + 0.5) * TILE);
    const kind = part?.startsWith("in:") ? "in" : part === "out" ? "out" : null;
    if (!kind) return null;
    const column = this.ports.filter((p) => p.kind === kind);
    const sameInput = (p) => kind === "in" && this.inputAtRow(p.row) === this.inputAtRow(row - this.row);
    return column.find((p) => this.row + p.row === row) ?? column.find(sameInput) ?? column[0] ?? null;
  }

  // IN ports take items only from the square they face; other machines take from anywhere.
  takesInFrom(col, row, from) {
    const inPorts = this.ports.filter((p) => p.kind === "in");
    if (inPorts.length === 0) return true;
    return inPorts.some((port) => {
      const tile = this.portTile(port);
      const outside = this.portOutside(port);
      return tile.col === col && tile.row === row && outside.col === from.col && outside.row === from.row;
    });
  }

  // Hand one item from the OUT port to the belt or IN tray it faces. Returns true if it went.
  pushOut(game) {
    const from = this.portTile(this.outPort);
    const { col, row } = this.portOutside(this.outPort);
    const piece = game.beltAt(col, row);
    if (piece) {
      const lane = piece.receiverFrom(from.col, from.row);
      if (!lane || lane.item !== null) return false;
      lane.receive(this.outTray.take(), 0, from);
      return true;
    }
    const tray = game.inTrayFrom(col, row, from);
    if (!tray || !tray.accepts(this.outTray.item)) return false;
    tray.put(this.outTray.take());
    return true;
  }

  // A triangle on each port's edge: OUT points out, IN points in. They pulse while
  // game.portHighlightUntil is ahead, to show where belts connect.
  drawPorts(ctx, game) {
    for (const port of this.ports) {
      const { kind } = port;
      const { col, row } = this.portTile(port);
      ctx.save();
      ctx.translate(col * TILE + TILE / 2, row * TILE + TILE / 2);
      ctx.rotate((port.dir * Math.PI) / 2);
      if (game.time < game.portHighlightUntil) {
        const pulse = 0.5 + 0.5 * Math.sin(game.time * 8);
        ctx.beginPath();
        ctx.arc(TILE / 2 - 8, 0, 13 + pulse * 5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 210, 63, ${0.35 + pulse * 0.4})`;
        ctx.fill();
      }
      ctx.beginPath();
      if (kind === "out") {
        ctx.moveTo(TILE / 2 - 2, 0);
        ctx.lineTo(TILE / 2 - 14, -10);
        ctx.lineTo(TILE / 2 - 14, 10);
      } else {
        ctx.moveTo(TILE / 2 - 14, 0);
        ctx.lineTo(TILE / 2 - 2, -10);
        ctx.lineTo(TILE / 2 - 2, 10);
      }
      ctx.closePath();
      ctx.fillStyle = this.accent;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Drawing ------------------------------------------------------------------

  draw(ctx, game) {
    const inset = 6;
    const offset = this.shake > 0 ? Math.sin(this.shake * 70) * 4 : 0;
    const { x, y, w, h } = this.rect;
    const bx = x + inset;
    const by = y + inset;
    const bw = w - inset * 2;
    const bh = h - inset * 2;

    ctx.save();
    ctx.translate(offset, 0);

    // Drop shadow
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.beginPath();
    ctx.roundRect(bx + 3, by + 5, bw, bh, 8);
    ctx.fill();

    // Body with a colored stripe across the top
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 8);
    ctx.fillStyle = "#fafafa";
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = this.accent;
    ctx.fillRect(bx, by, bw, 10);
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();

    this.inputs.forEach((input, i) => this.drawTray(ctx, this.partRect(`in:${i}`), input.tray, input.label));
    if (this.outTray) this.drawTray(ctx, this.partRect("out"), this.outTray, "OUT");

    const body = this.partRect("body");
    if (body) this.drawBody(ctx, body);

    ctx.restore();

    // Marching-ants outline on every part that would do something if tapped
    for (const part of this.parts) {
      const r = this.partRect(part);
      if (r && game.tool === "select" && this.canUse(game, part)) drawAnts(ctx, r, this.accent, game.time);
    }

    this.drawPorts(ctx, game);
  }

  drawTray(ctx, r, tray, label) {
    // Sunken slot. Leave room for the stripe only at the top edge, and the frame only at the bottom.
    const atTop = r.y === this.rect.y;
    const atBottom = r.y + r.h === this.rect.y + this.rect.h;
    const sx = r.x + 12;
    const sy = r.y + (atTop ? 20 : 4);
    const sw = r.w - 24;
    const sh = r.h - (atTop ? 20 : 4) - (atBottom ? 12 : 4);
    ctx.fillStyle = "#e4e4ea";
    ctx.beginPath();
    ctx.roundRect(sx, sy, sw, sh, 5);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#b8b8c4";
    ctx.stroke();

    // Short slots (one-tile-tall machines) drop the label so the icon and count still fit
    const compact = sh < 40;
    ctx.textAlign = "center";
    if (!compact) {
      ctx.font = Draw.font(9, true);
      ctx.textBaseline = "top";
      ctx.fillStyle = INK;
      ctx.fillText(label, sx + sw / 2, sy + 3);
    }

    // Contents
    // Icon fits between the label (top 12) and the count (bottom 12), so short slots stay readable
    const top = compact ? 2 : 12;
    const s = Math.min(sw * 0.55, sh - top - 12);
    const cx = sx + sw / 2;
    const cy = sy + top + (sh - top - 12) / 2;
    ctx.lineWidth = 2;
    if (tray.shownItem === null) {
      this.drawIcon(ctx, cx - s / 2, cy - s / 2, s);
    } else {
      ctx.globalAlpha = tray.hasItem() ? 1 : 0.25;
      drawItem(ctx, tray.shownItem, cx - s / 2, cy - s / 2, s);
      ctx.globalAlpha = 1;
    }

    // Count, red when full so you know the machine is blocked
    if (!tray.endless) {
      ctx.font = Draw.font(10, true);
      ctx.textBaseline = "bottom";
      ctx.fillStyle = tray.isFull() ? "#d93030" : INK;
      ctx.fillText(`${tray.count}/${tray.capacity}`, cx, sy + sh - 2);
    } else if (label === "OUT") {
      ctx.font = Draw.font(12, true);
      ctx.textBaseline = "bottom";
      ctx.fillStyle = INK;
      ctx.fillText("∞", cx, sy + sh - 1);
    }
    ctx.textAlign = "left";
  }

  // Small caps label across the top of the body, e.g. a supply's ORDER price or a press's job.
  drawBodyLabel(ctx, r, text, color) {
    ctx.font = Draw.font(10, true);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = color;
    ctx.fillText(text, r.x + r.w / 2, r.y + 22, r.w - 8);
    ctx.textAlign = "left";
  }

  drawBody(ctx, r) {
    // A one-tile-tall body only has room for its label and progress bar
    if (r.h >= TILE * 2) {
      const s = Math.min(r.w, r.h) * 0.5;
      ctx.lineWidth = 2;
      this.drawIcon(ctx, r.x + r.w / 2 - s / 2, r.y + r.h / 2 - s / 2 + 3, s);
    }

    const bar = this.progress();
    if (bar !== null) {
      const px = r.x + 6;
      const pw = r.w - 12;
      const py = r.y + r.h - 20;
      ctx.fillStyle = "#d8d8de";
      ctx.beginPath();
      ctx.roundRect(px, py, pw, 7, 3);
      ctx.fill();
      ctx.fillStyle = this.accent;
      ctx.beginPath();
      ctx.roundRect(px, py, pw * bar, 7, 3);
      ctx.fill();
    }
  }

  drawIcon(_ctx, _x, _y, _s) {}
}

function drawAnts(ctx, r, color, time) {
  ctx.setLineDash([10, 6]);
  ctx.lineDashOffset = -time * 30;
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.roundRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 10);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Item icons, drawn into an s-by-s box at (x, y).
function drawItem(ctx, item, x, y, s) {
  ctx.strokeStyle = INK;
  if (item === HAND.BLANK_SHEET) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + s * 0.15, y, s * 0.7, s);
    ctx.strokeRect(x + s * 0.15, y, s * 0.7, s);
  } else if (PRINTED_SHEETS.includes(item)) {
    // Two sheets with print bars in the job's color; a cover's front is solid color
    const job = jobOf(item);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + s * 0.25, y, s * 0.65, s * 0.9);
    ctx.strokeRect(x + s * 0.25, y, s * 0.65, s * 0.9);
    ctx.fillStyle = item === HAND.COVER_SHEET ? job.color : "#ffffff";
    ctx.fillRect(x + s * 0.1, y + s * 0.1, s * 0.65, s * 0.9);
    ctx.strokeRect(x + s * 0.1, y + s * 0.1, s * 0.65, s * 0.9);
    ctx.fillStyle = item === HAND.COVER_SHEET ? "#ffffff" : job.color;
    for (const f of [0.3, 0.45, 0.6, 0.75]) ctx.fillRect(x + s * 0.2, y + s * f, s * 0.45, s * 0.06);
  } else if (item === HAND.ZINE) {
    ctx.fillStyle = "#ffe08a";
    ctx.fillRect(x + s * 0.1, y + s * 0.05, s * 0.8, s * 0.9);
    ctx.strokeRect(x + s * 0.1, y + s * 0.05, s * 0.8, s * 0.9);
    ctx.fillStyle = INK;
    ctx.fillRect(x + s * 0.48, y + s * 0.05, s * 0.04, s * 0.9); // spine
    ctx.fillStyle = "#d93030";
    ctx.fillRect(x + s * 0.44, y + s * 0.25, s * 0.12, s * 0.06); // staples
    ctx.fillRect(x + s * 0.44, y + s * 0.7, s * 0.12, s * 0.06);
  } else if (item === HAND.BLANK_ROLL || PRINTED_ROLLS.includes(item)) {
    // Roll seen end-on: paper, a band in the job's color if printed, and the core
    const cx = x + s / 2;
    const cy = y + s / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = "#fbf7ec";
    ctx.fill();
    ctx.stroke();
    if (item !== HAND.BLANK_ROLL) {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.34, 0, Math.PI * 2);
      ctx.lineWidth = s * 0.12;
      ctx.strokeStyle = jobOf(item).color;
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = "#c08850";
    ctx.fill();
    ctx.stroke();
  } else if (item === HAND.PERFECT_ZINE) {
    // Thick block of pages wrapped in an orange cover with a square, glued spine
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + s * 0.24, y + s * 0.12, s * 0.66, s * 0.8);
    ctx.strokeRect(x + s * 0.24, y + s * 0.12, s * 0.66, s * 0.8);
    ctx.fillStyle = "#e5703a";
    ctx.fillRect(x + s * 0.1, y + s * 0.05, s * 0.72, s * 0.8);
    ctx.strokeRect(x + s * 0.1, y + s * 0.05, s * 0.72, s * 0.8);
    ctx.fillStyle = "#b34f20";
    ctx.fillRect(x + s * 0.1, y + s * 0.05, s * 0.16, s * 0.8); // spine
    ctx.strokeRect(x + s * 0.1, y + s * 0.05, s * 0.16, s * 0.8);
  } else if (item === HAND.SADDLE_PALLET || item === HAND.PERFECT_PALLET) {
    // Wrapped stack of boxes on a wooden pallet, boxes tinted by the kind of zine
    ctx.fillStyle = "#c08850";
    ctx.fillRect(x, y + s * 0.8, s, s * 0.14);
    ctx.strokeRect(x, y + s * 0.8, s, s * 0.14);
    ctx.fillStyle = item === HAND.PERFECT_PALLET ? "#e5a06a" : "#9fb4e0";
    ctx.fillRect(x + s * 0.06, y + s * 0.1, s * 0.88, s * 0.7);
    ctx.strokeRect(x + s * 0.06, y + s * 0.1, s * 0.88, s * 0.7);
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)"; // stretch wrap
    ctx.fillRect(x + s * 0.06, y + s * 0.25, s * 0.88, s * 0.12);
    ctx.fillRect(x + s * 0.06, y + s * 0.55, s * 0.88, s * 0.12);
    ctx.fillStyle = INK;
    ctx.fillRect(x + s * 0.49, y + s * 0.1, s * 0.02, s * 0.7);
  }
}

// Holds a stock of paper that you pay to restock. Tap the body to order a delivery;
// a truck drops it off after a short wait. The IN and OUT trays are the same stock,
// so you can put paper back. One upgrade adds auto-reorder.
//
// With `chute: true` the OUT tray is a single port (see Machine): belts can't pull from it,
// and it pushes one item a second onto the square its triangle faces.
class Supply extends Machine {
  constructor(title, { item, capacity, startStock, delivery, reorderCost, sample = 0, rows = 2, chute = false, ...rest }) {
    const stock = new Tray({ item, capacity });
    stock.count = startStock;
    super(title, { ...rest, cols: 3, rows, inTray: stock, outTray: stock, portOut: chute, wallOnly: true });
    this.delivery = delivery; // { amount, price, seconds }
    this.reorderCost = reorderCost;
    this.sample = sample; // free sheets sent when you're broke and out of paper, so you can't get stuck
    this.pending = 0; // seconds until the ordered delivery arrives, 0 = none on the way
    this.incoming = 0; // how much that delivery brings
    this.autoReorder = false;
  }

  saveState() {
    return {
      ...super.saveState(),
      pending: this.pending,
      incoming: this.incoming,
      autoReorder: this.autoReorder,
    };
  }

  loadState(s) {
    super.loadState(s);
    this.pending = s.pending;
    this.incoming = s.incoming;
    this.autoReorder = s.autoReorder;
    // Saves from the chute version stored its direction as chuteDir
    if (!s.ports && !s.outPort && s.chuteDir != null && this.outPort) Object.assign(this.outPort, { row: 0, dir: s.chuteDir });
  }

  hasRoomForDelivery() {
    return this.inTray.count + this.delivery.amount <= this.inTray.capacity;
  }

  // A sample is free, only when broke and fully out.
  sampleDue(game) {
    return this.sample > 0 && this.inTray.count === 0 && game.cash < this.delivery.price;
  }

  canActivate(game) {
    if (this.pending > 0 || !this.hasRoomForDelivery()) return false;
    return game.cash >= this.delivery.price || this.sampleDue(game);
  }

  activate(game) {
    const { x, y, w } = this.rect;
    if (game.cash < this.delivery.price) {
      this.order(this.sample);
      game.showTip(`The supplier sent ${this.sample} free samples.`, x + w / 2, y);
      return;
    }
    game.spend(this.delivery.price, `${this.title} delivery`);
    game.floatText(`-${money(this.delivery.price)}`, x + w / 2, y, "#d93030");
    this.order(this.delivery.amount);
  }

  order(amount) {
    this.incoming = amount;
    this.pending = this.delivery.seconds;
  }

  bodyHint(game) {
    if (this.pending > 0) return "Delivery on the way.";
    if (!this.hasRoomForDelivery()) return `No room for ${this.delivery.amount} more. Use some first.`;
    return `Need ${money(this.delivery.price)} for a delivery.`;
  }

  upgradeCost() { return this.autoReorder ? null : this.reorderCost; }
  upgradeHint() { return "Already reorders on its own."; }
  upgrade() { this.autoReorder = true; }

  progress() {
    if (this.pending === 0) return null;
    return 1 - this.pending / this.delivery.seconds;
  }

  update(dt, game) {
    super.update(dt, game);
    if (this.pending > 0) {
      this.pending = Math.max(0, this.pending - dt);
      if (this.pending === 0) this.inTray.count = Math.min(this.inTray.capacity, this.inTray.count + this.incoming);
      return;
    }
    if (this.autoReorder && this.hasRoomForDelivery() && game.cash >= this.delivery.price) this.activate(game);
  }

  drawBody(ctx, r) {
    super.drawBody(ctx, r);
    // Order button label, so it's clear the body is tappable
    const label = this.pending > 0 ? "ARRIVING" : this.autoReorder ? "AUTO" : `ORDER ${money(this.delivery.price)}`;
    this.drawBodyLabel(ctx, r, label, INK);
  }

  // A stack of whatever this supply holds.
  drawIcon(ctx, x, y, s) {
    ctx.lineWidth = 2;
    drawItem(ctx, this.inTray.item, x + s * 0.1, y + s * 0.2, s * 0.8);
  }
}

// Tier 1 paper: Blank Sheets, delivered by the ream.
class PaperSupply extends Supply {
  constructor(at) {
    super("Paper Supply", {
      description: "Pushes a Blank Sheet a second out of its chute onto one square. " +
        "Turn the chute with the Belt tool; tap the middle to order 20 more for $40.",
      upkeep: 0,
      ...at,
      accent: "#5fb3d9",
      item: HAND.BLANK_SHEET,
      capacity: 40,
      startStock: 20,
      delivery: { amount: 20, price: 40, seconds: 3 }, // $2 a sheet
      reorderCost: 100,
      sample: 5,
      rows: 1,
      chute: true,
    });
  }
}

// Turns one IN item into one OUT item every `seconds`, on its own, while there's
// something in and room out. Printers, presses, sheeters and binders are all this.
// `yields` items come out per item in, e.g. a Sheeter cuts 1 roll into 10 sheets.
// `input` and `output` are one item, or a list for machines that handle several job types.
class Converter extends Machine {
  constructor(title, { input, output, seconds, yields = 1, capacity = TRAY_SIZE, outCapacity = capacity, ...rest }) {
    super(title, {
      ...rest,
      inTray: Array.isArray(input) ? new Tray({ kinds: input, capacity }) : new Tray({ item: input, capacity }),
      outTray: Array.isArray(output)
        ? new Tray({ kinds: output, capacity: outCapacity })
        : new Tray({ item: output, capacity: outCapacity }),
    });
    this.output = output;
    this.seconds = seconds;
    this.yields = yields;
    this.working = false;
    this.making = null; // the item the current job will produce
    this.elapsed = 0;
  }

  saveState() {
    return { ...super.saveState(), working: this.working, making: this.making, elapsed: this.elapsed };
  }

  loadState(s) {
    super.loadState(s);
    this.working = s.working;
    this.making = s.making;
    this.elapsed = s.elapsed;
  }

  // What a job on this input makes. Machines with several job types override it.
  outputFor(_input) {
    return this.output;
  }

  // The OUT tray can take everything one job makes: right kind and enough room.
  canMake(item) {
    return this.outTray.fits(item) && this.outTray.count + this.yields <= this.outTray.capacity;
  }

  // False when the next job is stuck waiting on the OUT tray.
  hasRoom() {
    if (this.inTray.count === 0) return this.outTray.count + this.yields <= this.outTray.capacity;
    return this.canMake(this.outputFor(this.inTray.item));
  }

  progress() {
    if (!this.working) return null;
    return Math.min(1, this.elapsed / this.seconds);
  }

  bodyHint() {
    if (!this.hasRoom()) return "OUT tray is full or holds a different job. Clear it first.";
    return "Runs on its own. Load its IN tray.";
  }

  update(dt, game) {
    super.update(dt, game);
    if (this.working) {
      this.elapsed += dt;
      if (this.elapsed < this.seconds) return;
      this.working = false;
      for (let i = 0; i < this.yields; i++) this.outTray.put(this.making);
      this.elapsed -= this.seconds; // carry the leftover into the next job so the rate stays exact
    } else {
      this.elapsed = 0;
    }
    if (this.inTray.count === 0) return;
    const making = this.outputFor(this.inTray.item);
    if (!this.canMake(making)) return;
    this.inTray.take();
    this.making = making;
    this.working = true;
  }

  // Green while working, red when the OUT tray is full and it's stuck, dark when idle.
  statusLight() {
    if (this.working) return "#3ddc84";
    return this.hasRoom() ? "#2e7d4f" : "#d93030";
  }
}

class DesktopPrinter extends Converter {
  constructor(at) {
    super("Desktop Printer", {
      description: `Prints Blank Sheets into saddle-stitch Printed Sheets, one every ${PRINT_SECONDS} seconds.`,
      upkeep: 5,
      ...at,
      portIn: true,
      portOut: true,
      cols: 3,
      rows: 2,
      accent: "#9b8cff",
      input: HAND.BLANK_SHEET,
      output: HAND.SADDLE_SHEET,
      seconds: PRINT_SECONDS,
    });
  }

  drawIcon(ctx, x, y, s) {
    ctx.strokeStyle = INK;
    // Paper sticking out the top
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + s * 0.25, y, s * 0.5, s * 0.4);
    ctx.strokeRect(x + s * 0.25, y, s * 0.5, s * 0.4);
    // Body
    ctx.fillStyle = "#b8b8c4";
    ctx.fillRect(x, y + s * 0.3, s, s * 0.5);
    ctx.strokeRect(x, y + s * 0.3, s, s * 0.5);
    // Output slot and status light
    ctx.fillStyle = INK;
    ctx.fillRect(x + s * 0.15, y + s * 0.62, s * 0.7, s * 0.06);
    ctx.fillStyle = this.statusLight();
    ctx.fillRect(x + s * 0.78, y + s * 0.38, s * 0.1, s * 0.1);
  }
}

// Manual: tap the body to staple one set of pages into a Zine.
class ManualStapler extends Machine {
  constructor(at) {
    super("Manual Stapler", {
      description: "Tap the middle to staple a saddle-stitch Printed Sheet into a Zine.",
      upkeep: 2,
      ...at,
      portIn: true,
      portOut: true,
      cols: 3,
      rows: 2,
      accent: "#ff7a7a",
      inTray: new Tray({ item: HAND.SADDLE_SHEET }),
      outTray: new Tray({ item: HAND.ZINE }),
    });
    this.press = 0; // seconds left on the press-down animation
    this.level = 0; // 1 = Auto Stapler
    this.elapsed = 0; // auto-staple timer
  }

  saveState() {
    return { ...super.saveState(), level: this.level, elapsed: this.elapsed };
  }

  // upgrade() also sets the Auto Stapler's title, upkeep and description
  loadState(s) {
    super.loadState(s);
    if (s.level === 1) this.upgrade();
    this.elapsed = s.elapsed;
  }

  // Tapping the body still staples instantly, even once automated.
  canActivate() { return this.inTray.count > 0 && !this.outTray.isFull(); }

  activate() {
    this.inTray.take();
    this.outTray.put(HAND.ZINE);
    this.press = 0.15;
    this.elapsed = 0;
  }

  bodyHint() {
    if (this.outTray.isFull()) return "Out tray is full. Collect your Zines.";
    return "Load Printed Pages in the IN tray first.";
  }

  upgradeCost() { return this.level === 0 ? STAPLER_UPGRADE_COST : null; }
  upgradeHint() { return "Already an Auto Stapler."; }

  upgrade() {
    this.level = 1;
    this.title = "Auto Stapler";
    this.description = `Staples a saddle-stitch Printed Sheet into a Zine every ${AUTO_STAPLE_SECONDS} seconds on its own. Tap it to go faster.`;
    this.upkeep = AUTO_STAPLER_UPKEEP;
  }

  progress() {
    if (this.level === 0 || !this.canActivate()) return null;
    return Math.min(1, this.elapsed / AUTO_STAPLE_SECONDS);
  }

  update(dt, game) {
    super.update(dt, game);
    if (this.press > 0) this.press = Math.max(0, this.press - dt);
    if (this.level === 0) return;

    // Automated: staple one set every AUTO_STAPLE_SECONDS while there's work and room
    if (!this.canActivate()) {
      this.elapsed = 0;
      return;
    }
    this.elapsed += dt;
    if (this.elapsed < AUTO_STAPLE_SECONDS) return;
    const leftover = this.elapsed - AUTO_STAPLE_SECONDS; // keep the rate exact across frames
    this.activate();
    this.elapsed = leftover;
  }

  drawIcon(ctx, x, y, s) {
    const drop = this.press > 0 ? s * 0.12 : 0;
    ctx.strokeStyle = INK;
    // Base
    ctx.fillStyle = "#6b7080";
    ctx.fillRect(x, y + s * 0.7, s, s * 0.2);
    ctx.strokeRect(x, y + s * 0.7, s, s * 0.2);
    // Arm
    ctx.fillStyle = "#ff7a7a";
    ctx.fillRect(x + s * 0.05, y + s * 0.4 + drop, s * 0.9, s * 0.22);
    ctx.strokeRect(x + s * 0.05, y + s * 0.4 + drop, s * 0.9, s * 0.22);
    // Hinge
    ctx.fillStyle = "#b8b8c4";
    ctx.fillRect(x + s * 0.8, y + s * 0.55, s * 0.15, s * 0.2);
  }
}

// Sells Zines dropped in its IN tray, one at a time.
class Outbox extends Machine {
  constructor(at) {
    super("Outbox", {
      description: `Sells Zines for $${ZINE_PRICE} each, up to two a second.`,
      upkeep: 2,
      ...at,
      portIn: true,
      wallOnly: true,
      cols: 2,
      rows: 2,
      accent: "#f2b866",
      inTray: new Tray({ item: HAND.ZINE, capacity: 10 }),
    });
    this.shipped = 0;
    this.elapsed = 0;
    this.level = 0; // 1 = upgraded: a second IN port
  }

  saveState() {
    return { ...super.saveState(), shipped: this.shipped, elapsed: this.elapsed, level: this.level };
  }

  // The saved ports already include the second IN port, so only the rest of the upgrade is reapplied.
  loadState(s) {
    super.loadState(s);
    this.shipped = s.shipped;
    this.elapsed = s.elapsed;
    if (s.level === 1) this.applyUpgrade();
  }

  upgradeCost() { return this.level === 0 ? OUTBOX_UPGRADE_COST : null; }
  upgradeHint() { return "Already has two inputs."; }

  upgrade() {
    this.applyUpgrade();
    this.addPort("in");
  }

  applyUpgrade() {
    this.level = 1;
    this.title = "Outbox (2 inputs)";
    this.description = `Sells Zines for $${ZINE_PRICE} each, up to two a second, through two IN triangles.`;
  }

  bodyHint() { return `Ships Zines for $${ZINE_PRICE} each. Shipped: ${this.shipped}`; }

  progress() {
    if (this.inTray.count === 0) return null;
    return Math.min(1, this.elapsed / SHIP_SECONDS);
  }

  update(dt, game) {
    super.update(dt, game);
    if (this.inTray.count === 0) {
      this.elapsed = 0;
      return;
    }
    this.elapsed += dt;
    if (this.elapsed < SHIP_SECONDS) return;

    this.elapsed -= SHIP_SECONDS; // carry the leftover so the rate stays exactly 2 a second
    this.inTray.take();
    this.shipped += 1;
    game.zinesSold += 1;
    game.sellZines(1);
    game.earn(ZINE_PRICE, "Zine sold");
    const { x, y, w } = this.rect;
    game.floatText(`+$${ZINE_PRICE}`, x + w / 2, y);
  }

  drawIcon(ctx, x, y, s) {
    ctx.strokeStyle = INK;
    ctx.fillStyle = "#d9a066";
    ctx.fillRect(x, y + s * 0.3, s, s * 0.6);
    ctx.strokeRect(x, y + s * 0.3, s, s * 0.6);
    // Open flaps
    ctx.fillStyle = "#c08850";
    ctx.fillRect(x - s * 0.08, y + s * 0.15, s * 0.45, s * 0.15);
    ctx.fillRect(x + s * 0.63, y + s * 0.15, s * 0.45, s * 0.15);
    // Tape
    ctx.fillStyle = "#f2d9a6";
    ctx.fillRect(x + s * 0.42, y + s * 0.3, s * 0.16, s * 0.6);
  }
}

// Takes anything you're holding.
class TrashCan extends Machine {
  constructor(at) {
    super("Trash Can", {
      description: "Throws away anything you drop in it.",
      upkeep: 0,
      ...at,
      cols: 1,
      rows: 2,
      accent: "#8a8f9c",
      inTray: new Tray({ endless: true }),
    });
  }

  use(game, part) {
    const { x, y, w } = this.rect;
    game.floatText(`- ${game.hand}`, x + w / 2, y, "#d93030");
    super.use(game, part);
  }

  drawIcon(ctx, x, y, s) {
    ctx.strokeStyle = INK;
    // Lid and handle
    ctx.fillStyle = "#6b7080";
    ctx.fillRect(x + s * 0.4, y, s * 0.2, s * 0.08);
    ctx.fillRect(x + s * 0.1, y + s * 0.08, s * 0.8, s * 0.1);
    ctx.strokeRect(x + s * 0.1, y + s * 0.08, s * 0.8, s * 0.1);
    // Bin with ribs
    ctx.fillStyle = "#b8b8c4";
    ctx.fillRect(x + s * 0.18, y + s * 0.22, s * 0.64, s * 0.75);
    ctx.strokeRect(x + s * 0.18, y + s * 0.22, s * 0.64, s * 0.75);
    ctx.fillStyle = "#8a8f9c";
    for (const f of [0.33, 0.48, 0.63]) ctx.fillRect(x + s * f, y + s * 0.3, s * 0.05, s * 0.6);
  }
}
