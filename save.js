// Saving and loading. The shop autosaves to this browser's localStorage, and can be
// downloaded or opened as a .json save file. Machines and belts save their own state
// (saveState / loadState); this file handles the game as a whole.
//
// Browser storage can be missing or blocked (private windows, previews), so every
// access is wrapped: the game still runs, it just won't remember.

const SAVE_KEY = "print95.save";
const BACKUP_KEY = "print95.save.backup"; // a save that failed to load, kept before the autosave replaces it
const SAVE_VERSION = 1;
const AUTOSAVE_SECONDS = 10;

// Class names in a save file, back to the constructors. Written out so a save can only
// ever build these classes.
const MACHINE_TYPES = {
  PaperSupply: (at) => new PaperSupply(at),
  DesktopPrinter: (at) => new DesktopPrinter(at),
  ManualStapler: (at) => new ManualStapler(at),
  Outbox: (at) => new Outbox(at),
  TrashCan: (at) => new TrashCan(at),
  PaperRollRack: (at) => new PaperRollRack(at),
  RollPress: (at) => new RollPress(at),
  SheetFedPress: (at) => new SheetFedPress(at),
  Sheeter: (at) => new Sheeter(at),
  SaddleStitcher: (at) => new SaddleStitcher(at),
  PerfectBinder: (at) => new PerfectBinder(at),
  Finisher: (at) => new Finisher(at),
  Palletizer: (at) => new Palletizer(at),
  TruckDock: (at) => new TruckDock(at),
};

const BELT_TYPES = {
  Belt: (s) => new Belt(s.col, s.row, s.dir),
  ExpressBelt: (s) => new ExpressBelt(s.col, s.row, s.dir),
  Splitter: (s) => new Splitter(s.col, s.row, s.dir),
  Bridge: (s) => new Bridge(s.col, s.row),
};

// Items renamed since saves began. Saddle-stitched books became plain Zines and
// perfect-bound books became Perfect-Bound Zines.
const OLD_ITEM_NAMES = {
  "Saddle-Stitched Book": HAND.ZINE,
  "Perfect-Bound Book": HAND.PERFECT_ZINE,
};

// Saves from before Scorecard records: anything already reached gets MILESTONE_UNKNOWN,
// since when it happened wasn't kept. The rest are stamped as they're reached.
function oldSaveMilestones(data) {
  const profit = data.ledger.totalEarned - data.ledger.totalSpent;
  const reached = (done) => (done ? MILESTONE_UNKNOWN : null);
  return {
    production: reached(data.licenses.includes("production")),
    profit10k: reached(profit >= 10_000),
    profit100k: reached(profit >= 100_000),
  };
}

function renameOldItems(data) {
  let text = JSON.stringify(data);
  for (const [oldName, newName] of Object.entries(OLD_ITEM_NAMES)) {
    text = text.replaceAll(JSON.stringify(oldName), JSON.stringify(newName));
  }
  return JSON.parse(text);
}

const Save = {
  // Set once New Shop or Open Save File has replaced the autosave and is reloading. The page's
  // pagehide/visibilitychange autosave would otherwise write the old shop back over it.
  leaving: false,

  // Everything needed to rebuild the shop, as plain JSON-ready data.
  snapshot(game) {
    // A machine or belt mid-drag is saved where it was picked up from
    const machines = game.machines.map((m) => {
      const state = m.saveState();
      if (game.moving?.machine === m) Object.assign(state, game.moving.from);
      return state;
    });
    const belts = [...game.belts.values()].map((piece) => piece.saveState());
    if (game.movingBelt) belts.push({ ...game.movingBelt.piece.saveState(), ...game.movingBelt.from });

    return {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      cash: game.cash,
      hand: game.hand,
      time: game.time,
      floor: { ...game.floor },
      licenses: [...game.licenses],
      nextBillIn: game.nextBillIn,
      jamUpkeepOwed: game.jamUpkeepOwed,
      graceLeft: game.graceLeft,
      peakIncome: game.peakIncome,
      zinesSold: game.zinesSold,
      firstTruck: game.firstTruck,
      milestones: { ...game.milestones },
      zineSales: game.zineSales.map((sale) => ({ ...sale })),
      bestZinesPerSecond: game.bestZinesPerSecond,
      beltsUnlocked: game.beltsUnlocked,
      beltDir: game.beltDir,
      ledger: {
        ...game.ledger,
        entries: game.ledger.entries.map((entry) => ({ ...entry, at: entry.at.toISOString() })),
      },
      camera: { x: Camera.x, y: Camera.y, zoom: Camera.zoom },
      machines,
      belts,
    };
  },

  // Rebuild the shop from a snapshot. Throws if the data isn't a save this version understands.
  // Everything is read from the save before the game changes, so a save that fails part-way
  // leaves the game as it was.
  restore(game, data) {
    if (data?.version !== SAVE_VERSION) throw new Error("Not a Print95 save, or from another version.");
    data = renameOldItems(data);

    const machines = data.machines.map((s) => {
      const build = MACHINE_TYPES[s.type];
      if (!build) throw new Error(`Unknown machine in save: ${s.type}`);
      const machine = build({ col: s.col, row: s.row });
      machine.loadState(s);
      return machine;
    });
    const belts = new Map();
    for (const s of data.belts) {
      const build = BELT_TYPES[s.type];
      if (!build) throw new Error(`Unknown belt in save: ${s.type}`);
      const piece = build(s);
      piece.loadState(s);
      belts.set(tileKey(s.col, s.row), piece);
    }

    const state = {
      cash: data.cash,
      hand: data.hand,
      time: data.time,
      floor: { ...data.floor },
      licenses: new Set(data.licenses),
      nextBillIn: data.nextBillIn,
      jamUpkeepOwed: data.jamUpkeepOwed ?? 0,
      graceLeft: data.graceLeft,
      peakIncome: data.peakIncome,
      // Saves from before belts were locked had belts from the start
      zinesSold: data.zinesSold ?? BELTS_UNLOCK_ZINES,
      beltsUnlocked: data.beltsUnlocked ?? true,
      firstTruck: data.firstTruck ?? null, // saves from before the scorecard win on their next truck
      milestones: data.milestones ? { ...data.milestones } : oldSaveMilestones(data),
      zineSales: (data.zineSales ?? []).map((sale) => ({ ...sale })),
      bestZinesPerSecond: data.bestZinesPerSecond ?? 0,
      portHighlightUntil: 0,
      beltDir: data.beltDir,
      ledger: {
        ...data.ledger,
        entries: data.ledger.entries.map((entry) => ({ ...entry, at: new Date(entry.at) })),
      },
      machines,
      belts,
    };
    const { x, y, zoom } = data.camera;

    Object.assign(game, state);
    Object.assign(Camera, { x, y, zoom, fitted: true }); // keep the saved view instead of fitting the floor
  },

  // Autosave ------------------------------------------------------------------------------

  write(game) {
    if (game.bankrupt || this.leaving) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.snapshot(game)));
    } catch {
      // Storage blocked or full; the shop just won't be remembered
    }
  },

  // Load the autosave if there is one. Returns "restored", "none" when there's no save, or
  // "failed" when there is one that can't be loaded. A new shop then starts, and its autosave
  // will replace the old save, so the old one is backed up first.
  read(game) {
    let text = null;
    try {
      text = localStorage.getItem(SAVE_KEY);
    } catch {
      return "none";
    }
    if (!text) return "none";
    try {
      this.restore(game, JSON.parse(text));
      return "restored";
    } catch {
      this.backUp(text);
      return "failed";
    }
  },

  // Keep only the first save that fails to load. If no save loads (a bug in loading, say), each
  // new shop fails in turn, and it mustn't replace the shop that was lost.
  backUp(text) {
    try {
      if (localStorage.getItem(BACKUP_KEY) === null) localStorage.setItem(BACKUP_KEY, text);
    } catch {
      // Storage is full; the old save can't be kept
    }
  },

  clear() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // Nothing to clear
    }
  },

  // Save every few seconds and whenever the page is hidden or closed.
  startAutosave(game) {
    setInterval(() => this.write(game), AUTOSAVE_SECONDS * 1000);
    window.addEventListener("pagehide", () => this.write(game));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.write(game);
    });
  },

  // Save files ------------------------------------------------------------------------------

  download(game) {
    const blob = new Blob([JSON.stringify(this.snapshot(game), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `print95-save-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  },

  // Check a chosen file is a real save, make it the autosave, and reload into it.
  async open(file, game) {
    const data = JSON.parse(await file.text());
    this.restore({ ...game, ledger: {}, licenses: new Set() }, data); // throws if it isn't a usable save
    localStorage.setItem(SAVE_KEY, JSON.stringify(data)); // throws if storage is blocked; nothing changes
    this.leaving = true;
    location.reload();
  },

  // Forget the autosave and start fresh.
  newShop() {
    this.leaving = true;
    this.clear();
    location.reload();
  },
};
