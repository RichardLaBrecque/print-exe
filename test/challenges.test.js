import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../game.js";
import { Save } from "../save.js";

// The starting shop: 8 x 10 floor. Each test starts from a copy of it.
const NEW_SHOP = JSON.stringify(Save.snapshot(Game));

beforeEach(() => {
  Save.restore(Game, JSON.parse(NEW_SHOP));
});

describe("Game#startChallenge", () => {
  it("starts a Narrow Lot shop 12 squares wide", () => {
    Game.startChallenge("narrow");

    assert.equal(Game.challenge, "narrow");
    assert.deepEqual(Game.floor, { cols: 12, rows: 10 });
  });
});

describe("Game#expanders", () => {
  it("offers the right and bottom edges in a normal shop", () => {
    assert.deepEqual(Game.expanders().map((expander) => expander.side), ["right", "bottom"]);
  });

  it("offers only the bottom edge in a Narrow Lot shop", () => {
    Game.startChallenge("narrow");

    assert.deepEqual(Game.expanders().map((expander) => expander.side), ["bottom"]);
  });

  // Two new rows of 12 squares at $3 each
  it("charges for 24 new squares along a Narrow Lot shop's bottom edge", () => {
    Game.startChallenge("narrow");

    assert.equal(Game.expanders()[0].cost, 72);
  });
});
