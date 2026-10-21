import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../game.js";
import { Save } from "../save.js";

// The starting shop: 8 x 10 floor, Paper Supply, Desktop Printer, Manual Stapler, Outbox and
// Trash Can. Each test starts from a copy of it.
const NEW_SHOP = JSON.stringify(Save.snapshot(Game));

beforeEach(() => {
  Save.restore(Game, JSON.parse(NEW_SHOP));
  Game.bankrupt = false;
});

describe("Game#updateFinances", () => {
  // Rent is 80 squares at $0.25 = $20 a minute; upkeep is $5 + $2 + $2 = $9. The bill is $29.
  it("bills rent and upkeep two minutes in, then every minute", () => {
    Game.cash = 100;

    Game.updateFinances(119.75);
    assert.equal(Game.cash, 100);

    Game.updateFinances(0.25);
    assert.equal(Game.cash, 71);

    Game.updateFinances(60);
    assert.equal(Game.cash, 42);
  });

  it("goes bankrupt after a minute below $0", () => {
    Game.cash = -1;

    Game.updateFinances(59.75);
    assert.equal(Game.bankrupt, false);

    Game.updateFinances(0.25);
    assert.equal(Game.bankrupt, true);
  });

  it("stops the bankruptcy countdown once cash is back to $0", () => {
    Game.cash = -1;
    Game.updateFinances(30);

    Game.cash = 0;
    Game.updateFinances(0.25);

    assert.equal(Game.graceLeft, null);
    assert.equal(Game.bankrupt, false);
  });
});

describe("Game#incomePerSecond", () => {
  it("counts every sale in the last minute, even past the ledger's 200 lines", () => {
    for (let i = 0; i < 300; i++) Game.earn(10, "Zine sold");

    assert.equal(Game.incomePerSecond(), 50);
    assert.equal(Game.ledger.entries.length, 200);
  });

  it("drops sales older than a minute", () => {
    Game.earn(10, "Zine sold");
    Game.time += 61;
    Game.updateRecords();

    assert.equal(Game.incomePerSecond(), 0);
    assert.equal(Game.sales.length, 0);
  });
});
