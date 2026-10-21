// Canvas drawing helpers shared by machines, belts and the shop floor.

export const INK = "#4a4f5c";

export const Draw = {
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
};

export function drawAnts(ctx, r, color, time) {
  ctx.setLineDash([10, 6]);
  ctx.lineDashOffset = -time * 30;
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.roundRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 10);
  ctx.stroke();
  ctx.setLineDash([]);
}
