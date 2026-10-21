import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Belt, Splitter, moveItems } from "../belts.js";
import { Game } from "../game.js";
import { HAND } from "../items.js";

// Belts find their neighbours through Game, so each test lays its own belts on an empty floor.
beforeEach(() => {
  Game.machines = [];
  Game.belts = new Map();
});

describe("moveItems", () => {
  it("moves an item onto the next belt after a second", () => {
    const first = place(new Belt(0, 0, 0));
    const next = place(new Belt(1, 0, 0));
    first.item = HAND.ZINE;

    runBelts(0.75);
    assert.equal(first.item, HAND.ZINE);
    assert.equal(next.item, null);

    runBelts(0.25);
    assert.equal(first.item, null);
    assert.equal(next.item, HAND.ZINE);
  });

  it("lets two belts feeding one belt take turns", () => {
    const fromLeft = place(new Belt(0, 1, 0)); // points right, into the shared belt
    const fromAbove = place(new Belt(1, 0, 1)); // points down, into the shared belt
    const shared = place(new Belt(1, 1, 0));

    const order = [];
    for (let round = 0; round < 4; round++) {
      ready(fromLeft, HAND.ZINE);
      ready(fromAbove, HAND.BLANK_SHEET);
      moveItems(Game);
      order.push(shared.item);
      shared.item = null;
    }

    assert.deepEqual(order, [HAND.ZINE, HAND.BLANK_SHEET, HAND.ZINE, HAND.BLANK_SHEET]);
  });
});

describe("moveItems with a Splitter", () => {
  it("sends items out its left and right sides in turn", () => {
    const splitter = place(new Splitter(1, 1, 0)); // takes from the left, sends up and down
    const up = place(new Belt(1, 0, 3));
    const down = place(new Belt(1, 2, 1));

    const sides = [];
    for (let round = 0; round < 4; round++) {
      ready(splitter, HAND.ZINE);
      moveItems(Game);
      sides.push(up.item ? "up" : "down");
      up.item = null;
      down.item = null;
    }

    assert.deepEqual(sides, ["up", "down", "up", "down"]);
  });

  it("sends everything to the open side while the other is blocked, then picks up where it left off", () => {
    const splitter = place(new Splitter(1, 1, 0));
    const up = place(new Belt(1, 0, 3));
    const down = place(new Belt(1, 2, 1));
    up.item = HAND.BLANK_SHEET; // blocked: up's item has nowhere to go

    ready(splitter, HAND.ZINE);
    moveItems(Game);
    assert.equal(down.item, HAND.ZINE);

    down.item = null;
    ready(splitter, HAND.ZINE);
    moveItems(Game);
    assert.equal(down.item, HAND.ZINE);

    up.item = null;
    down.item = null;
    ready(splitter, HAND.ZINE);
    moveItems(Game);
    assert.equal(up.item, HAND.ZINE);
  });
});

function place(piece) {
  Game.belts.set(piece.key, piece);
  return piece;
}

// Put an item at the far end of a belt, ready to hand over.
function ready(belt, item) {
  belt.item = item;
  belt.progress = 1;
}

// Advance every belt `seconds` in quarter-second frames, moving items between them each frame.
function runBelts(seconds) {
  for (let t = 0; t < seconds; t += 0.25) {
    for (const piece of Game.belts.values()) piece.update(0.25);
    moveItems(Game);
  }
}
