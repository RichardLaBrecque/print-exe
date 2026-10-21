// Challenges: shops that start with extra rules, picked from the Start menu's Challenges window.
// Each one is plain data, and the game reads the fields it knows about.

/**
 * @typedef {object} Challenge
 * @property {string} name
 * @property {string} description
 * @property {number} [fixedCols] the floor is always this many squares wide and can't grow wider
 */

/** @type {Record<string, Challenge>} */
export const CHALLENGES = {
  narrow: {
    name: "Narrow Lot",
    description: "The floor is 12 squares wide and can never get wider. It can still grow downward.",
    fixedCols: 12,
  },
};
