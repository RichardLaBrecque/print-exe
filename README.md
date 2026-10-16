# Print.exe

A small factory-building game about running a print shop, dressed up as Windows 95.

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

There's no build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Code

Plain JavaScript files loaded in order by `index.html`:

| File | What's in it |
|---|---|
| `machines.js` | Items, trays, the base `Machine` class and desktop machines |
| `production.js` | Tier-2 machines: presses, sheeter, binders, palletizer, truck dock |
| `belts.js` | Belts, splitters, bridges and how items move between them |
| `catalog.js` | What the Shop sells, and the licenses |
| `ui.js` | Taskbar, Start menu and Win95 windows |
| `game.js` | Game state, money, camera, input and the render loop |

When releasing a change, bump the `?v=` on the script tags in `index.html` so browsers load the new files.
