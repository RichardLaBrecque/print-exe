// How numbers and lists read on screen: money, rates per second, m:ss clocks, and "A, B or C".

export function money(n) {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString()}`;
}

export function perSecond(n) {
  return `$${n.toFixed(1)}/s`;
}

// Like perSecond, with the minus sign before the $.
export function signedPerSecond(n) {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(1)}/s`;
}

export function zineRate(n) {
  return n.toFixed(1);
}

// Seconds as m:ss.
export function clock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Items in a sentence: "A", "A or B", "A, B or C".
/** @param {string[]} items */
export function orList(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}
