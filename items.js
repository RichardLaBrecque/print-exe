// Items, the press jobs, and the icon drawn for each item.

import { INK } from "./draw.js";

// Every item in the game, by display name. Also what the player's hand can hold. Frozen, so the
// type checker knows its exact names and flags a misspelled one.
export const HAND = Object.freeze({
  EMPTY: null,
  // The four states of paper: blank or printed, sheet or roll. Printed paper also carries
  // the job it was printed for (see JOBS). Saddle-stitch sheets come from either a desktop
  // printer or a sheeter, so tier 1 and tier 2 machines can feed each other.
  BLANK_SHEET: "Blank Sheet",
  BLANK_ROLL: "Blank Roll",
  SADDLE_SHEET: "Printed Sheet: Saddle-Stitch",
  COVER_SHEET: "Printed Sheet: Cover",
  GUTS_SHEET: "Printed Sheet: Guts",
  SADDLE_ROLL: "Printed Roll: Saddle-Stitch",
  COVER_ROLL: "Printed Roll: Cover",
  GUTS_ROLL: "Printed Roll: Guts",
  // Finished goods
  ZINE: "Zine",
  PERFECT_ZINE: "Perfect-Bound Zine",
  SADDLE_PALLET: "Pallet: Saddle-Stitched",
  PERFECT_PALLET: "Pallet: Perfect-Bound",
});

/** @typedef {(typeof HAND)[Exclude<keyof typeof HAND, "EMPTY">]} Item the name of one item */

// Press job settings: Saddle-Stitch, Cover or Guts, in the order a tap cycles them.
/** @typedef {{ name: string, label: string, roll: Item, sheet: Item, color: string }} Job */
/** @type {Job[]} */
export const JOBS = [
  { name: "Saddle-Stitch", label: "SADDLE", roll: HAND.SADDLE_ROLL, sheet: HAND.SADDLE_SHEET, color: "#9b8cff" },
  { name: "Cover", label: "COVER", roll: HAND.COVER_ROLL, sheet: HAND.COVER_SHEET, color: "#e5703a" },
  { name: "Guts", label: "GUTS", roll: HAND.GUTS_ROLL, sheet: HAND.GUTS_SHEET, color: "#4caf50" },
];
export const PRINTED_ROLLS = JOBS.map((job) => job.roll);
export const PRINTED_SHEETS = JOBS.map((job) => job.sheet);

// The job a printed sheet or roll belongs to, or undefined for anything else.
/** @param {Item | null} item @returns {Job | undefined} */
export function jobOf(item) {
  return JOBS.find((job) => job.roll === item || job.sheet === item);
}

// Rolls are too heavy to carry; only belts move them.
/** @param {Item | null} item */
export function canCarry(item) {
  return item !== HAND.BLANK_ROLL && !PRINTED_ROLLS.includes(item);
}

// Item icons, drawn into an s-by-s box at (x, y).
/** @param {CanvasRenderingContext2D} ctx @param {Item} item @param {number} x @param {number} y @param {number} s */
export function drawItem(ctx, item, x, y, s) {
  ctx.strokeStyle = INK;
  if (item === HAND.BLANK_SHEET) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + s * 0.15, y, s * 0.7, s);
    ctx.strokeRect(x + s * 0.15, y, s * 0.7, s);
  } else if (PRINTED_SHEETS.includes(item)) {
    // Two sheets with print bars in the job's color; a cover's front is solid color
    const job = jobOf(item);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + s * 0.25, y, s * 0.65, s * 0.9);
    ctx.strokeRect(x + s * 0.25, y, s * 0.65, s * 0.9);
    ctx.fillStyle = item === HAND.COVER_SHEET ? job.color : "#ffffff";
    ctx.fillRect(x + s * 0.1, y + s * 0.1, s * 0.65, s * 0.9);
    ctx.strokeRect(x + s * 0.1, y + s * 0.1, s * 0.65, s * 0.9);
    ctx.fillStyle = item === HAND.COVER_SHEET ? "#ffffff" : job.color;
    for (const f of [0.3, 0.45, 0.6, 0.75]) ctx.fillRect(x + s * 0.2, y + s * f, s * 0.45, s * 0.06);
  } else if (item === HAND.ZINE) {
    ctx.fillStyle = "#ffe08a";
    ctx.fillRect(x + s * 0.1, y + s * 0.05, s * 0.8, s * 0.9);
    ctx.strokeRect(x + s * 0.1, y + s * 0.05, s * 0.8, s * 0.9);
    ctx.fillStyle = INK;
    ctx.fillRect(x + s * 0.48, y + s * 0.05, s * 0.04, s * 0.9); // spine
    ctx.fillStyle = "#d93030";
    ctx.fillRect(x + s * 0.44, y + s * 0.25, s * 0.12, s * 0.06); // staples
    ctx.fillRect(x + s * 0.44, y + s * 0.7, s * 0.12, s * 0.06);
  } else if (item === HAND.BLANK_ROLL || PRINTED_ROLLS.includes(item)) {
    // Roll seen end-on: paper, a band in the job's color if printed, and the core
    const cx = x + s / 2;
    const cy = y + s / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = "#fbf7ec";
    ctx.fill();
    ctx.stroke();
    if (item !== HAND.BLANK_ROLL) {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.34, 0, Math.PI * 2);
      ctx.lineWidth = s * 0.12;
      ctx.strokeStyle = jobOf(item).color;
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = "#c08850";
    ctx.fill();
    ctx.stroke();
  } else if (item === HAND.PERFECT_ZINE) {
    // Thick block of pages wrapped in an orange cover with a square, glued spine
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + s * 0.24, y + s * 0.12, s * 0.66, s * 0.8);
    ctx.strokeRect(x + s * 0.24, y + s * 0.12, s * 0.66, s * 0.8);
    ctx.fillStyle = "#e5703a";
    ctx.fillRect(x + s * 0.1, y + s * 0.05, s * 0.72, s * 0.8);
    ctx.strokeRect(x + s * 0.1, y + s * 0.05, s * 0.72, s * 0.8);
    ctx.fillStyle = "#b34f20";
    ctx.fillRect(x + s * 0.1, y + s * 0.05, s * 0.16, s * 0.8); // spine
    ctx.strokeRect(x + s * 0.1, y + s * 0.05, s * 0.16, s * 0.8);
  } else if (item === HAND.SADDLE_PALLET || item === HAND.PERFECT_PALLET) {
    // Wrapped stack of boxes on a wooden pallet, boxes tinted by the kind of zine
    ctx.fillStyle = "#c08850";
    ctx.fillRect(x, y + s * 0.8, s, s * 0.14);
    ctx.strokeRect(x, y + s * 0.8, s, s * 0.14);
    ctx.fillStyle = item === HAND.PERFECT_PALLET ? "#e5a06a" : "#9fb4e0";
    ctx.fillRect(x + s * 0.06, y + s * 0.1, s * 0.88, s * 0.7);
    ctx.strokeRect(x + s * 0.06, y + s * 0.1, s * 0.88, s * 0.7);
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)"; // stretch wrap
    ctx.fillRect(x + s * 0.06, y + s * 0.25, s * 0.88, s * 0.12);
    ctx.fillRect(x + s * 0.06, y + s * 0.55, s * 0.88, s * 0.12);
    ctx.fillStyle = INK;
    ctx.fillRect(x + s * 0.49, y + s * 0.1, s * 0.02, s * 0.7);
  }
}
