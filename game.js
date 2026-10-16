// Game state, camera, input and the render loop.

const TAP_SLOP = 8; // screen px a pointer can move before a tap becomes a drag
const LEDGER_KEEP = 200; // recent ledger entries kept for the list and rate

// Running costs and the fail state. Rent and machine upkeep are billed every minute. A bill can
// take cash below $0; you then have GRACE_SECONDS to get back to $0 or you go bankrupt.
const RENT_PER_SQUARE = 0.25; // $ per floor square per minute
const BILL_SECONDS = 60;
const FIRST_BILL_SECONDS = 120; // a little longer to get the first loop going
const GRACE_SECONDS = 60;

// Belts start locked: sell this many Zines by hand first.
const BELTS_UNLOCK_ZINES = 20;
const PORT_HIGHLIGHT_SECONDS = 15; // how long ports pulse after belts unlock
const BELT_TOOLS = ["belt", "express", "splitter", "bridge"];
const EXPAND_STEP = 2; // rows or columns added per expansion
const TILE_PRICE = 3; // cost of each new floor square

const Draw = {
  font(size, bold) {
    return `${bold ? "bold " : ""}${size}px "MS Sans Serif", "Microsoft Sans Serif", Tahoma, Geneva, sans-serif`;
  },

  // Split text into lines that fit maxWidth at the current font.
  wrap(ctx, text, maxWidth) {
    const lines = [];
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  },

  // Win95 tooltip with a bold title and wrapped text, below and right of (x, y) in screen space.
  infoTip(ctx, title, text, x, y) {
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
  },

  // Win95 tooltip, drawn in screen space.
  tooltip(ctx, text, x, y, alpha) {
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
  },
};

const Game = {
  cash: 0,
  // entries: { at, time, label, amount }, amount is negative for spending
  ledger: { totalEarned: 0, totalSpent: 0, salesCount: 0, entryCount: 0, entries: [] },
  hand: HAND.EMPTY,
  time: 0,
  nextBillIn: FIRST_BILL_SECONDS, // seconds until rent and upkeep are billed
  graceLeft: null, // seconds left to get back above $0, or null when not overdue
  bankrupt: false,
  peakIncome: 0, // best income per second seen, for the bankruptcy screen
  zinesSold: 0,
  beltsUnlocked: false,
  portHighlightUntil: 0, // game time until which ports pulse to show where belts connect
  floor: { cols: 8, rows: 10 },
  machines: [
    new PaperSupply({ col: 0, row: 1 }),
    new DesktopPrinter({ col: 4, row: 1 }),
    new ManualStapler({ col: 4, row: 4 }),
    new Outbox({ col: 0, row: 4 }),
    new TrashCan({ col: 1, row: 7 }),
  ],
  belts: new Map(), // tileKey -> Belt
  buildBatch: new Map(), // label -> { count, amount } since the pointer went down
  tool: "select", // select | belt | express | splitter | erase | upgrade
  licenses: new Set(), // keys of LICENSES bought in the Shop
  beltDir: 0, // direction for the next belt placed with a tap
  // Machine being dragged: { machine, from: { col, row }, valid }
  moving: null,
  // Belt, splitter or bridge being dragged: { piece, from: { col, row }, valid }.
  // It's lifted out of `belts` while it moves, so it neither runs nor blocks its own old square.
  movingBelt: null,
  // What the mouse is resting on, for the description tooltip: { target, x, y, since }
  hover: null,
  floaters: [], // { text, x, y, age, kind: "tip" | "float", color }, x/y in world space
  width: 0,
  height: 0,
  dpr: 1,

  // Money ----------------------------------------------------------------------

  // Every sale goes through here so the ledger stays in step with cash.
  earn(amount, label) {
    this.cash += amount;
    this.ledger.totalEarned += amount;
    this.ledger.salesCount += 1;
    this.record(amount, label, "sale");
  },

  spend(amount, label) {
    this.cash -= amount;
    this.ledger.totalSpent += amount;
    this.record(-amount, label, "spend");
  },

  // kind: "sale" | "spend" | "refund". Only sales count toward the earning rate.
  record(amount, label, kind) {
    this.ledger.entryCount += 1;
    this.ledger.entries.push({ at: new Date(), time: this.time, label, amount, kind });
    if (this.ledger.entries.length > LEDGER_KEEP) this.ledger.entries.shift();
  },

  // Belts and splitters are charged or refunded one piece at a time as you build,
  // so you can't overspend mid-drag, but each tap or drag becomes one ledger line per label.
  chargeBuild(label, amount) {
    const line = this.buildBatch.get(label) ?? { count: 0, amount: 0 };
    line.count += 1;
    line.amount += amount;
    this.buildBatch.set(label, line);
    this.cash += amount;
  },

  // Write the batch to the ledger. Called when the pointer lifts.
  commitBuild(wx, wy) {
    let net = 0;
    for (const [label, { count, amount }] of this.buildBatch) {
      this.ledger.totalSpent -= amount;
      this.record(amount, `${label} ×${count}`, amount < 0 ? "spend" : "refund");
      net += amount;
    }
    if (net < 0) this.floatText(`-${money(-net)}`, wx, wy, "#d93030");
    if (net > 0) this.floatText(`+${money(net)}`, wx, wy);
    this.buildBatch.clear();
  },

  earnedInLast(seconds) {
    return this.ledger.entries
      .filter((entry) => entry.kind === "sale" && entry.time >= this.time - seconds)
      .reduce((sum, entry) => sum + entry.amount, 0);
  },

  // Floor expansion --------------------------------------------------------------

  // The buy strips along the right and bottom edges of the floor, in world space.
  // Each costs TILE_PRICE per new square, so longer edges cost more.
  expanders() {
    const { cols, rows } = this.floor;
    const fw = cols * TILE;
    const fh = rows * TILE;
    const rightSquares = EXPAND_STEP * rows;
    const bottomSquares = EXPAND_STEP * cols;
    return [
      {
        side: "right",
        rect: { x: fw + 8, y: 0, w: TILE - 8, h: fh },
        label: `+${rightSquares} squares`,
        cost: rightSquares * TILE_PRICE,
      },
      {
        side: "bottom",
        rect: { x: 0, y: fh + 8, w: fw, h: TILE - 8 },
        label: `+${bottomSquares} squares`,
        cost: bottomSquares * TILE_PRICE,
      },
    ];
  },

  expanderAt(wx, wy) {
    return this.expanders().find(({ rect: r }) => wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h);
  },

  expand(expander, wx, wy) {
    const { cost } = expander;
    if (this.cash < cost) {
      this.showTip(`Need ${money(cost)} to expand.`, wx, wy);
      return;
    }
    this.spend(cost, `Floor ${expander.label}`);
    if (expander.side === "right") this.floor.cols += EXPAND_STEP;
    else this.floor.rows += EXPAND_STEP;
    this.floatText(`-${money(cost)}`, wx, wy, "#d93030");
  },

  // Tiles ------------------------------------------------------------------------

  tileAt(wx, wy) {
    return { col: Math.floor(wx / TILE), row: Math.floor(wy / TILE) };
  },

  inFloor(col, row) {
    return col >= 0 && row >= 0 && col < this.floor.cols && row < this.floor.rows;
  },

  machineAtTile(col, row) {
    return this.machineAt((col + 0.5) * TILE, (row + 0.5) * TILE);
  },

  // The IN or OUT tray covering this square, if there is one. `kind` is "in" or "out";
  // on a machine with several inputs, the square decides which input you get.
  trayAt(col, row, kind) {
    const wx = (col + 0.5) * TILE;
    const wy = (row + 0.5) * TILE;
    const machine = this.machineAt(wx, wy);
    const part = machine?.partAt(wx, wy);
    if (!part?.startsWith(kind)) return null;
    return machine.trayFor(part);
  },

  // Belts ------------------------------------------------------------------------

  unlockBelts() {
    this.beltsUnlocked = true;
    this.portHighlightUntil = this.time + PORT_HIGHLIGHT_SECONDS;
  },

  setTool(tool) {
    if (BELT_TOOLS.includes(tool) && !this.beltsUnlocked) {
      const left = BELTS_UNLOCK_ZINES - this.zinesSold;
      this.showTip(`Belts unlock after you sell ${left} more Zine${left === 1 ? "" : "s"}.`, Camera.x, Camera.y);
      return;
    }
    if (tool === "express" && !this.licenses.has("production")) {
      this.showTip(`Express Belts need the ${LICENSES.production.name} license.`, Camera.x, Camera.y);
      return;
    }
    this.tool = tool;
    const tips = {
      select: "Tap trays to use them. Drag machines and belts to move them. Drag open floor to look around.",
      belt: "Drag to lay belts. Tap a belt to rotate it. Right-click for Select.",
      express: "Drag to lay Express Belts. Drag over plain belts to upgrade them.",
      splitter: "Tap a belt or empty square for a splitter. Tap a splitter to rotate it.",
      bridge: "Tap a belt or empty square for a bridge. Lines can then cross it.",
      erase: "Tap or drag over belts to remove them.",
      upgrade: "Tap a highlighted machine to upgrade it.",
    };
    this.showTip(tips[tool], Camera.x, Camera.y);
  },

  beltAt(col, row) {
    return this.belts.get(tileKey(col, row));
  },

  canBuildBelt(col, row) {
    return this.inFloor(col, row) && !this.machineAtTile(col, row) && !this.beltAt(col, row);
  },

  // True when the Express tool would replace this belt rather than just turn it.
  upgradesBelt(belt) {
    return this.tool === "express" && belt.constructor === Belt;
  },

  // Place a belt (charged), or turn an existing one (free). With the Express tool, a plain
  // belt is swapped for an Express Belt, refunding the old one. Returns false if nothing was placed.
  setBelt(col, row, dir) {
    const existing = this.beltAt(col, row);
    if (existing && !this.upgradesBelt(existing)) {
      existing.dir = dir;
      return true;
    }
    if (!existing && !this.canBuildBelt(col, row)) return false;

    const belt = this.tool === "express" ? new ExpressBelt(col, row, dir) : new Belt(col, row, dir);
    const refund = existing ? existing.price : 0;
    if (this.cash + refund < belt.price) {
      this.showTip(`Need ${money(belt.price)} per belt.`, (col + 0.5) * TILE, (row + 0.5) * TILE);
      return false;
    }
    if (existing) {
      this.chargeBuild(`${existing.label} removed`, refund);
      belt.item = existing.item;
      belt.progress = existing.progress;
    }
    this.chargeBuild(belt.label, -belt.price);
    this.belts.set(tileKey(col, row), belt);
    return true;
  },

  // Direction for a new piece at (col, row): if a machine's OUT tray is next to it, face away
  // from the tray so the piece pulls from it straight away. Otherwise the last direction used.
  // In front of an OUT port, carry on the way it points. In front of an IN port, point into it.
  placementDir(col, row) {
    for (const m of this.machines) {
      for (const port of m.ports) {
        const outside = m.portOutside(port);
        if (outside.col !== col || outside.row !== row) continue;
        return port.kind === "out" ? port.dir : (port.dir + 2) % 4;
      }
    }

    const order = [this.beltDir, ...[0, 1, 2, 3].filter((dir) => dir !== this.beltDir)];
    const away = order.find((dir) => this.trayAt(col - DIRS[dir].x, row - DIRS[dir].y, "out")?.pullable);
    return away ?? this.beltDir;
  },

  // The machine and port a Belt tool tap on (col, row) would turn, if any.
  portAt(col, row) {
    const machine = this.machineAtTile(col, row);
    const port = machine?.portAtTile(col, row);
    return port ? { machine, port } : null;
  },

  // The IN tray on (col, row) that will take an item handed over from `from`, if any.
  // A machine with an IN port only takes from the square its port faces.
  inTrayFrom(col, row, from) {
    const tray = this.trayAt(col, row, "in");
    if (!tray) return null;
    return this.machineAtTile(col, row).takesInFrom(col, row, from) ? tray : null;
  },

  // Splitter tool tap: rotate a splitter, swap a belt for one, or place one on an empty square.
  tapSplitter(col, row, wx, wy) {
    const existing = this.beltAt(col, row);
    if (existing instanceof Splitter) {
      existing.dir = (existing.dir + 1) % 4;
      this.beltDir = existing.dir;
      return;
    }
    if (!existing && !this.canBuildBelt(col, row)) {
      this.showTip("Splitters need an empty square or a belt.", wx, wy);
      return;
    }
    const refund = existing ? existing.price : 0;
    if (this.cash + refund < SPLITTER_PRICE) {
      this.showTip(`Need ${money(SPLITTER_PRICE)} for a splitter.`, wx, wy);
      return;
    }

    const splitter = new Splitter(col, row, existing ? existing.dir : this.placementDir(col, row));
    if (existing) {
      this.chargeBuild(`${existing.label} removed`, refund);
      splitter.item = existing.item ?? null; // a bridge has no single item; its cargo is lost
    }
    this.chargeBuild("Splitters", -SPLITTER_PRICE);
    this.belts.set(tileKey(col, row), splitter);
  },

  // Bridge tool tap: place a bridge on an empty square, or swap a belt for one.
  tapBridge(col, row, wx, wy) {
    const existing = this.beltAt(col, row);
    if (existing instanceof Bridge) {
      this.showTip("Bridges carry both ways already. Erase it to remove it.", wx, wy);
      return;
    }
    if (!existing && !this.canBuildBelt(col, row)) {
      this.showTip("Bridges need an empty square or a belt.", wx, wy);
      return;
    }
    const refund = existing ? existing.price : 0;
    if (this.cash + refund < BRIDGE_PRICE) {
      this.showTip(`Need ${money(BRIDGE_PRICE)} for a bridge.`, wx, wy);
      return;
    }

    const bridge = new Bridge(col, row);
    if (existing) {
      this.chargeBuild(`${existing.label} removed`, refund);
      // Keep the belt's item on the lane running its way
      if (existing.item) {
        const lane = existing.dir % 2 === 0 ? bridge.over : bridge.under;
        lane.item = existing.item;
        lane.progress = existing.progress;
        lane.dir = existing.dir;
      }
    }
    this.chargeBuild("Bridges", -BRIDGE_PRICE);
    this.belts.set(tileKey(col, row), bridge);
  },

  // Lay belts along a drag, each pointing at the next square.
  layBelts(from, to) {
    let prev = from;
    for (const tile of stepTiles(from, to)) {
      const dir = dirBetween(prev, tile);
      this.setBelt(prev.col, prev.row, dir);
      this.setBelt(tile.col, tile.row, dir);
      this.beltDir = dir;
      prev = tile;
    }
  },

  // Remove belts and splitters along a drag, refunding each in full. Items on them are lost.
  eraseBelts(from, to) {
    for (const { col, row } of [from, ...stepTiles(from, to)]) {
      const piece = this.beltAt(col, row);
      if (!piece) continue;
      this.belts.delete(tileKey(col, row));
      this.chargeBuild(`${piece.label} removed`, piece.price);
    }
  },

  // Belt or Express tool tap: rotate a belt, upgrade it to express, or place a new one.
  tapBelt(col, row, wx, wy) {
    const belt = this.beltAt(col, row);
    if (belt && !this.upgradesBelt(belt)) {
      belt.dir = (belt.dir + 1) % 4;
      this.beltDir = belt.dir;
    } else if (!belt && !this.canBuildBelt(col, row)) {
      this.showTip("Belts need an empty floor square.", wx, wy);
    } else {
      this.setBelt(col, row, belt ? belt.dir : this.placementDir(col, row));
    }
  },

  // Select tool tap on a belt: pick its item up, or drop what you hold onto it.
  tapBeltByHand(belt, wx, wy) {
    if (belt instanceof Bridge) {
      this.showTip("Items on a bridge can't be grabbed.", wx, wy);
    } else if (belt.item !== null && !canCarry(belt.item)) {
      this.showTip("Rolls are too heavy to carry. Move them with belts.", wx, wy);
    } else if (this.hand === HAND.EMPTY && belt.item !== null) {
      this.hand = belt.item;
      belt.item = null;
    } else if (this.hand !== HAND.EMPTY && belt.item === null) {
      belt.item = this.hand;
      belt.progress = 0.5;
      this.hand = HAND.EMPTY;
    } else if (belt.item !== null) {
      this.showTip("Your hands are full.", wx, wy);
    } else {
      this.showTip("Empty belt. Use the Belt tool to rotate it.", wx, wy);
    }
  },

  // Machines ---------------------------------------------------------------------

  machineAt(wx, wy) {
    return this.machines.find((m) => m.contains(wx, wy));
  },

  // True when the machine fits on the floor at (col, row) without overlapping another or a belt.
  canPlace(machine, col, row) {
    if (col < 0 || row < 0) return false;
    if (machine.wallOnly && col !== 0 && row !== 0) return false;
    if (col + machine.cols > this.floor.cols || row + machine.rows > this.floor.rows) return false;
    for (const belt of this.belts.values()) {
      const inside = belt.col >= col && belt.col < col + machine.cols && belt.row >= row && belt.row < row + machine.rows;
      if (inside) return false;
    }
    return this.machines.every((other) =>
      other === machine ||
      col + machine.cols <= other.col ||
      other.col + other.cols <= col ||
      row + machine.rows <= other.row ||
      other.row + other.rows <= row
    );
  },

  // Free spot for the machine nearest the middle of the screen, or null if the floor is full.
  findSpot(machine) {
    const center = this.tileAt(Camera.x, Camera.y);
    let best = null;
    let bestDist = Infinity;
    for (let row = 0; row + machine.rows <= this.floor.rows; row++) {
      for (let col = 0; col + machine.cols <= this.floor.cols; col++) {
        if (!this.canPlace(machine, col, row)) continue;
        const dist = Math.hypot(col + machine.cols / 2 - center.col, row + machine.rows / 2 - center.row);
        if (dist < bestDist) {
          best = { col, row };
          bestDist = dist;
        }
      }
    }
    return best;
  },

  // Buy from the Shop and drop the machine in the nearest free spot. Returns true if bought.
  buy(entry) {
    if (entry.requires && !this.licenses.has(entry.requires)) {
      this.showTip(`Needs the ${LICENSES[entry.requires].name} license.`, Camera.x, Camera.y);
      return false;
    }
    if (entry.license && this.licenses.has(entry.license)) return false;
    if (this.cash < entry.price) {
      this.showTip(`Need ${money(entry.price)} for ${entry.name}.`, Camera.x, Camera.y);
      return false;
    }
    if (entry.license) {
      this.spend(entry.price, `License: ${entry.name}`);
      this.licenses.add(entry.license);
      return true;
    }

    const machine = entry.build();
    const spot = this.findSpot(machine);
    if (!spot) {
      this.showTip("No room. Expand the floor first.", Camera.x, Camera.y);
      return false;
    }

    this.spend(entry.price, `Bought ${entry.name}`);
    machine.col = spot.col;
    machine.row = spot.row;
    this.turnPortsInward(machine);
    machine.shake = 0.4; // wiggle so you spot where it landed
    this.machines.push(machine);
    const { x, y, w } = machine.rect;
    this.floatText(`-${money(entry.price)}`, x + w / 2, y, "#d93030");
    this.showTip("Drag it where you want it.", x + w / 2, y);
    return true;
  },

  upgradeMachine(machine, wx, wy) {
    const cost = machine.upgradeCost();
    if (cost === null) {
      this.showTip(machine.upgradeHint(), wx, wy);
      return;
    }
    if (this.cash < cost) {
      this.showTip(`Need ${money(cost)} to upgrade.`, wx, wy);
      return;
    }

    const oldTitle = machine.title;
    this.spend(cost, `Upgraded ${oldTitle}`);
    machine.upgrade();
    machine.shake = 0.4;
    const { x, y, w } = machine.rect;
    this.floatText(`-${money(cost)}`, x + w / 2, y, "#d93030");
    this.showTip(`${oldTitle} is now an ${machine.title}!`, x + w / 2, y);
  },

  // Moving a belt piece is free: it keeps its direction and anything it's carrying.
  startMoveBelt(piece) {
    this.belts.delete(tileKey(piece.col, piece.row));
    this.movingBelt = { piece, from: { col: piece.col, row: piece.row }, valid: true };
  },

  moveBeltTo(col, row) {
    this.movingBelt.piece.moveTo(col, row);
    this.movingBelt.valid = this.canBuildBelt(col, row);
  },

  // Drop it; an invalid spot sends it back where it came from.
  endMoveBelt() {
    const { piece, from, valid } = this.movingBelt;
    if (!valid) piece.moveTo(from.col, from.row);
    this.belts.set(tileKey(piece.col, piece.row), piece);
    this.movingBelt = null;
  },

  startMove(machine) {
    const allowed = machine.wallOnly ? this.allowedTiles(machine) : null;
    this.moving = { machine, from: { col: machine.col, row: machine.row }, valid: true, allowed };
  },

  // Every square some valid spot for the machine would cover, as tile keys. Only wall-only
  // machines need it, and they can only sit in column 0 or row 0, so just those spots are checked.
  allowedTiles(machine) {
    const spots = [];
    for (let row = 0; row < this.floor.rows; row++) spots.push({ col: 0, row });
    for (let col = 1; col < this.floor.cols; col++) spots.push({ col, row: 0 });
    const tiles = new Set();
    for (const { col, row } of spots) {
      if (!this.canPlace(machine, col, row)) continue;
      for (let r = row; r < row + machine.rows; r++) {
        for (let c = col; c < col + machine.cols; c++) tiles.add(tileKey(c, r));
      }
    }
    return tiles;
  },

  // Follows the pointer, snapped to the grid. The machine moves live; drop decides if it stays.
  moveTo(col, row) {
    const { machine } = this.moving;
    machine.col = col;
    machine.row = row;
    this.moving.valid = this.canPlace(machine, col, row);
  },

  endMove() {
    const { machine, from, valid } = this.moving;
    if (!valid) {
      if (machine.wallOnly && machine.col !== 0 && machine.row !== 0) {
        const { x, y, w } = machine.rect;
        this.showTip(`${machine.title} must go against the top or left wall.`, x + w / 2, y);
      }
      machine.col = from.col;
      machine.row = from.row;
    }
    this.turnPortsInward(machine);
    this.moving = null;
  },

  // Turn any port that faces off the floor (into a wall) to the next edge that faces the floor.
  turnPortsInward(machine) {
    for (const port of machine.ports) {
      for (let i = 0; i < machine.portEdges(port.kind).length; i++) {
        const outside = machine.portOutside(port);
        if (this.inFloor(outside.col, outside.row)) break;
        machine.rotatePort(port);
      }
    }
  },

  // Taps -------------------------------------------------------------------------

  handleTap(wx, wy) {
    const expander = this.expanderAt(wx, wy);
    if (expander) {
      this.expand(expander, wx, wy);
      return;
    }

    const { col, row } = this.tileAt(wx, wy);
    if (this.tool === "belt" || this.tool === "express") {
      const port = this.portAt(col, row);
      if (port) port.machine.rotatePort(port.port);
      else this.tapBelt(col, row, wx, wy);
      return;
    }
    if (this.tool === "splitter") {
      this.tapSplitter(col, row, wx, wy);
      return;
    }
    if (this.tool === "bridge") {
      this.tapBridge(col, row, wx, wy);
      return;
    }
    if (this.tool === "erase") {
      this.eraseBelts({ col, row }, { col, row });
      return;
    }
    if (this.tool === "upgrade") {
      const machine = this.machineAt(wx, wy);
      if (machine) this.upgradeMachine(machine, wx, wy);
      return;
    }

    const belt = this.beltAt(col, row);
    if (belt) {
      this.tapBeltByHand(belt, wx, wy);
      return;
    }

    const machine = this.machineAt(wx, wy);
    if (!machine) return;

    const part = machine.partAt(wx, wy);
    if (machine.canUse(this, part)) {
      machine.use(this, part);
    } else {
      machine.shake = 0.25;
      this.showTip(machine.hint(this, part), wx, wy);
    }
  },

  floatText(text, x, y, color = "#3ddc84") {
    this.floaters.push({ text, x, y, age: 0, kind: "float", color });
  },

  showTip(text, x, y) {
    // Only one tooltip at a time
    this.floaters = this.floaters.filter((f) => f.kind !== "tip");
    this.floaters.push({ text, x, y, age: 0, kind: "tip" });
  },

  // Running costs ------------------------------------------------------------------

  rentPerMinute() {
    return this.floor.cols * this.floor.rows * RENT_PER_SQUARE;
  },

  upkeepPerMinute() {
    return this.machines.reduce((sum, m) => sum + m.upkeep, 0);
  },

  billPerMinute() {
    return Math.round(this.rentPerMinute() + this.upkeepPerMinute());
  },

  incomePerSecond() {
    return this.earnedInLast(60) / 60;
  },

  payBills() {
    const bill = this.billPerMinute();
    this.spend(bill, "Rent & upkeep");
    this.floatText(`-${money(bill)} rent`, Camera.x, Camera.y, "#d93030");
  },

  // Bills come due every minute; being below $0 for GRACE_SECONDS ends the run.
  updateFinances(dt) {
    this.nextBillIn -= dt;
    if (this.nextBillIn <= 0) {
      this.payBills();
      this.nextBillIn += BILL_SECONDS;
    }

    if (this.cash >= 0) {
      this.graceLeft = null;
    } else {
      this.graceLeft = (this.graceLeft ?? GRACE_SECONDS) - dt;
      if (this.graceLeft <= 0) {
        this.bankrupt = true;
        Save.clear(); // a reload after the blue screen starts a new shop
      }
    }

    this.peakIncome = Math.max(this.peakIncome, this.incomePerSecond());
  },

  update(dt) {
    if (this.bankrupt) return; // the shop is frozen behind the blue screen
    this.time += dt;
    for (const m of this.machines) m.update(dt, this);
    for (const b of this.belts.values()) b.update(dt);
    moveItems(this);
    this.updateFinances(dt);
    if (!this.beltsUnlocked && this.zinesSold >= BELTS_UNLOCK_ZINES) this.unlockBelts();
    for (const f of this.floaters) f.age += dt;
    this.floaters = this.floaters.filter((f) => f.age < (f.kind === "tip" ? 1.6 : 1));
  },
};

// Camera looks at world point (x, y) in the middle of the screen.
const Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  maxZoom: 2.5,
  fitted: false, // fit the floor once at start; after that, resizes keep the player's view

  toWorld(sx, sy) {
    return { x: (sx - Game.width / 2) / this.zoom + this.x, y: (sy - Game.height / 2) / this.zoom + this.y };
  },

  toScreen(wx, wy) {
    return { x: (wx - this.x) * this.zoom + Game.width / 2, y: (wy - this.y) * this.zoom + Game.height / 2 };
  },

  // Zoom that shows the whole floor plus the expand strips, with a margin.
  fitZoom() {
    const w = (Game.floor.cols + 1) * TILE;
    const h = (Game.floor.rows + 1) * TILE;
    return Math.min(Game.width / (w + TILE), Game.height / (h + TILE), this.maxZoom);
  },

  // Follows the floor as it grows, so you can always zoom out a little past all of it.
  get minZoom() {
    return this.fitZoom() * 0.8;
  },

  // Show the whole floor. Also the Start menu's "View Whole Floor".
  fit() {
    this.zoom = this.fitZoom();
    this.x = ((Game.floor.cols + 1) * TILE) / 2;
    this.y = ((Game.floor.rows + 1) * TILE) / 2;
    this.fitted = true;
  },

  pan(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
  },

  // Zoom around a screen point so the spot under the finger stays put.
  zoomAt(sx, sy, factor) {
    const before = this.toWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  },

  // Keep the middle of the screen over the floor or its expand strips.
  clamp() {
    this.x = Math.min((Game.floor.cols + 1) * TILE, Math.max(0, this.x));
    this.y = Math.min((Game.floor.rows + 1) * TILE, Math.max(0, this.y));
  },
};

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
    const cost = m.upgradeCost();
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
      Draw.tooltip(ctx, f.text, p.x, p.y, alpha);
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
  drawFloor();
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
  const upkeep = target.upkeep ? ` Upkeep $${target.upkeep}/min.` : "";
  Draw.infoTip(ctx, target.title, `${target.description}${upkeep}`, hover.x, hover.y);
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

// Keyboard shortcuts for the tools, plus F to view the whole floor
window.addEventListener("keydown", (e) => {
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
  Game.update(dt);
  render();
  requestAnimationFrame(frame);
}

// Pick up the autosaved shop, if there is one, before the first frame.
const restored = Save.read(Game);
for (const machine of Game.machines) Game.turnPortsInward(machine);

UI.init({
  onTool: (tool) => Game.setTool(tool),
  onBuy: (entry) => Game.buy(entry),
  onFit: () => Camera.fit(),
  onNewShop: () => Save.newShop(),
  onSaveFile: () => Save.download(Game),
  onOpenFile: (file) => Save.open(file, Game),
});
if (restored) UI.welcomeBack();
layout();
Save.startAutosave(Game);
requestAnimationFrame(frame);
