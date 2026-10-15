// What the Shop sells, grouped under headings. `build` makes a machine at (0, 0) and
// the game finds it a spot. Items with `requires` stay locked until that license is bought.

// One-time purchases that unlock parts of the Shop (and the Express Belt tool).
const LICENSES = {
  rolls: {
    name: "Roll Paper Delivery",
    price: 1500,
    description: `Unlocks the Paper Roll Rack: paper by the roll, ${10 * SHEETS_PER_ROLL} sheets per delivery.`,
    unlocks: "You can now buy a Paper Roll Rack. A roll delivery is 10 Blank Rolls, " +
      `which is ${10 * SHEETS_PER_ROLL} sheets of paper. Rolls are too heavy to carry, so move them with belts.`,
  },
  production: {
    name: "Production Equipment",
    price: 3000,
    description: "Unlocks the Roll Press, Sheeter, binders, Palletizer, Truck Dock and Express Belts.",
    unlocks: "Production equipment is now in the Shop: Roll Press, Sheeter, Saddle Stitcher, Perfect Binder, Finisher, Palletizer " +
      "and Truck Dock. Express Belts are in the Start menu.",
  },
};

// A stapler that comes already upgraded.
function autoStapler() {
  const stapler = new ManualStapler({ col: 0, row: 0 });
  stapler.upgrade();
  return stapler;
}

const CATALOG = [
  { group: "Desktop", name: "Desktop Printer", price: 100, build: () => new DesktopPrinter({ col: 0, row: 0 }) },
  { group: "Desktop", name: "Manual Stapler", price: 60, build: () => new ManualStapler({ col: 0, row: 0 }) },
  { group: "Desktop", name: "Auto Stapler", price: 60 + STAPLER_UPGRADE_COST, build: () => autoStapler() },
  { group: "Desktop", name: "Paper Supply", price: 40, build: () => new PaperSupply({ col: 0, row: 0 }) },
  { group: "Desktop", name: "Outbox", price: 80, build: () => new Outbox({ col: 0, row: 0 }) },
  { group: "Desktop", name: "Trash Can", price: 10, build: () => new TrashCan({ col: 0, row: 0 }) },

  { group: "Licenses", license: "rolls", name: LICENSES.rolls.name, price: LICENSES.rolls.price },
  { group: "Licenses", license: "production", name: LICENSES.production.name, price: LICENSES.production.price },

  { group: "Roll paper", requires: "rolls", name: "Paper Roll Rack", price: 200, build: () => new PaperRollRack({ col: 0, row: 0 }) },

  { group: "Production", requires: "production", name: "Roll Press", price: 1500, build: () => new RollPress({ col: 0, row: 0 }) },
  { group: "Production", requires: "production", name: "Sheeter", price: 400, build: () => new Sheeter({ col: 0, row: 0 }) },
  { group: "Production", requires: "production", name: "Saddle Stitcher", price: 600, build: () => new SaddleStitcher({ col: 0, row: 0 }) },
  { group: "Production", requires: "production", name: "Perfect Binder", price: 1200, build: () => new PerfectBinder({ col: 0, row: 0 }) },
  { group: "Production", requires: "production", name: "Finisher", price: 2500, build: () => new Finisher({ col: 0, row: 0 }) },
  { group: "Production", requires: "production", name: "Palletizer", price: 300, build: () => new Palletizer({ col: 0, row: 0 }) },
  { group: "Production", requires: "production", name: "Truck Dock", price: 500, build: () => new TruckDock({ col: 0, row: 0 }) },
];
