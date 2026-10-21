// Canvas drawing helpers shared by machines, belts and the shop floor.

const INK = "#4a4f5c";

const Draw = {
  font(size, bold) {
    return `${bold ? "bold " : ""}${size}px "MS Sans Serif", "Microsoft Sans Serif", Tahoma, Geneva, sans-serif`;
  },

  // Split text into lines that fit maxWidth at the current font.
  wrap(ctx, text, maxWidth) {
    const lines = [];
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  },

  // Win95 tooltip with a bold title and wrapped text, below and right of (x, y) in screen space.
  infoTip(ctx, title, text, x, y) {
    const maxWidth = 240;
    ctx.font = Draw.font(12, false);
    const lines = Draw.wrap(ctx, text, maxWidth);
    ctx.font = Draw.font(12, true);
    const width = Math.max(ctx.measureText(title).width, ...lines.map((l) => ctx.measureText(l).width)) + 12;
    const height = 8 + 16 * (lines.length + 1);
    const left = Math.round(Math.min(x + 14, Game.width - width - 4));
    const top = Math.round(Math.min(y + 18, Game.height - height - 4));

    ctx.fillStyle = "#FFFFE1";
    ctx.fillRect(left, top, width, height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#000";
    ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
    ctx.fillStyle = "#000";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(title, left + 6, top + 5);
    ctx.font = Draw.font(12, false);
    lines.forEach((line, i) => ctx.fillText(line, left + 6, top + 5 + 16 * (i + 1)));
  },

  // Win95 tooltip, drawn in screen space.
  tooltip(ctx, text, x, y, alpha) {
    ctx.globalAlpha = alpha;
    ctx.font = Draw.font(12, false);
    const w = Math.ceil(ctx.measureText(text).width) + 10;
    const h = 20;
    const left = Math.round(Math.max(4, Math.min(x - w / 2, Game.width - w - 4)));
    const top = Math.round(Math.max(4, y - h - 8));
    ctx.fillStyle = "#FFFFE1";
    ctx.fillRect(left, top, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#000";
    ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
    ctx.fillStyle = "#000";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, left + 5, top + h / 2);
    ctx.globalAlpha = 1;
  },
};

function drawAnts(ctx, r, color, time) {
  ctx.setLineDash([10, 6]);
  ctx.lineDashOffset = -time * 30;
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.roundRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 10);
  ctx.stroke();
  ctx.setLineDash([]);
}
