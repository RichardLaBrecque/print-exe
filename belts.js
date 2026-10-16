// Conveyor belts. Each belt fills one grid square, points one way, and carries
// at most one item, moving it one square per second.
//
// A belt pulls from a machine's OUT tray when it points directly away from it,
// and pushes into a machine's IN tray when it points directly at it.

const BELT_SPEED = 1; // squares per second
const EXPRESS_SPEED = 2; // tier 2; splitters run at this speed too so they never bottleneck
const EXPRESS_PRICE = 6;
const BELT_PRICE = 2; // per square, refunded in full when erased
const SPLITTER_PRICE = 10;
const BRIDGE_PRICE = 8;

// Index is the belt's dir: 0 right, 1 down, 2 left, 3 up.
const DIRS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

function tileKey(col, row) {
  return `${col},${row}`;
}

function dirBetween(from, to) {
  return DIRS.findIndex((d) => d.x === to.col - from.col && d.y === to.row - from.row);
}

// Squares from `from` to `to`, one orthogonal step at a time (`from` not included).
// Lets a fast drag that skips squares still lay an unbroken line.
function stepTiles(from, to) {
  const steps = [];
  let { col, row } = from;
  while (col !== to.col || row !== to.row) {
    const dx = to.col - col;
    const dy = to.row - row;
    if (Math.abs(dx) >= Math.abs(dy)) col += Math.sign(dx);
    else row += Math.sign(dy);
    steps.push({ col, row });
  }
  return steps;
}

class Belt {
  constructor(col, row, dir) {
    this.col = col;
    this.row = row;
    this.dir = dir;
    this.item = null;
    this.progress = 0; // 0 at the entry edge, 1 at the exit edge
    this.lastServed = ""; // key of the feeding belt served last, for taking turns
  }

  get ahead() {
    const d = DIRS[this.dir];
    return { col: this.col + d.x, row: this.row + d.y };
  }

  get behind() {
    const d = DIRS[this.dir];
    return { col: this.col - d.x, row: this.row - d.y };
  }

  get title() { return "Belt"; }
  get description() { return "Moves one item a square per second. Drag with Select to move it for free."; }
  get price() { return BELT_PRICE; }
  get label() { return "Belts"; }
  get speed() { return BELT_SPEED; }
  get trackColor() { return "#7a7f8c"; }
  get chevronColor() { return "#a4a9b5"; }

  pointsAt(col, row) {
    const { ahead } = this;
    return ahead.col === col && ahead.row === row;
  }

  // Squares this belt can hand its item to, in the order it prefers.
  outputs() {
    return [{ ...this.ahead, side: 0 }];
  }

  // Can a belt at (col, row) feed into this one? Not from the square it points at,
  // or the two would swap items forever.
  acceptsFrom(col, row) {
    return !this.pointsAt(col, row);
  }

  // Called after the item went out through `side`. Splitters use it to alternate.
  sent(_side) {}

  get key() {
    return tileKey(this.col, this.row);
  }

  // Save and load. `type` is the class name, which save.js maps back to a constructor.
  saveState() {
    return {
      type: this.constructor.name,
      col: this.col,
      row: this.row,
      dir: this.dir,
      item: this.item,
      progress: this.progress,
      lastServed: this.lastServed,
    };
  }

  loadState(s) {
    this.dir = s.dir;
    this.item = s.item;
    this.progress = s.progress;
    this.lastServed = s.lastServed;
  }

  // Slide the item along. Hand-offs happen in moveItems so shared targets can take turns.
  // Progress may run up to one frame past 1, so the overshoot carries onto the next belt
  // and the rate stays exact instead of losing a frame at every square.
  update(dt) {
    if (this.item === null) return;
    const step = dt * this.speed;
    this.progress = Math.min(1 + step, this.progress + step);
  }

  // The three hand-offs. Each returns true if an item moved.

  takeFrom(tray) {
    if (this.item !== null || !tray.hasItem()) return false;
    this.item = tray.take();
    this.progress = 0;
    return true;
  }

  giveToBelt(next) {
    if (this.item === null || this.progress < 1 || next.item !== null) return false;
    next.receive(this.item, this.progress - 1, this);
    this.item = null;
    this.progress = 0;
    return true;
  }

  // Take an item handed over from `from` (a belt or lane next door). Bridge lanes override
  // this to set their direction from the side the item came in.
  receive(item, progress, _from) {
    this.item = item;
    this.progress = progress;
  }

  // The parts that carry items: a belt is one lane, a bridge is two.
  lanes() {
    return [this];
  }

  // Pick the piece up and put it on another square (used when dragging it with Select).
  moveTo(col, row) {
    this.col = col;
    this.row = row;
  }

  // Which lane takes an item handed over from (col, row), or null if none.
  receiverFrom(col, row) {
    return this.acceptsFrom(col, row) ? this : null;
  }

  // Belts and splitters pull from an OUT tray behind them; bridge lanes don't.
  get pullsFromTrays() {
    return true;
  }

  giveToTray(tray) {
    if (this.item === null || this.progress < 1 || !tray.accepts(this.item)) return false;
    tray.put(this.item);
    this.item = null;
    this.progress = 0;
    return true;
  }

  draw(ctx, time) {
    drawTrack(ctx, this.col, this.row, this.dir, time * this.speed, this.trackColor, this.chevronColor);
  }

  drawCargo(ctx) {
    if (this.item === null) return;
    const d = DIRS[this.dir];
    const along = (Math.min(1, this.progress) - 0.5) * TILE;
    const s = TILE * 0.42;
    const cx = this.col * TILE + TILE / 2 + d.x * along;
    const cy = this.row * TILE + TILE / 2 + d.y * along;
    ctx.lineWidth = 2;
    drawItem(ctx, this.item, cx - s / 2, cy - s / 2, s);
  }
}

// Move items between belts and trays for this frame.
//
// Several belts can share one target: three belts feeding one IN tray, three pulling
// from one OUT tray, or two belts merging onto one belt. Each target serves its belts
// in turn, starting after the one it served last, so they all get an even share.
function moveItems(game) {
  const queues = new Map(); // target (Tray or Belt) -> [{ key, serve }]
  const enqueue = (target, belt, serve) => {
    if (!queues.has(target)) queues.set(target, []);
    queues.get(target).push({ key: belt.key, serve });
  };

  const lanes = [...game.belts.values()].flatMap((piece) => piece.lanes());

  // Pushes first: each lane with an item at its end hands it to the first output that can
  // take it now, in the lane's preferred order. If none can, it queues at the first and waits.
  for (const belt of lanes) {
    if (belt.item === null || belt.progress < 1) continue;
    const targets = belt.outputs().map((out) => outputTarget(game, belt, out)).filter(Boolean);
    if (targets.length === 0) continue;
    const pick = targets.find((t) => t.ready()) ?? targets[0];
    enqueue(pick.target, belt, () => {
      if (!pick.give()) return false;
      belt.sent(pick.side);
      return true;
    });
  }
  for (const [target, waiting] of queues) takeTurns(target, waiting);

  // Then pulls, so a belt that just handed off can take its next item in the same frame.
  queues.clear();
  for (const belt of lanes) {
    if (belt.item !== null || !belt.pullsFromTrays) continue;
    const tray = game.trayAt(belt.behind.col, belt.behind.row, "out");
    if (tray?.pullable) enqueue(tray, belt, () => belt.takeFrom(tray));
  }
  for (const [target, waiting] of queues) takeTurns(target, waiting);
}

// What sits on an output square: a belt that accepts from this one, or an IN tray.
function outputTarget(game, belt, { col, row, side }) {
  const piece = game.beltAt(col, row);
  if (piece) {
    const next = piece.receiverFrom(belt.col, belt.row);
    if (!next) return null;
    return { target: next, side, ready: () => next.item === null, give: () => belt.giveToBelt(next) };
  }
  const tray = game.inTrayFrom(col, row, belt);
  if (tray) return { target: tray, side, ready: () => tray.accepts(belt.item), give: () => belt.giveToTray(tray) };
  return null;
}

// Serve waiting belts round-robin by tile key, starting after target.lastServed.
function takeTurns(target, waiting) {
  waiting.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let start = waiting.findIndex((w) => w.key > target.lastServed);
  if (start === -1) start = 0;

  for (let i = 0; i < waiting.length; i++) {
    const turn = waiting[(start + i) % waiting.length];
    if (turn.serve()) target.lastServed = turn.key;
  }
}

// Takes items in from behind and sends them out its left and right sides, alternating
// 50/50. If one side is blocked or has nothing attached, everything goes to the other.
class Splitter extends Belt {
  constructor(col, row, dir) {
    super(col, row, dir);
    this.nextSide = 0; // 0 left, 1 right: the side that gets the next item
  }

  saveState() {
    return { ...super.saveState(), nextSide: this.nextSide };
  }

  loadState(s) {
    super.loadState(s);
    this.nextSide = s.nextSide;
  }

  get title() { return "Splitter"; }
  get description() { return "Sends items out its left and right sides, taking turns. If one side is blocked, everything goes the other way."; }
  get price() { return SPLITTER_PRICE; }
  get label() { return "Splitters"; }
  get speed() { return EXPRESS_SPEED; }

  // Left and right of the facing direction, the preferred side first.
  outputs() {
    const sides = [(this.dir + 3) % 4, (this.dir + 1) % 4];
    const order = this.nextSide === 0 ? [0, 1] : [1, 0];
    return order.map((side) => {
      const d = DIRS[sides[side]];
      return { col: this.col + d.x, row: this.row + d.y, side };
    });
  }

  pointsAt(col, row) {
    return this.outputs().some((out) => out.col === col && out.row === row);
  }

  // Only feeds in from behind.
  acceptsFrom(col, row) {
    const { behind } = this;
    return behind.col === col && behind.row === row;
  }

  // Alternate after each item. A blocked side keeps its turn, so the split evens out again once it clears.
  sent(side) {
    this.nextSide = 1 - side;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.col * TILE + TILE / 2, this.row * TILE + TILE / 2);
    ctx.rotate((this.dir * Math.PI) / 2);
    const half = TILE / 2;

    // T-shaped track: input from -x, outputs to -y (left) and +y (right)
    ctx.beginPath();
    ctx.rect(-half + 2, -14, half, 28);
    ctx.rect(-14, -half + 2, 28, TILE - 4);
    ctx.fillStyle = "#7a7f8c";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();

    // Hub
    ctx.beginPath();
    ctx.roundRect(-16, -16, 32, 32, 6);
    ctx.fillStyle = "#ffd23f";
    ctx.fill();
    ctx.stroke();

    // Output arrows; the side due the next item is bright
    for (const [side, sign] of [[0, -1], [1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(-8, sign * (half - 16));
      ctx.lineTo(8, sign * (half - 16));
      ctx.lineTo(0, sign * (half - 5));
      ctx.closePath();
      ctx.fillStyle = side === this.nextSide ? "#ffffff" : "#a4a9b5";
      ctx.fill();
    }
    ctx.restore();
  }

  // The item rides in from behind to the hub.
  drawCargo(ctx) {
    if (this.item === null) return;
    const d = DIRS[this.dir];
    const along = (Math.min(1, this.progress) - 1) * (TILE / 2);
    const s = TILE * 0.38;
    const cx = this.col * TILE + TILE / 2 + d.x * along;
    const cy = this.row * TILE + TILE / 2 + d.y * along;
    ctx.lineWidth = 2;
    drawItem(ctx, this.item, cx - s / 2, cy - s / 2, s);
  }
}

// Tier 2 belt: twice as fast, so it keeps up with a Sheeter. Painting one over a
// plain belt upgrades it in place.
class ExpressBelt extends Belt {
  get title() { return "Express Belt"; }
  get description() { return "Moves two items a square per second, fast enough for a Sheeter."; }
  get price() { return EXPRESS_PRICE; }
  get label() { return "Express belts"; }
  get speed() { return EXPRESS_SPEED; }
  get trackColor() { return "#47598a"; }
  get chevronColor() { return "#9fc0ff"; }
}

// A belt track on one square, pointing `dir`, with chevrons scrolled by `travel` squares.
function drawTrack(ctx, col, row, dir, travel, trackColor, chevronColor) {
  ctx.save();
  ctx.translate(col * TILE + TILE / 2, row * TILE + TILE / 2);
  ctx.rotate((dir * Math.PI) / 2);

  // Track runs along +x once rotated
  const half = TILE / 2;
  ctx.beginPath();
  ctx.roundRect(-half + 2, -half + 9, TILE - 4, TILE - 18, 4);
  ctx.fillStyle = trackColor;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.clip();

  const spacing = 16;
  const offset = (travel * TILE) % spacing;
  ctx.beginPath();
  for (let cx = -half - spacing + offset; cx < half + spacing; cx += spacing) {
    ctx.moveTo(cx - 5, -10);
    ctx.lineTo(cx + 3, 0);
    ctx.lineTo(cx - 5, 10);
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = chevronColor;
  ctx.stroke();
  ctx.restore();
}

// One lane of a bridge: a belt that runs whichever way its last item came in.
class BridgeLane extends Belt {
  constructor(col, row, dir, axis) {
    super(col, row, dir);
    this.axis = axis; // "h" or "v"
  }

  // Two lanes share a square, so the key names the lane too (round-robin sorts by key).
  get key() { return `${tileKey(this.col, this.row)}:${this.axis}`; }
  get speed() { return EXPRESS_SPEED; }
  get pullsFromTrays() { return false; }

  // Carry straight on, away from the side the item came in.
  receive(item, progress, from) {
    super.receive(item, progress, from);
    this.dir = dirBetween(from, this);
  }
}

// Lets two belt lines cross on one square. Items from the left or right ride across the
// top deck; items from above or below pass underneath. Each lane carries straight through.
class Bridge {
  constructor(col, row) {
    this.col = col;
    this.row = row;
    this.dir = 0; // unused, but belts dragged over a bridge set it harmlessly
    this.over = new BridgeLane(col, row, 0, "h");
    this.under = new BridgeLane(col, row, 1, "v");
  }

  get title() { return "Bridge"; }
  get description() { return "Lets two belt lines cross. Left-right items go over, up-down items go under."; }
  get price() { return BRIDGE_PRICE; }
  get label() { return "Bridges"; }
  get key() { return tileKey(this.col, this.row); }

  lanes() {
    return [this.over, this.under];
  }

  saveState() {
    return { type: "Bridge", col: this.col, row: this.row, over: this.over.saveState(), under: this.under.saveState() };
  }

  loadState(s) {
    this.over.loadState(s.over);
    this.under.loadState(s.under);
  }

  moveTo(col, row) {
    this.col = col;
    this.row = row;
    this.over.moveTo(col, row);
    this.under.moveTo(col, row);
  }

  // Horizontal neighbours feed the deck, vertical ones the underpass.
  receiverFrom(col, row) {
    const dx = Math.abs(this.col - col);
    const dy = Math.abs(this.row - row);
    if (dx === 1 && dy === 0) return this.over;
    if (dx === 0 && dy === 1) return this.under;
    return null;
  }

  update(dt) {
    this.over.update(dt);
    this.under.update(dt);
  }

  // Underpass and its cargo first, then the deck on top.
  draw(ctx, time) {
    drawTrack(ctx, this.col, this.row, this.under.dir, time * EXPRESS_SPEED, "#5a5f6c", "#80859a");
    this.under.drawCargo(ctx);

    const x = this.col * TILE;
    const y = this.row * TILE;
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)"; // the deck's shadow on the underpass
    ctx.fillRect(x + 2, y + 13, TILE - 4, TILE - 18);
    drawTrack(ctx, this.col, this.row, this.over.dir, time * EXPRESS_SPEED, "#b07a3c", "#e8c690");
    // Guard rails along the deck
    ctx.fillStyle = INK;
    ctx.fillRect(x + 2, y + 7, TILE - 4, 3);
    ctx.fillRect(x + 2, y + TILE - 10, TILE - 4, 3);
  }

  drawCargo(ctx) {
    this.over.drawCargo(ctx);
  }
}
