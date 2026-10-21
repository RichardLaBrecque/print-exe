// Game state (money, the floor, machines and belts) and the camera. main.js draws it and handles input.

import { DIRS, TILE, dirBetween, stepTiles, tileKey } from "./grid.js";
import { money } from "./format.js";
import { HAND, canCarry } from "./items.js";
import { BRIDGE_PRICE, Belt, Bridge, ExpressBelt, SPLITTER_PRICE, Splitter, moveItems } from "./belts.js";
import { DesktopPrinter, ManualStapler, Outbox, PaperSupply, TrashCan } from "./machines.js";
import { LICENSES } from "./catalog.js";

const LEDGER_KEEP = 200; // recent ledger entries kept for the Ledger's list
const INCOME_SECONDS = 60; // income is averaged over this window, so sales are kept this long

// Running costs and the fail state. Rent and machine upkeep are billed every minute. A bill can
// take cash below $0; you then have GRACE_SECONDS to get back to $0 or you go bankrupt.
// Extra upkeep from jammed machines (see upkeepMultiplier) builds up between bills and is
// billed with them as its own ledger line.
const RENT_PER_SQUARE = 0.25; // $ per floor square per minute
const BILL_SECONDS = 60;
const FIRST_BILL_SECONDS = 120; // a little longer to get the first loop going
const GRACE_SECONDS = 60;

// Belts start locked: sell this many Zines by hand first.
export const BELTS_UNLOCK_ZINES = 20;
const PORT_HIGHLIGHT_SECONDS = 15; // how long ports pulse after belts unlock
const BELT_TOOLS = ["belt", "express", "splitter", "bridge"];
// Scorecard records: game time each was first reached, null until then. Saves from before
// records were kept mark ones they had already reached as MILESTONE_UNKNOWN.
export const MILESTONE_UNKNOWN = -1;
const ZINE_RATE_SECONDS = 60; // Zines/s is averaged over this window, like income

const EXPAND_STEP = 2; // rows or columns added per expansion
const TILE_PRICE = 3; // cost of each new floor square

// The yard outside the top and left walls: a planter bed against the wall, then parking.
// Decoration only; nothing can be built there.
export const YARD = TILE; // depth of the yard strip
export const PLANTER = 16; // depth of the planter bed
export const STALL = TILE / 2; // width of a parking space

export const Game = {
  cash: 0,
  // entries: { at, time, label, amount }, amount is negative for spending
  ledger: { totalEarned: 0, totalSpent: 0, salesCount: 0, entryCount: 0, entries: [] },
  hand: HAND.EMPTY,
  time: 0,
  nextBillIn: FIRST_BILL_SECONDS, // seconds until rent and upkeep are billed
  jamUpkeepOwed: 0, // $ of extra upkeep from jammed machines, billed with the next rent
  graceLeft: null, // seconds left to get back above $0, or null when not overdue
  bankrupt: false,
  peakIncome: 0, // best income per second seen, for the bankruptcy screen
  zinesSold: 0,
  firstTruck: null, // the scorecard() numbers from when the first full truck left: the soft win
  milestones: { production: null, profit10k: null, profit100k: null },
  sales: [], // { time, amount } for the last INCOME_SECONDS, for the income rate
  zineSales: [], // { time, count } for the last ZINE_RATE_SECONDS, from Outboxes and trucks
  bestZinesPerSecond: 0,
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
    this.sales.push({ time: this.time, amount });
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

  // From `sales`, not the ledger: the ledger keeps only its last LEDGER_KEEP lines, which a busy
  // shop writes in under a minute. Sales are kept for INCOME_SECONDS, so `seconds` can't be longer.
  earnedInLast(seconds) {
    return this.sales
      .filter((sale) => sale.time >= this.time - seconds)
      .reduce((sum, sale) => sum + sale.amount, 0);
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
      belt: "Drag to lay belts. Tap a belt or a tray's triangle to turn it. Right-click for Select.",
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
    const cost = machine.upgradeCost(this);
    if (cost === null) {
      this.showTip(machine.upgradeHint(this), wx, wy);
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
    this.showTip(machine.upgradedTip(), x + w / 2, y);
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
      for (let i = 0; i < machine.edgesFor(port).length; i++) {
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

  // The extra upkeep jammed machines are costing right now, $ per minute.
  jamUpkeepPerMinute() {
    return this.machines.reduce((sum, m) => sum + m.upkeep * (m.upkeepMultiplier() - 1), 0);
  },

  // What the next bill will charge: rent and upkeep, plus jam upkeep owed so far.
  nextBillTotal() {
    return this.billPerMinute() + Math.round(this.jamUpkeepOwed);
  },

  incomePerSecond() {
    return this.earnedInLast(INCOME_SECONDS) / INCOME_SECONDS;
  },

  // Outboxes sell one Zine at a time; a truck sells every zine on its pallets at once.
  sellZines(count) {
    this.zineSales.push({ time: this.time, count });
  },

  zinesPerSecond() {
    const recent = this.zineSales.filter((sale) => sale.time >= this.time - ZINE_RATE_SECONDS);
    return recent.reduce((sum, sale) => sum + sale.count, 0) / ZINE_RATE_SECONDS;
  },

  // Earned less spent since the shop opened, which started with $0.
  totalProfit() {
    return this.ledger.totalEarned - this.ledger.totalSpent;
  },

  // Drop sales older than their rate windows, stamp each record the first time it's reached,
  // and keep the best Zines/s.
  updateRecords() {
    this.sales = this.sales.filter((sale) => sale.time >= this.time - INCOME_SECONDS);
    this.zineSales = this.zineSales.filter((sale) => sale.time >= this.time - ZINE_RATE_SECONDS);
    this.bestZinesPerSecond = Math.max(this.bestZinesPerSecond, this.zinesPerSecond());

    const { milestones } = this;
    const profit = this.totalProfit();
    if (milestones.production === null && this.licenses.has("production")) milestones.production = this.time;
    if (milestones.profit10k === null && profit >= 10_000) milestones.profit10k = this.time;
    if (milestones.profit100k === null && profit >= 100_000) milestones.profit100k = this.time;
  },

  // Sales over the last minute less rent and upkeep, per second. Negative when losing money.
  profitPerSecond() {
    return this.incomePerSecond() - (this.billPerMinute() + this.jamUpkeepPerMinute()) / 60;
  },

  // Squares covered by a machine or a belt piece, counting one being dragged.
  usedSquares() {
    const machineSquares = this.machines.reduce((sum, m) => sum + m.cols * m.rows, 0);
    return machineSquares + this.belts.size + (this.movingBelt ? 1 : 0);
  },

  // The numbers players can compare and aim for, each a separate target. The floor usage
  // ratio is profit per minute for each floor square, times the share of the floor in use,
  // so it goes up by earning more from the same floor and by leaving less of it empty.
  scorecard() {
    const squares = this.floor.cols * this.floor.rows;
    const used = this.usedSquares();
    const profit = this.profitPerSecond();
    return {
      time: this.time,
      profit,
      zinesPerSecond: this.zinesPerSecond(),
      cols: this.floor.cols,
      rows: this.floor.rows,
      used,
      ratio: ((profit * 60) / squares) * (used / squares),
    };
  },

  // A Truck Dock calls this when a full truck drives off. The first one is the soft win;
  // the shop keeps running after it.
  truckLeft() {
    if (this.firstTruck === null) this.firstTruck = this.scorecard();
  },

  payBills() {
    const bill = this.billPerMinute();
    this.spend(bill, "Rent & upkeep");
    const jam = Math.round(this.jamUpkeepOwed);
    this.jamUpkeepOwed = 0;
    if (jam > 0) this.spend(jam, "Jammed machine upkeep");
    this.floatText(`-${money(bill + jam)} rent`, Camera.x, Camera.y, "#d93030");
  },

  // Bills come due every minute; being below $0 for GRACE_SECONDS ends the run.
  updateFinances(dt) {
    this.jamUpkeepOwed += (this.jamUpkeepPerMinute() * dt) / 60;
    this.nextBillIn -= dt;
    if (this.nextBillIn <= 0) {
      this.payBills();
      this.nextBillIn += BILL_SECONDS;
    }

    if (this.cash >= 0) {
      this.graceLeft = null;
    } else {
      this.graceLeft = (this.graceLeft ?? GRACE_SECONDS) - dt;
      if (this.graceLeft <= 0) this.bankrupt = true;
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
    this.updateRecords();
    if (!this.beltsUnlocked && this.zinesSold >= BELTS_UNLOCK_ZINES) this.unlockBelts();
    for (const f of this.floaters) f.age += dt;
    this.floaters = this.floaters.filter((f) => f.age < (f.kind === "tip" ? 1.6 : 1));
  },
};

// Camera looks at world point (x, y) in the middle of the screen.
export const Camera = {
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

  // Zoom that shows the yard, the whole floor and the expand strips, with a margin.
  fitZoom() {
    const w = YARD + (Game.floor.cols + 1) * TILE;
    const h = YARD + (Game.floor.rows + 1) * TILE;
    return Math.min(Game.width / (w + TILE), Game.height / (h + TILE), this.maxZoom);
  },

  // Follows the floor as it grows, so you can always zoom out a little past all of it.
  get minZoom() {
    return this.fitZoom() * 0.8;
  },

  // Show the whole floor. Also the Start menu's "View Whole Floor".
  fit() {
    this.zoom = this.fitZoom();
    this.x = ((Game.floor.cols + 1) * TILE - YARD) / 2;
    this.y = ((Game.floor.rows + 1) * TILE - YARD) / 2;
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

  // Keep the middle of the screen over the yard, the floor or its expand strips.
  clamp() {
    this.x = Math.min((Game.floor.cols + 1) * TILE, Math.max(-YARD, this.x));
    this.y = Math.min((Game.floor.rows + 1) * TILE, Math.max(-YARD, this.y));
  },
};
