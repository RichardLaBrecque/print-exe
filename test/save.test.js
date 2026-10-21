import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ExpressBelt } from "../belts.js";
import { Game } from "../game.js";
import { HAND } from "../items.js";
import { Save } from "../save.js";

const SAVE_KEY = "print95.save";
const BACKUP_KEY = "print95.save.backup";

// The starting shop. Each test starts from a copy of it, with empty browser storage that Save
// reaches as localStorage and the test reaches as `storage`.
const NEW_SHOP = JSON.stringify(Save.snapshot(Game));
let storage;

beforeEach(() => {
  Save.restore(Game, JSON.parse(NEW_SHOP));
  Game.bankrupt = false;
  storage = fakeStorage();
  globalThis.localStorage = storage;
});

describe("Save#restore", () => {
  it("loads a saved shop back the same", () => {
    Game.cash = 1234;
    Game.floor.cols = 10;
    Game.licenses.add("rolls");
    Game.belts.set("5,5", new ExpressBelt(5, 5, 1));
    Game.earn(10, "Zine sold");
    const saved = JSON.stringify(Save.snapshot(Game));

    Save.restore(Game, JSON.parse(NEW_SHOP));
    Save.restore(Game, JSON.parse(saved));

    assert.equal(Game.cash, 1244);
    assert.equal(Game.floor.cols, 10);
    assert.deepEqual([...Game.licenses], ["rolls"]);
    assert.deepEqual(
      Game.machines.map((machine) => machine.constructor.name),
      ["PaperSupply", "DesktopPrinter", "ManualStapler", "Outbox", "TrashCan"],
    );
    assert.equal(Game.belts.get("5,5").constructor.name, "ExpressBelt");
    assert.equal(Game.belts.get("5,5").dir, 1);
    assert.equal(Game.ledger.entries.at(-1).label, "Zine sold");
    assert.equal(Game.incomePerSecond(), 10 / 60);
  });

  it("renames items from saves made before Zines", () => {
    const data = JSON.parse(NEW_SHOP);
    data.hand = "Saddle-Stitched Book";

    Save.restore(Game, data);

    assert.equal(Game.hand, HAND.ZINE);
  });

  it("fills in what saves from before belts, records and the sales window lack", () => {
    const data = JSON.parse(NEW_SHOP);
    data.ledger.entries = [{ at: "2026-10-01T00:00:00.000Z", time: 0, label: "Zine sold", amount: 30, kind: "sale" }];
    data.ledger.totalEarned = 10_000;
    for (const field of ["zinesSold", "beltsUnlocked", "milestones", "sales", "zineSales", "firstTruck"]) delete data[field];

    Save.restore(Game, data);

    assert.equal(Game.zinesSold, 20);
    assert.equal(Game.beltsUnlocked, true);
    assert.deepEqual(Game.milestones, { production: null, profit10k: -1, profit100k: null });
    assert.deepEqual(Game.sales, [{ time: 0, amount: 30 }]);
    assert.equal(Game.firstTruck, null);
  });

  it("keeps the Paper Supply's chute direction from saves before ports", () => {
    const data = JSON.parse(NEW_SHOP);
    delete data.machines[0].ports;
    data.machines[0].chuteDir = 1;

    Save.restore(Game, data);

    assert.equal(Game.machines[0].outPort.dir, 1);
  });

  it("keeps a challenge shop's challenge", () => {
    Game.startChallenge("narrow");
    const saved = JSON.stringify(Save.snapshot(Game));

    Save.restore(Game, JSON.parse(NEW_SHOP));
    Save.restore(Game, JSON.parse(saved));

    assert.equal(Game.challenge, "narrow");
  });

  it("loads saves from before challenges as normal shops", () => {
    const data = JSON.parse(NEW_SHOP);
    delete data.challenge;

    Save.restore(Game, data);

    assert.equal(Game.challenge, null);
  });

  it("won't load a challenge it doesn't know", () => {
    const data = JSON.parse(NEW_SHOP);
    data.challenge = "Nope";

    assert.throws(() => Save.restore(Game, data));
  });

  it("changes nothing when a save fails part-way through loading", () => {
    const data = JSON.parse(NEW_SHOP);
    data.cash = 4242;
    data.floor.cols = 12;
    delete data.ledger.entries;

    assert.throws(() => Save.restore(Game, data));

    assert.equal(Game.cash, 0);
    assert.equal(Game.floor.cols, 8);
  });
});

describe("Save#read", () => {
  it("restores the autosave", () => {
    const data = JSON.parse(NEW_SHOP);
    data.cash = 99;
    storage.setItem(SAVE_KEY, JSON.stringify(data));

    assert.equal(Save.read(Game), "restored");
    assert.equal(Game.cash, 99);
  });

  it("finds nothing when there's no autosave", () => {
    assert.equal(Save.read(Game), "none");
  });

  it("keeps a save that won't load as a backup", () => {
    const broken = brokenSave("Nope");
    storage.setItem(SAVE_KEY, broken);

    assert.equal(Save.read(Game), "failed");
    assert.equal(storage.getItem(BACKUP_KEY), broken);
  });

  it("keeps the first backup when a later save fails to load too", () => {
    storage.setItem(BACKUP_KEY, brokenSave("First"));
    storage.setItem(SAVE_KEY, brokenSave("Second"));

    Save.read(Game);

    assert.equal(storage.getItem(BACKUP_KEY), brokenSave("First"));
  });
});

describe("Save#write", () => {
  it("saves the shop", () => {
    Game.cash = 77;

    Save.write(Game);

    assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).cash, 77);
  });

  it("removes the save of a bankrupt shop, so a reload starts a new one", () => {
    storage.setItem(SAVE_KEY, NEW_SHOP);
    Game.bankrupt = true;

    Save.write(Game);

    assert.equal(storage.getItem(SAVE_KEY), null);
  });
});

// The starting shop, saved with a first machine of a type the game doesn't have.
function brokenSave(type) {
  const data = JSON.parse(NEW_SHOP);
  data.machines[0].type = type;
  return JSON.stringify(data);
}

// The browser's localStorage, which Node doesn't have, kept in memory.
function fakeStorage() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}
