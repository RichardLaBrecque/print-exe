// The taskbar, Start menu and windows are plain DOM. Everything else is drawn on the canvas.

const HELP_HIDDEN_KEY = "print95.hideHelp";

const TOOL_NAMES = {
  select: "Select",
  belt: "Belt",
  express: "Express",
  splitter: "Splitter",
  bridge: "Bridge",
  erase: "Erase",
  upgrade: "Upgrade",
};

function money(n) {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString()}`;
}

function perSecond(n) {
  return `$${n.toFixed(1)}/s`;
}

// Seconds as m:ss.
function clock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Only touch the DOM when the text actually changed.
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

const UI = {
  init({ onTool, onBuy, onFit }) {
    this.shopEl = document.getElementById("shop");
    this.helpEl = document.getElementById("help");
    this.buyButtons = this.buildShop(onBuy);
    document.getElementById("shop-close").addEventListener("click", () => this.toggleWindow(this.shopEl));

    this.initStartMenu(onTool, onFit);

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

    this.cashEl.addEventListener("click", () => this.toggleLedger());
    document.getElementById("money").addEventListener("click", () => this.toggleLedger());
    document.getElementById("ledger-close").addEventListener("click", () => this.toggleLedger());

    this.initHelp();

    this.tickClock();
    setInterval(() => this.tickClock(), 10_000);
  },

  // How to Play window. Opens on load unless "Don't show this again" was ticked before.
  // Browser storage can be blocked (private windows, previews), so every access is guarded.
  initHelp() {
    const hideBox = document.getElementById("help-hide");
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

    let hidden = false;
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
    this.shownLicenses = -1;

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

    const windows = { shop: this.shopEl, ledger: document.getElementById("ledger"), help: this.helpEl };
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
      const description = sample ? sample.description : LICENSES[entry.license].description;
      row.addEventListener("mouseenter", (e) => this.showTooltip(entry.name, description, e));
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

  // Win95 message box with an OK button.
  showDialog(title, text) {
    setText(document.getElementById("dialog-title"), title);
    setText(document.getElementById("dialog-text"), text);
    document.getElementById("dialog").hidden = false;
  },

  // Called every frame.
  render(game) {
    setText(this.cashEl, `Cash: ${money(game.cash)}`);
    setText(this.holdingEl, `Holding: ${game.hand ?? "Nothing"}`);
    this.renderMoney(game);
    if (game.bankrupt) this.showBankrupt(game);
    if (!this.ledgerEl.hidden) this.renderLedger(game);
    if (!this.shopEl.hidden) this.renderShop(game);

    if (game.licenses.size !== this.shownLicenses) {
      this.shownLicenses = game.licenses.size;
      for (const el of this.menuEl.querySelectorAll("[data-license]")) el.hidden = !game.licenses.has(el.dataset.license);
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
    setText(this.moneyCostsEl, `Costs ${perSecond(game.billPerMinute() / 60)}`);

    const overdue = game.graceLeft !== null;
    this.moneyEl.classList.toggle("overdue", overdue);
    setText(
      this.moneyBillEl,
      overdue
        ? `BANKRUPT IN ${clock(game.graceLeft)}`
        : `Rent ${money(game.billPerMinute())} in ${clock(game.nextBillIn)}`,
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

    // Newest first
    this.listEl.replaceChildren(...ledger.entries.toReversed().map((entry) => {
      const row = document.createElement("div");
      row.className = "row";
      const time = entry.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
      const amount = entry.amount >= 0 ? `+${money(entry.amount)}` : `-${money(-entry.amount)}`;
      const spent = entry.amount < 0 ? " spent" : "";
      row.innerHTML = `<span>${time}</span><span>${entry.label}</span><span class="amount${spent}">${amount}</span>`;
      return row;
    }));
  },

  tickClock() {
    this.clockEl.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  },
};
