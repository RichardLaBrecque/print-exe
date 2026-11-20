import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../game.js";
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

function tips() {
  return Game.floaters.filter((f) => f.kind === "tip");
}
