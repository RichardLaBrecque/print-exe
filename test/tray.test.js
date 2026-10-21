import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Tray } from "../machines.js";
import { HAND } from "../items.js";

describe("Tray", () => {
  describe("#accepts", () => {
    it("takes its own item until it's full", () => {
      const tray = new Tray({ item: HAND.ZINE, capacity: 2 });
      tray.put(HAND.ZINE);
      assert.equal(tray.accepts(HAND.ZINE), true);

      tray.put(HAND.ZINE);
      assert.equal(tray.accepts(HAND.ZINE), false);
    });

    it("refuses any other item", () => {
      const tray = new Tray({ item: HAND.ZINE });

      assert.equal(tray.accepts(HAND.BLANK_SHEET), false);
    });

    it("refuses an empty hand", () => {
      const tray = new Tray({ item: HAND.ZINE });

      assert.equal(tray.accepts(HAND.EMPTY), false);
    });

    it("takes any of its kinds, but only one kind at a time", () => {
      const tray = new Tray({ kinds: [HAND.COVER_SHEET, HAND.GUTS_SHEET] });
      tray.put(HAND.COVER_SHEET);

      assert.equal(tray.accepts(HAND.COVER_SHEET), true);
      assert.equal(tray.accepts(HAND.GUTS_SHEET), false);
      assert.equal(tray.accepts(HAND.ZINE), false);
    });
  });

  describe("#take", () => {
    it("hands back the item and lowers the count", () => {
      const tray = new Tray({ item: HAND.ZINE });
      tray.put(HAND.ZINE);
      tray.put(HAND.ZINE);

      assert.equal(tray.take(), HAND.ZINE);
      assert.equal(tray.count, 1);
    });

    it("forgets a multi-kind tray's kind once it's empty, so it can take another", () => {
      const tray = new Tray({ kinds: [HAND.COVER_SHEET, HAND.GUTS_SHEET] });
      tray.put(HAND.COVER_SHEET);
      tray.take();

      assert.equal(tray.item, null);
      assert.equal(tray.accepts(HAND.GUTS_SHEET), true);
    });

    it("never runs out when endless", () => {
      const tray = new Tray({ endless: true });

      assert.equal(tray.hasItem(), true);
      assert.equal(tray.isFull(), false);
    });
  });
});
