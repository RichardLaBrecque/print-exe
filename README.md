# Print.exe

A small factory-building game about running a print shop, dressed up as your favorite mid-90s operating system.

You start with one desktop printer and a stapler, making zines by hand. You end with roll-fed presses, sheeters, binders and trucks hauling pallets of zines. There's no character to walk around: you tap, drag and build.

**Play it:** https://richardlabrecque.github.io/print-exe/

It works best on a desktop browser. It also works on phones.

## How to play

- **Start by hand.** Take a Blank Sheet from the Paper Supply, load the Printer, staple the print into a Zine, and drop it in the Outbox for $10.
- **Tap** a machine's IN or OUT tray, or its middle, to use it.
- **Drag** machines and belts to move them. Drag open floor to look around.
- **Zoom** with pinch or the scroll wheel. Press **F** to see the whole floor.
- **Build** from the **Start** menu: belts, splitters, bridges, the Shop and the Ledger.
- **Right-click** goes back to Select.

Rent and upkeep are billed every minute. If your cash stays below $0 for a minute, the shop goes bankrupt.

## Run it locally

There's no build step, but the game is made of JavaScript modules, and browsers only load those from a web server. Opening `index.html` straight from your disk won't work. Serve the folder instead:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Code

Plain JavaScript modules. `index.html` starts `main.js`, and each file imports what it uses from the others. Each file only imports from files above it in this table:

| File | What's in it |
|---|---|
| `grid.js` | The floor grid: square size, the four directions, and stepping between squares |
| `format.js` | How money, rates and clocks read on screen |
| `draw.js` | Canvas helpers shared by everything that draws |
| `items.js` | Every item, the press jobs, and each item's icon |
| `belts.js` | Belts, splitters, bridges and how items move between them |
| `machines.js` | Trays, the base `Machine` class and desktop machines |
| `production.js` | Tier-2 machines: presses, sheeter, binders, palletizer, truck dock |
| `catalog.js` | What the Shop sells, and the licenses |
| `challenges.js` | The challenges: shops that start with extra rules |
| `game.js` | Game state, money and the camera |
| `save.js` | The autosave and save files |
| `ui.js` | Taskbar, Start menu and Win95 windows |
| `main.js` | Drawing the floor, input, the frame loop and startup |

When releasing a change, bump every `?v=` in the import map in `index.html` so browsers load the new files.

## Checks

The game needs nothing installed, but there are type checks, a linter and tests for development. They run on Node 24, which `mise.toml` sets:

```sh
npm install
npm run check   # TypeScript checks the JavaScript, using its JSDoc comments
npm run lint    # ESLint
npm test        # Node's test runner, on the tests in test/
```

The tests cover the simulation and saves: trays, machines, belts, splitters, jams, bills and bankruptcy, and loading old and broken saves. They run the game's own modules in Node, without a browser.

The type checks catch mistakes on classes such as `Tray`, `Machine` and `Belt`. JSDoc types also check the names the code passes around as strings (`Item`, `Tool`, `Part`, `Port`) and the save format (`SaveData`). In JavaScript files, TypeScript treats other plain objects such as `Game` as open-ended, so it doesn't catch a misspelled property on them.
