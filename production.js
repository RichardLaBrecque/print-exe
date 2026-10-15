// Tier 2: production equipment.
//
//   Paper Roll Rack -> Roll Press -> Sheeter -> Saddle Stitcher -> Palletizer -> Truck Dock
//
// A roll-fed press prints rolls, which must be cut into sheets before they can be bound.
//
// One roll is SHEETS_PER_ROLL sheets. Ratios, built around belts (1/s) and Express Belts (2/s):
//   Roll Rack -> 1 Roll Press (1 roll / 5 s, a plain belt is plenty)
//   -> 1 Sheeter (10 sheets / 5 s = 2 sheets/s, needs an Express Belt out)
//   -> splitter -> 2 Saddle Stitchers (1/s each) -> merge onto 1 Express Belt (2/s)
//   -> Palletizer -> Truck Dock.
// Rolls can't be carried by hand (see canCarry), so tier 2 runs on belts.

const ROLL_PRESS_SECONDS = 5;
const SHEETS_PER_ROLL = 10;
const SHEETER_SECONDS = 5;
const STITCHER_SECONDS = 1;
const PRODUCTION_TRAY_SIZE = 10;
// Perfect binding: the book waits until both its cover and its guts are ready, then binds. 1 cover + GUTS_PER_BOOK guts sheets per book.
// Each binder needs 0.5 cover/s and 1 guts/s, so 1 Cover press + 2 Guts presses feed 4 binders.
const GUTS_PER_BOOK = 2;
const BIND_SECONDS = 2;

// The Finisher takes guts as a whole roll, skipping the sheeter. One roll is enough guts for
// SHEETS_PER_ROLL / GUTS_PER_BOOK books. At 1 book a second it uses exactly one Guts press's
// rolls (1 every 5 s) and 1 cover/s, so 1 Cover press + 2 Guts presses feed 2 Finishers.
const FINISH_SECONDS = 1;

const BOOKS_PER_PALLET = 10;
const PALLET_WRAP_SECONDS = 2;
const PALLETS_PER_TRUCK = 2;
const TRUCK_TRIP_SECONDS = 6;

// Each kind of book, its pallet, and what a pallet pays when a truck delivers it.
const PALLETS = [
  { book: HAND.BOOK, pallet: HAND.SADDLE_PALLET, bookPrice: 25 },
  { book: HAND.PERFECT_BOOK, pallet: HAND.PERFECT_PALLET, bookPrice: 90 },
];

function palletFor(book) {
  return PALLETS.find((p) => p.book === book).pallet;
}

function palletValue(pallet) {
  return PALLETS.find((p) => p.pallet === pallet).bookPrice * BOOKS_PER_PALLET;
}

// Tier 2 paper: Blank Rolls by the truckload. 10 rolls = 100 sheets for $150,
// against $2 a sheet for tier 1 paper.
class PaperRollRack extends Supply {
  constructor(at) {
    super("Paper Roll Rack", {
      description: `Holds Blank Rolls. Tap the middle to order 10 rolls (${10 * SHEETS_PER_ROLL} sheets of paper) for $150.`,
      upkeep: 10,
      ...at,
      accent: "#c9b98f",
      item: HAND.BLANK_ROLL,
      capacity: 30,
      startStock: 10,
      delivery: { amount: 10, price: 150, seconds: 5 },
      reorderCost: 250,
    });
  }
}

// Roll-fed press. Prints whole rolls for the job it's set to:
// Saddle-Stitch, Cover or Guts. Tap the body to switch jobs.
class RollPress extends Converter {
  constructor(at) {
    super("Roll Press", {
      description: `Prints a Blank Roll every ${ROLL_PRESS_SECONDS} seconds for its job: Saddle-Stitch, Cover or Guts. Tap the middle to switch jobs.`,
      upkeep: 60,
      ...at,
      cols: 4,
      rows: 3,
      accent: "#5b8def",
      input: HAND.BLANK_ROLL,
      output: PRINTED_ROLLS,
      seconds: ROLL_PRESS_SECONDS,
      capacity: 5,
    });
    this.job = JOBS[0];
  }

  saveState() {
    return { ...super.saveState(), job: JOBS.indexOf(this.job) };
  }

  loadState(s) {
    super.loadState(s);
    this.job = JOBS[s.job];
  }

  // The job is set when a roll starts, so switching mid-print finishes the current roll as it was.
  outputFor() {
    return this.job.roll;
  }

  canActivate() { return true; }

  activate(game) {
    this.job = JOBS[(JOBS.indexOf(this.job) + 1) % JOBS.length];
    const { x, y, w } = this.rect;
    const waiting = this.outTray.count > 0 && this.outTray.item !== this.job.roll;
    const note = waiting ? " It starts once the OUT tray is cleared." : "";
    game.showTip(`Now printing ${this.job.name}.${note}`, x + w / 2, y);
  }

  drawBody(ctx, r) {
    super.drawBody(ctx, r);
    this.drawBodyLabel(ctx, r, `JOB: ${this.job.label}`, this.job.color);
  }

  drawIcon(ctx, x, y, s) {
    ctx.strokeStyle = INK;
    // Frame
    ctx.fillStyle = "#b8b8c4";
    ctx.fillRect(x, y + s * 0.2, s, s * 0.65);
    ctx.strokeRect(x, y + s * 0.2, s, s * 0.65);
    // Web of paper running over two rollers
    ctx.fillStyle = "#fbf7ec";
    ctx.fillRect(x + s * 0.2, y + s * 0.3, s * 0.6, s * 0.08);
    for (const fx of [0.25, 0.75]) {
      ctx.beginPath();
      ctx.arc(x + s * fx, y + s * 0.5, s * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = "#6b7080";
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = this.statusLight();
    ctx.fillRect(x + s * 0.45, y + s * 0.7, s * 0.1, s * 0.08);
  }
}

// Cuts a printed roll into SHEETS_PER_ROLL sheets. Its 2 sheets/s
// output needs an Express Belt.
class Sheeter extends Converter {
  constructor(at) {
    super("Sheeter", {
      description: `Cuts a Printed Roll into ${SHEETS_PER_ROLL} Printed Sheets of the same job. Needs an Express Belt out to keep up.`,
      upkeep: 15,
      ...at,
      cols: 3,
      rows: 2,
      accent: "#3fb8a8",
      input: PRINTED_ROLLS,
      output: PRINTED_SHEETS,
      seconds: SHEETER_SECONDS,
      yields: SHEETS_PER_ROLL,
      capacity: 5,
      outCapacity: SHEETS_PER_ROLL * 2,
    });
  }

  // Sheets keep the job of the roll they were cut from.
  outputFor(roll) {
    return jobOf(roll).sheet;
  }

  drawIcon(ctx, x, y, s) {
    ctx.strokeStyle = INK;
    // Bed and sheet
    ctx.fillStyle = "#b8b8c4";
    ctx.fillRect(x, y + s * 0.55, s, s * 0.3);
    ctx.strokeRect(x, y + s * 0.55, s, s * 0.3);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + s * 0.1, y + s * 0.45, s * 0.8, s * 0.1);
    ctx.strokeRect(x + s * 0.1, y + s * 0.45, s * 0.8, s * 0.1);
    // Blade comes down while it works
    const drop = this.working ? Math.min(1, this.elapsed / this.seconds) * s * 0.2 : 0;
    ctx.fillStyle = "#3fb8a8";
    ctx.fillRect(x + s * 0.42, y + s * 0.1 + drop, s * 0.16, s * 0.3);
    ctx.strokeRect(x + s * 0.42, y + s * 0.1 + drop, s * 0.16, s * 0.3);
  }
}

// Saddle-stitch binder. Folds and stitches sheets into books.
class SaddleStitcher extends Converter {
  constructor(at) {
    super("Saddle Stitcher", {
      description: "Binds saddle-stitch Printed Sheets into Saddle-Stitched Books, one a second.",
      upkeep: 20,
      ...at,
      cols: 3,
      rows: 2,
      accent: "#e5703a",
      input: HAND.SADDLE_SHEET,
      output: HAND.BOOK,
      seconds: STITCHER_SECONDS,
      capacity: PRODUCTION_TRAY_SIZE,
    });
  }

  drawIcon(ctx, x, y, s) {
    ctx.strokeStyle = INK;
    // Saddle (an upside-down V) with a book draped over it
    ctx.beginPath();
    ctx.moveTo(x + s * 0.1, y + s * 0.85);
    ctx.lineTo(x + s * 0.5, y + s * 0.45);
    ctx.lineTo(x + s * 0.9, y + s * 0.85);
    ctx.closePath();
    ctx.fillStyle = "#b8b8c4";
    ctx.fill();
    ctx.stroke();
    // Stitching head
    ctx.fillStyle = "#e5703a";
    ctx.fillRect(x + s * 0.35, y + s * 0.05, s * 0.3, s * 0.25);
    ctx.strokeRect(x + s * 0.35, y + s * 0.05, s * 0.3, s * 0.25);
    ctx.fillStyle = this.statusLight();
    ctx.fillRect(x + s * 0.46, y + s * 0.32, s * 0.08, s * 0.08);
  }
}

// Shared by the Perfect Binder and the Finisher. Two IN trays stacked on the left, COVER on
// top and GUTS below. It waits until both parts are there, then binds one Perfect-Bound Book. Subclasses say where the guts come from.
class BookBinder extends Machine {
  constructor(title, { seconds, gutsTray, ...rest }) {
    super(title, {
      ...rest,
      inputs: [
        { label: "COVER", tray: new Tray({ item: HAND.COVER_SHEET, capacity: PRODUCTION_TRAY_SIZE }) },
        { label: "GUTS", tray: gutsTray },
      ],
      outTray: new Tray({ item: HAND.PERFECT_BOOK, capacity: PRODUCTION_TRAY_SIZE }),
    });
    this.seconds = seconds;
    this.binding = false;
    this.elapsed = 0;
  }

  saveState() {
    return { ...super.saveState(), binding: this.binding, elapsed: this.elapsed };
  }

  loadState(s) {
    super.loadState(s);
    this.binding = s.binding;
    this.elapsed = s.elapsed;
  }

  get coverTray() { return this.inputs[0].tray; }
  get gutsTray() { return this.inputs[1].tray; }

  // Override these two for a different guts source.
  hasGuts() { return this.gutsTray.count >= GUTS_PER_BOOK; }
  takeGuts() {
    for (let i = 0; i < GUTS_PER_BOOK; i++) this.gutsTray.take();
  }

  // What it's waiting on, or null when it has a full set: "COVER", "GUTS" or "ROOM".
  waitingOn() {
    if (this.coverTray.count < 1) return "COVER";
    if (!this.hasGuts()) return "GUTS";
    if (this.outTray.isFull()) return "ROOM";
    return null;
  }

  progress() {
    if (!this.binding) return null;
    return Math.min(1, this.elapsed / this.seconds);
  }

  bodyHint() {
    const waiting = this.waitingOn();
    if (waiting === "COVER") return "Waiting for a Cover sheet.";
    if (waiting === "GUTS") return this.gutsHint();
    if (waiting === "ROOM") return "Out tray is full. Collect the books.";
    return "Binding.";
  }

  gutsHint() { return `Waiting for Guts sheets (needs ${GUTS_PER_BOOK} per book).`; }

  update(dt, game) {
    super.update(dt, game);
    if (this.binding) {
      this.elapsed += dt;
      if (this.elapsed < this.seconds) return;
      this.binding = false;
      this.outTray.put(HAND.PERFECT_BOOK);
      this.elapsed -= this.seconds; // carry the leftover so the rate stays exact
    } else {
      this.elapsed = 0;
    }
    if (this.waitingOn() !== null) return;
    this.coverTray.take();
    this.takeGuts();
    this.binding = true;
  }

  drawBody(ctx, r) {
    super.drawBody(ctx, r);
    const waiting = this.binding ? null : this.waitingOn();
    const label = waiting === null ? "BINDING" : waiting === "ROOM" ? "OUT FULL" : `WAITING: ${waiting}`;
    this.drawBodyLabel(ctx, r, label, waiting === null ? "#2e7d4f" : "#d93030");
  }
}

// Perfect binder: cover sheets + guts sheets.
class PerfectBinder extends BookBinder {
  constructor(at) {
    super("Perfect Binder", {
      description: `Binds 1 Cover sheet and ${GUTS_PER_BOOK} Guts sheets into a Perfect-Bound Book every ${BIND_SECONDS} seconds.`,
      upkeep: 25,
      ...at,
      cols: 4,
      rows: 2,
      accent: "#e5703a",
      seconds: BIND_SECONDS,
      gutsTray: new Tray({ item: HAND.GUTS_SHEET, capacity: PRODUCTION_TRAY_SIZE * 2 }),
    });
  }

  drawIcon(ctx, x, y, s) {
    ctx.lineWidth = 2;
    // Clamp over a glued book block
    ctx.strokeStyle = INK;
    ctx.fillStyle = "#b8b8c4";
    ctx.fillRect(x, y + s * 0.05, s, s * 0.22);
    ctx.strokeRect(x, y + s * 0.05, s, s * 0.22);
    drawItem(ctx, HAND.PERFECT_BOOK, x + s * 0.15, y + s * 0.3, s * 0.7);
  }
}

// Inline finisher: cover sheets + a whole guts roll, no sheeter needed.
// It unrolls one guts roll at a time into SHEETS_PER_ROLL sheets' worth of guts.
class Finisher extends BookBinder {
  constructor(at) {
    super("Finisher", {
      description: `Binds Cover sheets with a whole Guts roll, so no sheeter is needed. Makes a Perfect-Bound Book every second.`,
      upkeep: 50,
      ...at,
      cols: 4,
      rows: 3,
      accent: "#c2185b",
      seconds: FINISH_SECONDS,
      gutsTray: new Tray({ item: HAND.GUTS_ROLL, capacity: 3 }),
    });
    this.gutsLeft = 0; // guts sheets left on the roll that's loaded
  }

  saveState() {
    return { ...super.saveState(), gutsLeft: this.gutsLeft };
  }

  loadState(s) {
    super.loadState(s);
    this.gutsLeft = s.gutsLeft;
  }

  hasGuts() {
    return this.gutsLeft >= GUTS_PER_BOOK || this.gutsTray.count > 0;
  }

  takeGuts() {
    if (this.gutsLeft < GUTS_PER_BOOK) {
      this.gutsTray.take();
      this.gutsLeft += SHEETS_PER_ROLL;
    }
    this.gutsLeft -= GUTS_PER_BOOK;
  }

  gutsHint() { return "Waiting for a Guts roll. Send one straight from a press set to Guts."; }

  drawBody(ctx, r) {
    super.drawBody(ctx, r);
    // How much of the loaded guts roll is left
    ctx.font = Draw.font(10, true);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = INK;
    ctx.fillText(`ROLL ${this.gutsLeft}/${SHEETS_PER_ROLL}`, r.x + r.w / 2, r.y + r.h - 24);
    ctx.textAlign = "left";
  }

  drawIcon(ctx, x, y, s) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    // Guts roll feeding a trimmer, book coming out
    drawItem(ctx, HAND.GUTS_ROLL, x, y + s * 0.05, s * 0.45);
    ctx.fillStyle = "#b8b8c4";
    ctx.fillRect(x + s * 0.4, y + s * 0.15, s * 0.2, s * 0.6);
    ctx.strokeRect(x + s * 0.4, y + s * 0.15, s * 0.2, s * 0.6);
    drawItem(ctx, HAND.PERFECT_BOOK, x + s * 0.6, y + s * 0.4, s * 0.4);
  }
}

// Stacks BOOKS_PER_PALLET books of one kind and stretch-wraps them into one pallet.
class Palletizer extends Machine {
  constructor(at) {
    super("Palletizer", {
      description: `Wraps ${BOOKS_PER_PALLET} books of one kind into a pallet.`,
      upkeep: 10,
      ...at,
      cols: 3,
      rows: 2,
      accent: "#a0784a",
      inTray: new Tray({ kinds: PALLETS.map((p) => p.book), capacity: BOOKS_PER_PALLET * 2 }),
      outTray: new Tray({ kinds: PALLETS.map((p) => p.pallet), capacity: 3 }),
    });
    this.wrapping = false;
    this.making = null; // the kind of pallet being wrapped
    this.elapsed = 0;
  }

  saveState() {
    return { ...super.saveState(), wrapping: this.wrapping, making: this.making, elapsed: this.elapsed };
  }

  loadState(s) {
    super.loadState(s);
    this.wrapping = s.wrapping;
    this.making = s.making;
    this.elapsed = s.elapsed;
  }

  progress() {
    if (!this.wrapping) return null;
    return Math.min(1, this.elapsed / PALLET_WRAP_SECONDS);
  }

  bodyHint() {
    if (this.outTray.isFull()) return "Out tray is full. Send pallets to a Truck Dock.";
    return `Wraps a pallet once it has ${BOOKS_PER_PALLET} books of one kind (${this.inTray.count} now).`;
  }

  update(dt, game) {
    super.update(dt, game);
    if (this.wrapping) {
      this.elapsed += dt;
      if (this.elapsed < PALLET_WRAP_SECONDS) return;
      this.wrapping = false;
      this.outTray.put(this.making);
    }
    this.elapsed = 0;
    if (this.inTray.count < BOOKS_PER_PALLET) return;
    const pallet = palletFor(this.inTray.item);
    if (!this.outTray.fits(pallet) || this.outTray.isFull()) return;
    for (let i = 0; i < BOOKS_PER_PALLET; i++) this.inTray.take();
    this.making = pallet;
    this.wrapping = true;
  }

  drawIcon(ctx, x, y, s) {
    ctx.lineWidth = 2;
    drawItem(ctx, this.making ?? HAND.SADDLE_PALLET, x, y, s);
  }
}

// Loads pallets onto a truck. When the truck is full it drives off, and you're paid when it delivers.
class TruckDock extends Machine {
  constructor(at) {
    super("Truck Dock", {
      description: `Loads ${PALLETS_PER_TRUCK} pallets onto a truck and gets paid when it delivers.`,
      upkeep: 20,
      ...at,
      cols: 3,
      rows: 3,
      accent: "#6b7080",
      inTray: new Tray({ kinds: PALLETS.map((p) => p.pallet), capacity: 4 }),
    });
    this.cargo = []; // pallets on the truck; a truck can carry mixed kinds
    this.away = 0; // seconds left on the delivery trip, 0 = docked
    this.trips = 0;
  }

  saveState() {
    return { ...super.saveState(), cargo: [...this.cargo], away: this.away, trips: this.trips };
  }

  loadState(s) {
    super.loadState(s);
    this.cargo = [...s.cargo];
    this.away = s.away;
    this.trips = s.trips;
  }

  get loaded() {
    return this.cargo.length;
  }

  progress() {
    if (this.away > 0) return 1 - this.away / TRUCK_TRIP_SECONDS;
    return this.loaded / PALLETS_PER_TRUCK;
  }

  bodyHint() {
    if (this.away > 0) return "Truck is out on delivery.";
    return `Truck loading: ${this.loaded}/${PALLETS_PER_TRUCK} pallets.`;
  }

  update(dt, game) {
    super.update(dt, game);

    if (this.away > 0) {
      this.away = Math.max(0, this.away - dt);
      if (this.away > 0) return;
      // Delivered
      this.trips += 1;
      const pay = this.cargo.reduce((sum, pallet) => sum + palletValue(pallet), 0);
      game.earn(pay, `Truck delivered ${this.loaded} pallets`);
      const { x, y, w } = this.rect;
      game.floatText(`+${money(pay)}`, x + w / 2, y);
      this.cargo = [];
    }

    while (this.loaded < PALLETS_PER_TRUCK && this.inTray.count > 0) this.cargo.push(this.inTray.take());
    if (this.loaded === PALLETS_PER_TRUCK) this.away = TRUCK_TRIP_SECONDS;
  }

  drawIcon(ctx, x, y, s) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    if (this.away > 0) {
      // Empty bay with the dock door
      ctx.fillStyle = "#d8d8de";
      ctx.fillRect(x, y + s * 0.2, s, s * 0.6);
      ctx.strokeRect(x, y + s * 0.2, s, s * 0.6);
      ctx.fillStyle = "#b8b8c4";
      for (const f of [0.3, 0.45, 0.6]) ctx.fillRect(x + s * 0.05, y + s * f, s * 0.9, s * 0.06);
      return;
    }
    // Box truck: cargo box and cab
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y + s * 0.15, s * 0.7, s * 0.55);
    ctx.strokeRect(x, y + s * 0.15, s * 0.7, s * 0.55);
    ctx.fillStyle = "#e5703a";
    ctx.fillRect(x + s * 0.7, y + s * 0.35, s * 0.3, s * 0.35);
    ctx.strokeRect(x + s * 0.7, y + s * 0.35, s * 0.3, s * 0.35);
    ctx.fillStyle = "#9fc0ff";
    ctx.fillRect(x + s * 0.78, y + s * 0.4, s * 0.14, s * 0.12);
    // Pallets aboard
    ctx.fillStyle = "#d9a066";
    for (let i = 0; i < this.loaded; i++) ctx.fillRect(x + s * (0.06 + i * 0.32), y + s * 0.35, s * 0.26, s * 0.3);
    // Wheels
    ctx.fillStyle = INK;
    for (const fx of [0.18, 0.55, 0.85]) {
      ctx.beginPath();
      ctx.arc(x + s * fx, y + s * 0.76, s * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
