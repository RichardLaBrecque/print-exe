import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DesktopPrinter, ManualStapler, Outbox } from "../machines.js";
import { RollPress, Sheeter } from "../production.js";
import { HAND } from "../items.js";

describe("DesktopPrinter#update", () => {
  it("prints a Blank Sheet into a saddle-stitch sheet every 4 seconds", () => {
    const game = fakeGame();
    const printer = new DesktopPrinter({ col: 0, row: 0 });
    printer.inTray.put(HAND.BLANK_SHEET);
    printer.inTray.put(HAND.BLANK_SHEET);
    printer.update(0.25, game); // the first sheet starts at the end of this frame

    run(printer, 3.75, game);
    assert.equal(printer.outTray.count, 0);

    run(printer, 0.25, game);
    assert.equal(printer.outTray.count, 1);
    assert.equal(printer.outTray.item, HAND.SADDLE_SHEET);

    run(printer, 4, game);
    assert.equal(printer.outTray.count, 2);
  });

  it("waits while its OUT tray is full", () => {
    const game = fakeGame();
    const printer = new DesktopPrinter({ col: 0, row: 0 });
    for (let i = 0; i < 5; i++) printer.outTray.put(HAND.SADDLE_SHEET);
    printer.inTray.put(HAND.BLANK_SHEET);

    run(printer, 10, game);

    assert.equal(printer.inTray.count, 1);
    assert.equal(printer.working, false);
  });
});

describe("ManualStapler#use", () => {
  it("staples a printed sheet into a Zine when its middle is tapped", () => {
    const game = fakeGame();
    const stapler = new ManualStapler({ col: 0, row: 0 });
    stapler.inTray.put(HAND.SADDLE_SHEET);

    assert.equal(stapler.canUse(game, "body"), true);
    stapler.use(game, "body");

    assert.equal(stapler.inTray.count, 0);
    assert.equal(stapler.outTray.count, 1);
    assert.equal(stapler.outTray.item, HAND.ZINE);
  });

  it("can't staple with nothing loaded", () => {
    const game = fakeGame();
    const stapler = new ManualStapler({ col: 0, row: 0 });

    assert.equal(stapler.canUse(game, "body"), false);
  });
});

describe("Outbox#update", () => {
  it("sells two Zines a second for $10 each", () => {
    const game = fakeGame();
    const outbox = new Outbox({ col: 0, row: 0 });
    for (let i = 0; i < 3; i++) outbox.inTray.put(HAND.ZINE);

    run(outbox, 1, game);

    assert.deepEqual(game.earned, [10, 10]);
    assert.equal(game.zinesSold, 2);
    assert.equal(outbox.inTray.count, 1);
  });
});

describe("Machine#upkeepMultiplier", () => {
  it("raises a Roll Press's upkeep 1x every 30 seconds its OUT tray stays full, after 10 seconds' grace", () => {
    const game = fakeGame();
    const press = new RollPress({ col: 0, row: 0 });
    for (let i = 0; i < 5; i++) press.outTray.put(HAND.SADDLE_ROLL);

    run(press, 10, game);
    assert.equal(press.isJammed(), false);

    run(press, 0.25, game);
    assert.equal(press.isJammed(), true);
    assert.equal(press.upkeepMultiplier(), 1);

    run(press, 29.75, game); // 40 seconds full
    assert.equal(press.upkeepMultiplier(), 2);

    run(press, 30, game); // 70 seconds full
    assert.equal(press.upkeepMultiplier(), 3);
  });

  it("goes back to 1x as soon as the OUT tray has room", () => {
    const game = fakeGame();
    const press = new RollPress({ col: 0, row: 0 });
    for (let i = 0; i < 5; i++) press.outTray.put(HAND.SADDLE_ROLL);
    run(press, 45, game);

    press.outTray.take();
    run(press, 0.25, game);

    assert.equal(press.isJammed(), false);
    assert.equal(press.upkeepMultiplier(), 1);
  });

  it("jams a Sheeter whose OUT tray has some room but not enough for the next 10 sheets", () => {
    const game = fakeGame();
    const sheeter = new Sheeter({ col: 0, row: 0 });
    for (let i = 0; i < 18; i++) sheeter.outTray.put(HAND.BLANK_SHEET);
    sheeter.inTray.put(HAND.BLANK_ROLL);

    run(sheeter, 10.25, game);

    assert.equal(sheeter.working, false);
    assert.equal(sheeter.isJammed(), true);
  });
});

// Advance a machine `seconds` in quarter-second frames, as the game loop would. Quarter seconds
// add up exactly, so timers land on whole numbers.
function run(machine, seconds, game) {
  for (let t = 0; t < seconds; t += 0.25) machine.update(0.25, game);
}

// The parts of Game a machine calls while it runs. Belts stay locked, so OUT ports don't push.
function fakeGame() {
  return {
    hand: HAND.EMPTY,
    beltsUnlocked: false,
    zinesSold: 0,
    earned: [],
    earn(amount) {
      this.earned.push(amount);
    },
    sellZines() {},
    floatText() {},
    showTip() {},
  };
}
