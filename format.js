// How numbers read on screen: money, rates per second, and m:ss clocks.

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
