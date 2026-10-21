// The taskbar, Start menu and windows are plain DOM. Everything else is drawn on the canvas.

import { clock, money, perSecond, signedPerSecond, zineRate } from "./format.js";
import { CATALOG, LICENSES } from "./catalog.js";
import { BELTS_UNLOCK_ZINES, MILESTONE_UNKNOWN } from "./game.js";
/** @import { Tool } from "./game.js" */

const HELP_HIDDEN_KEY = "print95.hideHelp";

/** @type {Record<Tool, string>} */
const TOOL_NAMES = {
  select: "Select",
  belt: "Belt",
  express: "Express",
  splitter: "Splitter",
  bridge: "Bridge",
  erase: "Erase",
  upgrade: "Upgrade",
};

// When a record was reached: game time, "–" if not yet, or "Unknown" for old saves.
function reachedAt(time) {
  if (time === null) return "–";
  if (time === MILESTONE_UNKNOWN) return "Unknown";
  return clock(time);
}

// The Scorecard's records, each reached once (except the best rate, which only goes up).
const RECORD_ROWS = [
  { label: "Production license", show: (game) => reachedAt(game.milestones.production) },
  { label: "$10,000 profit", show: (game) => reachedAt(game.milestones.profit10k) },
  { label: "$100,000 profit", show: (game) => reachedAt(game.milestones.profit100k) },
  { label: "Best Zines/s", show: (game) => zineRate(game.bestZinesPerSecond) },
];

// The Scorecard's rows, each shown from a Game.scorecard() result.
const SCORE_ROWS = [
  { label: "Time", show: (card) => clock(card.time) },
  { label: "Profit", show: (card) => signedPerSecond(card.profit) },
  { label: "Zines/s", show: (card) => zineRate(card.zinesPerSecond ?? 0) },
  { label: "Floor size", show: (card) => `${card.cols * card.rows} squares` },
  { label: "Floor used", show: (card) => `${card.used} (${Math.round((100 * card.used) / (card.cols * card.rows))}%)` },
  { label: "Floor usage ratio", show: (card) => card.ratio.toFixed(2) },
];

// Only touch the DOM when the text actually changed.
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

export const UI = {
  init({ onTool, onBuy, onFit, onNewShop, onSaveFile, onOpenFile }) {
    this.shopEl = document.getElementById("shop");
    this.helpEl = document.getElementById("help");
    this.buyButtons = this.buildShop(onBuy);
    document.getElementById("shop-close").addEventListener("click", () => this.toggleWindow(this.shopEl));

    this.initStartMenu(onTool, onFit);
    this.initFileMenu({ onNewShop, onSaveFile, onOpenFile });

    this.cashEl = document.getElementById("cash");
    this.holdingEl = document.querySelector("#holding span");
    this.clockEl = document.getElementById("clock");
    this.moneyValueEl = document.getElementById("money-value");
    this.moneyEl = document.getElementById("money");
    this.moneyRateEl = document.getElementById("money-rate");
    this.moneyCostsEl = document.getElementById("money-costs");
    this.moneyBillEl = document.getElementById("money-bill");
    this.shownCash = 0;

    this.ledgerEl = document.getElementById("ledger");
    this.listEl = document.getElementById("ledger-list");
    this.statCash = document.getElementById("stat-cash");
    this.statEarned = document.getElementById("stat-earned");
    this.statSpent = document.getElementById("stat-spent");
    this.statSold = document.getElementById("stat-sold");
    this.statRate = document.getElementById("stat-rate");
    this.listedEntries = -1; // entry count the list was last built for

    this.initScorecard();

    this.cashEl.addEventListener("click", () => this.toggleLedger());
    document.getElementById("money").addEventListener("click", () => this.toggleLedger());
    document.getElementById("ledger-close").addEventListener("click", () => this.toggleLedger());

    this.initHelp();

    this.tickClock();
    setInterval(() => this.tickClock(), 10_000);
  },

  // Scorecard window: a row per number, with the first-truck record and the live value.
  initScorecard() {
    this.scorecardEl = document.getElementById("scorecard");
    this.scoreGoalEl = document.getElementById("score-goal");
    this.scoreCells = SCORE_ROWS.map((scoreRow) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${scoreRow.label}</td><td></td><td></td>`;
      document.getElementById("score-rows").append(row);
      return { first: row.children[1], now: row.children[2] };
    });
    this.recordCells = RECORD_ROWS.map((recordRow) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${recordRow.label}</td><td></td>`;
      document.getElementById("record-rows").append(row);
      return row.children[1];
    });
    this.shownWon = null; // whether the first truck had left at the last frame; null before the first

    document.getElementById("scorecard-close").addEventListener("click", () => this.toggleWindow(this.scorecardEl));
    const copy = document.getElementById("score-copy");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(this.scorecardText(this.game));
        setText(copy, "Copied");
        setTimeout(() => setText(copy, "Copy"), 1500);
      } catch {
        // Clipboard blocked: show the text so it can be copied by hand
        this.showDialog("Scorecard", this.scorecardText(this.game));
      }
    });
  },

  // Plain text for sharing.
  scorecardText(game) {
    const line = (card) => SCORE_ROWS.map((scoreRow) => `${scoreRow.label} ${scoreRow.show(card)}`).join(" · ");
    const first = game.firstTruck ? line(game.firstTruck) : "not yet";
    const records = RECORD_ROWS.map((recordRow) => `${recordRow.label} ${recordRow.show(game)}`).join(" · ");
    return `Print95 scorecard\nFirst truck: ${first}\nNow: ${line(game.scorecard())}\nRecords: ${records}`;
  },

  renderScorecard(game) {
    const now = game.scorecard();
    const first = game.firstTruck;
    setText(
      this.scoreGoalEl,
      first
        ? `First truck shipped at ${clock(first.time)}. The shop keeps running: beat your own numbers.`
        : "Goal: fill a Truck Dock and send out your first truck. Its numbers are kept here to compare against.",
    );
    SCORE_ROWS.forEach((scoreRow, i) => {
      setText(this.scoreCells[i].first, first ? scoreRow.show(first) : "–");
      setText(this.scoreCells[i].now, scoreRow.show(now));
    });
    RECORD_ROWS.forEach((recordRow, i) => setText(this.recordCells[i], recordRow.show(game)));
  },

  // How to Play window. Opens on load unless "Don't show this again" was ticked before.
  // Browser storage can be blocked (private windows, previews), so every access is guarded.
  initHelp() {
    const hideBox = /** @type {HTMLInputElement} */ (document.getElementById("help-hide"));
    const close = () => {
      this.helpEl.hidden = true;
      try {
        localStorage.setItem(HELP_HIDDEN_KEY, hideBox.checked ? "1" : "");
      } catch {
        // Can't remember the choice; the window just shows again next time
      }
    };
    document.getElementById("help-ok").addEventListener("click", close);
    document.getElementById("help-close").addEventListener("click", close);

    let hidden;
    try {
      hidden = localStorage.getItem(HELP_HIDDEN_KEY) === "1";
    } catch {
      hidden = false;
    }
    hideBox.checked = hidden;
    if (!hidden) this.openWindow(this.helpEl);
  },

  // Start menu: tools, then Shop and Ledger. Closes on pick, outside tap, or Escape.
  initStartMenu(onTool, onFit) {
    this.startEl = document.getElementById("start");
    this.menuEl = document.getElementById("start-menu");
    this.toolChipEl = document.getElementById("tool-chip");
    this.toolButtons = [...this.menuEl.querySelectorAll("button[data-tool]")];
    this.shownTool = null;
    this.shownUnlocks = null;
    this.beltsLockedEl = document.getElementById("belts-locked");

    document.getElementById("dialog-ok").addEventListener("click", () => {
      document.getElementById("dialog").hidden = true;
    });

    this.startEl.addEventListener("click", () => this.setMenuOpen(this.menuEl.hidden));

    for (const button of this.toolButtons) {
      button.addEventListener("click", () => {
        onTool(button.dataset.tool);
        this.setMenuOpen(false);
      });
    }

    const windows = {
      shop: this.shopEl,
      ledger: document.getElementById("ledger"),
      scorecard: document.getElementById("scorecard"),
      help: this.helpEl,
    };
    for (const button of this.menuEl.querySelectorAll("button[data-open]")) {
      button.addEventListener("click", () => {
        this.openWindow(windows[button.dataset.open]);
        this.setMenuOpen(false);
      });
    }

    this.menuEl.querySelector('[data-action="fit"]').addEventListener("click", () => {
      onFit();
      this.setMenuOpen(false);
    });

    // The task button for the active tool: tap it to go back to Select
    this.toolChipEl.addEventListener("click", () => onTool("select"));

    document.addEventListener("pointerdown", (e) => {
      if (this.menuEl.hidden) return;
      if (this.menuEl.contains(e.target) || this.startEl.contains(e.target)) return;
      this.setMenuOpen(false);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.setMenuOpen(false);
    });
  },

  // Start menu: Save to File, Open Save File, New Shop.
  initFileMenu({ onNewShop, onSaveFile, onOpenFile }) {
    const item = (action) => this.menuEl.querySelector(`[data-action="${action}"]`);
    const picker = /** @type {HTMLInputElement} */ (document.getElementById("open-file"));

    item("save-file").addEventListener("click", () => {
      this.setMenuOpen(false);
      onSaveFile();
    });

    item("open-file").addEventListener("click", () => {
      this.setMenuOpen(false);
      picker.value = ""; // so picking the same file again still fires
      picker.click();
    });
    picker.addEventListener("change", async () => {
      const file = picker.files[0];
      if (!file) return;
      try {
        await onOpenFile(file);
      } catch {
        this.showDialog("Can't open save", `${file.name} isn't a Print95 save file this version can read.`);
      }
    });

    item("new-shop").addEventListener("click", () => {
      this.setMenuOpen(false);
      const sure = window.confirm("Start a new shop? This one is lost unless you Save to File first.");
      if (sure) onNewShop();
    });
  },

  // After loading an autosave: skip the Readme and say so.
  welcomeBack() {
    this.helpEl.hidden = true;
    this.showDialog("Welcome back", "Your shop was saved in this browser and picked up where you left off.");
  },

  // After an autosave that couldn't be loaded: skip the Readme and say a new shop has started.
  saveFailed() {
    this.helpEl.hidden = true;
    this.showDialog(
      "Can't open your shop",
      "Your saved shop couldn't be opened, so a new shop has started. The old save was kept as a backup in this browser.",
    );
  },

  setMenuOpen(open) {
    this.menuEl.hidden = !open;
    this.startEl.classList.toggle("pressed", open);
  },

  toggleLedger() {
    this.toggleWindow(this.ledgerEl);
  },

  // Only one window open at a time; they sit in the same spot.
  toggleWindow(el) {
    this.hideTooltip();
    if (el.hidden) this.openWindow(el);
    else el.hidden = true;
  },

  openWindow(el) {
    this.ledgerEl.hidden = true;
    this.shopEl.hidden = true;
    this.helpEl.hidden = true;
    this.scorecardEl.hidden = true;
    el.hidden = false;
    if (el === this.ledgerEl) this.listedEntries = -1; // rebuild the list now it shows
  },

  // One row per catalog entry. Returns [{ button, entry }] so render can grey out what you can't afford.
  // Rows grouped under headings. A locked group's heading names the license it needs.
  buildShop(onBuy) {
    const list = document.getElementById("shop-list");
    const rows = [];
    this.groupNotes = []; // { el, license }
    let lastGroup = null;

    for (const entry of CATALOG) {
      if (entry.group !== lastGroup) {
        lastGroup = entry.group;
        const heading = document.createElement("div");
        heading.className = "shop-heading";
        heading.textContent = entry.group;
        if (entry.requires) {
          const note = document.createElement("span");
          note.className = "note";
          heading.append(note);
          this.groupNotes.push({ el: note, license: entry.requires });
        }
        list.append(heading);
      }

      // Licenses have no footprint; machines show their size and running cost
      const sample = entry.build ? entry.build() : null;
      const size = sample ? `${sample.cols}×${sample.rows} · $${sample.upkeep}/min` : "license";
      const row = document.createElement("div");
      row.className = "shop-item sunken";
      row.innerHTML = `
        <span class="name">${entry.name} <span class="size">${size}</span></span>
        <span class="price">${money(entry.price)}</span>
        <button type="button" class="raised">Buy</button>`;
      // Built when shown, so belt notes appear once belts unlock
      const description = () => (sample ? sample.details(this.game) : LICENSES[entry.license].description);
      row.addEventListener("mouseenter", (e) => this.showTooltip(entry.name, description(), e));
      row.addEventListener("mousemove", (e) => this.moveTooltip(e));
      row.addEventListener("mouseleave", () => this.hideTooltip());

      const button = row.querySelector("button");
      button.addEventListener("click", () => {
        this.hideTooltip();
        if (!onBuy(entry)) return;
        if (entry.license) {
          this.showDialog(`${entry.name} unlocked`, LICENSES[entry.license].unlocks);
        } else {
          this.toggleWindow(this.shopEl); // close so you see where it landed
        }
      });
      list.append(row);
      rows.push({ button, entry });
    }
    return rows;
  },

  renderShop(game) {
    for (const { button, entry } of this.buyButtons) {
      const owned = entry.license && game.licenses.has(entry.license);
      const locked = entry.requires && !game.licenses.has(entry.requires);
      button.disabled = owned || locked || game.cash < entry.price;
      setText(button, owned ? "Owned" : locked ? "Locked" : "Buy");
    }
    for (const { el, license } of this.groupNotes) {
      setText(el, game.licenses.has(license) ? "" : `Needs ${LICENSES[license].name}`);
    }
  },

  // Yellow Win95 tooltip that follows the mouse, for Shop rows.
  showTooltip(title, text, e) {
    const tip = document.getElementById("tooltip");
    setText(document.getElementById("tooltip-title"), title);
    setText(document.getElementById("tooltip-text"), text);
    tip.hidden = false;
    this.moveTooltip(e);
  },

  moveTooltip(e) {
    const tip = document.getElementById("tooltip");
    const left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 4);
    const top = Math.min(e.clientY + 18, window.innerHeight - tip.offsetHeight - 4);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  },

  hideTooltip() {
    document.getElementById("tooltip").hidden = true;
  },

  // Blue screen with the run's stats. Any key or tap reloads the page for a new shop.
  showBankrupt(game) {
    const bsod = document.getElementById("bsod");
    if (!bsod.hidden) return;
    setText(document.getElementById("bsod-time"), clock(game.time));
    setText(document.getElementById("bsod-earned"), money(game.ledger.totalEarned));
    setText(document.getElementById("bsod-peak"), perSecond(game.peakIncome));
    setText(document.getElementById("bsod-machines"), String(game.machines.length));
    bsod.hidden = false;

    const restart = () => location.reload();
    bsod.addEventListener("pointerdown", restart);
    window.addEventListener("keydown", restart);
  },

  // Message box for an error that stopped the game.
  showCrash(error) {
    this.showDialog(
      "Print95",
      `PRINTSHOP.EXE has stopped because of an error: ${error?.message ?? error}. ` +
        "To keep your shop, choose Save to File from the Start menu, then reload the page.",
    );
  },

  // Win95 message box with an OK button.
  showDialog(title, text) {
    setText(document.getElementById("dialog-title"), title);
    setText(document.getElementById("dialog-text"), text);
    document.getElementById("dialog").hidden = false;
  },

  // Called every frame.
  render(game) {
    this.game = game;
    setText(this.cashEl, `Cash: ${money(game.cash)}`);
    setText(this.holdingEl, `Holding: ${game.hand ?? "Nothing"}`);
    this.renderMoney(game);
    if (game.bankrupt) this.showBankrupt(game);
    if (!this.ledgerEl.hidden) this.renderLedger(game);
    if (!this.shopEl.hidden) this.renderShop(game);

    // The first full truck is the soft win: open the Scorecard once, when it happens
    const won = game.firstTruck !== null;
    if (this.shownWon === false && won) this.openWindow(this.scorecardEl);
    this.shownWon = won;
    if (!this.scorecardEl.hidden) this.renderScorecard(game);

    // Menu items that need a license, or belts unlocked, stay hidden until then
    const unlockKey = `${game.licenses.size}:${game.beltsUnlocked}`;
    if (unlockKey !== this.shownUnlocks) {
      if (this.shownUnlocks !== null && game.beltsUnlocked && !this.shownUnlocks.endsWith("true")) {
        this.showDialog(
          "Belts unlocked",
          "Belts are in the Start menu. Machines take and give items at the triangles on their trays: " +
            "point a belt into an IN triangle, and lead one away from an OUT triangle. " +
            "Tap a triangle with the Belt tool to turn it.",
        );
      }
      this.shownUnlocks = unlockKey;
      for (const el of this.menuEl.querySelectorAll("[data-license], [data-needs]")) {
        const licensed = !el.dataset.license || game.licenses.has(el.dataset.license);
        const beltsReady = !el.dataset.needs || game.beltsUnlocked;
        el.hidden = !(licensed && beltsReady);
      }
      this.menuEl.querySelector('[data-locked="belts"]').hidden = game.beltsUnlocked;
    }
    if (!game.beltsUnlocked) {
      setText(this.beltsLockedEl, `Belts: sell ${BELTS_UNLOCK_ZINES} Zines (${game.zinesSold}/${BELTS_UNLOCK_ZINES})`);
    }

    if (game.tool !== this.shownTool) {
      this.shownTool = game.tool;
      for (const button of this.toolButtons) button.classList.toggle("checked", button.dataset.tool === game.tool);
      this.toolChipEl.hidden = game.tool === "select";
      this.toolChipEl.textContent = `${TOOL_NAMES[game.tool]}  ×`;
    }
  },

  renderMoney(game) {
    const sign = game.cash < 0 ? "-" : "";
    setText(this.moneyValueEl, `${sign}$${String(Math.abs(game.cash)).padStart(6, "0")}`);
    setText(this.moneyRateEl, `Income ${perSecond(game.incomePerSecond())}`);
    setText(this.moneyCostsEl, `Costs ${perSecond((game.billPerMinute() + game.jamUpkeepPerMinute()) / 60)}`);

    const overdue = game.graceLeft !== null;
    this.moneyEl.classList.toggle("overdue", overdue);
    setText(
      this.moneyBillEl,
      overdue
        ? `BANKRUPT IN ${clock(game.graceLeft)}`
        : `Rent ${money(game.nextBillTotal())} in ${clock(game.nextBillIn)}`,
    );

    // Flash the counter when money comes in
    if (game.cash > this.shownCash) {
      this.moneyValueEl.classList.remove("bump");
      void this.moneyValueEl.offsetWidth; // restart the animation
      this.moneyValueEl.classList.add("bump");
    }
    this.shownCash = game.cash;
  },

  renderLedger(game) {
    const { ledger } = game;
    setText(this.statCash, money(game.cash));
    setText(this.statEarned, money(ledger.totalEarned));
    setText(this.statSpent, money(ledger.totalSpent));
    setText(this.statSold, ledger.salesCount.toLocaleString());
    setText(this.statRate, money(game.earnedInLast(60)));

    if (ledger.entryCount === this.listedEntries) return;
    this.listedEntries = ledger.entryCount;

    if (ledger.entries.length === 0) {
      this.listEl.innerHTML = '<div class="empty">No sales yet. Ship a Zine!</div>';
      return;
    }

    // Newest first. Labels can come from a save file, so they go in as text, never as HTML.
    this.listEl.replaceChildren(...ledger.entries.toReversed().map((entry) => {
      const time = document.createElement("span");
      time.textContent = entry.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
      const label = document.createElement("span");
      label.textContent = entry.label;
      const amount = document.createElement("span");
      amount.className = entry.amount < 0 ? "amount spent" : "amount";
      amount.textContent = entry.amount >= 0 ? `+${money(entry.amount)}` : `-${money(-entry.amount)}`;
      const row = document.createElement("div");
      row.className = "row";
      row.append(time, label, amount);
      return row;
    }));
  },

  tickClock() {
    this.clockEl.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  },
};
