// The shop-floor grid: square size, the four directions, and stepping between squares.

const TILE = 64;

// Index is the belt's dir: 0 right, 1 down, 2 left, 3 up.
const DIRS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

function tileKey(col, row) {
  return `${col},${row}`;
}

function dirBetween(from, to) {
  return DIRS.findIndex((d) => d.x === to.col - from.col && d.y === to.row - from.row);
}

// Squares from `from` to `to`, one orthogonal step at a time (`from` not included).
// Lets a fast drag that skips squares still lay an unbroken line.
function stepTiles(from, to) {
  const steps = [];
  let { col, row } = from;
  while (col !== to.col || row !== to.row) {
    const dx = to.col - col;
    const dy = to.row - row;
    if (Math.abs(dx) >= Math.abs(dy)) col += Math.sign(dx);
    else row += Math.sign(dy);
    steps.push({ col, row });
  }
  return steps;
}
