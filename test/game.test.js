import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Belt } from "../belts.js";
import { Camera, Game, MILESTONE_UNKNOWN } from "../game.js";
import { HAND } from "../items.js";
import { DesktopPrinter } from "../machines.js";
import { RollPress } from "../production.js";
import { Save } from "../save.js";

// The starting shop: 8 x 10 floor, Paper Supply, Desktop Printer, Manual Stapler, Outbox and
// Trash Can. Each test starts from a copy of it, with no tips or floating numbers showing.
const NEW_SHOP = JSON.stringify(Save.snapshot(Game));

beforeEach(() => {
  Save.restore(Game, JSON.parse(NEW_SHOP));
  Game.bankrupt = false;
  Game.floaters = [];
});

describe("Game#showTip", () => {
  it("keeps a short tip up for 1.6 seconds", () => {
    Game.showTip("Your hands are full.", 0, 0); // 20 characters

    Game.update(1.5);
    assert.equal(tips().length, 1);

    Game.update(0.2);
    assert.equal(tips().length, 0);
  });

  it("keeps a longer tip up a second for every 12 characters", () => {
    Game.showTip("x".repeat(60), 0, 0); // 5 seconds

    Game.update(4.9);
    assert.equal(tips().length, 1);

    Game.update(0.2);
    assert.equal(tips().length, 0);
  });

  it("takes any tip down after 6 seconds, however long it is", () => {
    Game.showTip("x".repeat(200), 0, 0);

    Game.update(5.9);
    assert.equal(tips().length, 1);

    Game.update(0.2);
    assert.equal(tips().length, 0);
  });
});

describe("Game#showNextJam", () => {
  it("centers the view on each jammed machine in turn, then starts over", () => {
    const left = jammed(new RollPress({ col: 0, row: 6 })); // 4 x 3, centered at (128, 480)
    const right = jammed(new RollPress({ col: 4, row: 6 })); // centered at (384, 480)
    Game.machines.push(left, right);

    Game.showNextJam();
    assert.deepEqual({ x: Camera.x, y: Camera.y }, { x: 128, y: 480 });

    Game.showNextJam();
    assert.deepEqual({ x: Camera.x, y: Camera.y }, { x: 384, y: 480 });

    Game.showNextJam();
    assert.deepEqual({ x: Camera.x, y: Camera.y }, { x: 128, y: 480 });
  });

  it("leaves the view alone when nothing is jammed", () => {
    Game.machines.push(new RollPress({ col: 0, row: 6 }));
    Camera.x = 99;
    Camera.y = 99;

    Game.showNextJam();

    assert.deepEqual({ x: Camera.x, y: Camera.y }, { x: 99, y: 99 });
  });
});

describe("Game#goalText", () => {
  it("starts with selling Zines to unlock belts", () => {
    Game.zinesSold = 3;

    assert.equal(Game.goalText(), "Sell 10 Zines to unlock belts (3/10)");
  });

  it("moves on to the Production Equipment license once belts unlock", () => {
    Game.beltsUnlocked = true;
    Game.cash = 1234;

    assert.equal(Game.goalText(), "Buy the Production Equipment license in the Shop ($1,234 of $3,000)");
  });

  it("moves on to the first truck once the license is bought", () => {
    Game.beltsUnlocked = true;
    Game.licenses.add("production");

    assert.equal(Game.goalText(), "Fill a Truck Dock and send out your first truck");
  });

  it("moves on to $10,000 profit once the first truck has left", () => {
    Game.beltsUnlocked = true;
    Game.licenses.add("production");
    Game.firstTruck = Game.scorecard();
    Game.ledger.totalEarned = 5000;
    Game.ledger.totalSpent = 1000;

    assert.equal(Game.goalText(), "Reach $10,000 profit ($4,000 now)");
  });

  it("moves on to $100,000 profit once $10,000 is reached", () => {
    Game.beltsUnlocked = true;
    Game.licenses.add("production");
    Game.firstTruck = Game.scorecard();
    Game.milestones.profit10k = 600;
    Game.ledger.totalEarned = 20000;
    Game.ledger.totalSpent = 0;

    assert.equal(Game.goalText(), "Reach $100,000 profit ($20,000 now)");
  });

  it("has no goal left once every record is reached, counting ones an old save couldn't date", () => {
    Game.beltsUnlocked = true;
    Game.licenses.add("production");
    Game.firstTruck = Game.scorecard();
    Game.milestones.profit10k = MILESTONE_UNKNOWN;
    Game.milestones.profit100k = MILESTONE_UNKNOWN;

    assert.equal(Game.goalText(), null);
  });
});

describe("Game#putBack", () => {
  it("puts an item back in the OUT tray it was taken from", () => {
    const printer = Game.machines.find((m) => m instanceof DesktopPrinter);
    printer.outTray.put(HAND.SADDLE_SHEET);
    printer.use(Game, "out");

    Game.putBack(0, 0);

    assert.equal(Game.hand, HAND.EMPTY);
    assert.equal(printer.outTray.count, 1);
  });

  it("keeps the item in hand when its tray has filled up since", () => {
    const printer = Game.machines.find((m) => m instanceof DesktopPrinter);
    printer.outTray.put(HAND.SADDLE_SHEET);
    printer.use(Game, "out");
    for (let i = 0; i < 5; i++) printer.outTray.put(HAND.SADDLE_SHEET);

    Game.putBack(0, 0);

    assert.equal(Game.hand, HAND.SADDLE_SHEET);
    assert.equal(printer.outTray.count, 5);
  });

  it("keeps an item picked up from a belt in hand", () => {
    const belt = new Belt(5, 8, 0);
    belt.item = HAND.ZINE;
    Game.belts.set(belt.key, belt);
    Game.tapBeltByHand(belt, 0, 0);

    Game.putBack(0, 0);

    assert.equal(Game.hand, HAND.ZINE);
  });
});

// Jammed: its OUT tray has blocked it for 11 seconds, 1 past the grace period.
function jammed(machine) {
  machine.jamSeconds = 11;
  return machine;
}

function tips() {
  return Game.floaters.filter((f) => f.kind === "tip");
}
