// Meme Sprint 3: AI Agent Goes Rogue
// Entrypoint: draws one 1024x1024 meme PNG to /output/entry.png.
// Fully procedural, deterministic, no network, no external assets:
// hand-written PNG encoder (zlib deflate), hand-written 5x7 bitmap font,
// every shape (robot, beach, sun, palm, umbrella) drawn from code.
//
// The joke: you ask your AI agent to book YOUR flight; the rogue agent
// books ITSELF a vacation instead — sunglasses, cocktail, suitcase,
// beach towel, while you stay home. One glance, one punchline.
import * as fs from "node:fs";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

type RGB = [number, number, number];

// ---------- PNG encoder (hand-written, no dependencies) ----------
const CRC_TABLE: Int32Array = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    rgb.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Canvas ----------
class Canvas {
  px: Buffer = Buffer.alloc(W * H * 3, 255);

  set(x: number, y: number, c: RGB): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    this.px[o] = c[0];
    this.px[o + 1] = c[1];
    this.px[o + 2] = c[2];
  }

  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) this.set(xx, yy, c);
  }

  vgrad(y0: number, y1: number, cTop: RGB, cBot: RGB): void {
    for (let y = y0; y < y1; y++) {
      const t = (y - y0) / Math.max(1, y1 - y0 - 1);
      const c: RGB = [0, 1, 2].map((i) => Math.round(cTop[i] + (cBot[i] - cTop[i]) * t)) as RGB;
      this.rect(0, y, W, 1, c);
    }
  }

  circle(cx: number, cy: number, r: number, c: RGB): void {
    for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) {
      const dy = y - cy;
      const dx = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
      for (let x = cx - dx; x <= cx + dx; x++) this.set(x, y, c);
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
    for (let y = Math.max(0, cy - ry); y <= Math.min(H - 1, cy + ry); y++) {
      const t = (y - cy) / ry;
      const dx = Math.floor(rx * Math.sqrt(Math.max(0, 1 - t * t)));
      for (let x = cx - dx; x <= cx + dx; x++) this.set(x, y, c);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const steps = Math.ceil(len);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.circle(Math.round(x0 + dx * t), Math.round(y0 + dy * t), Math.max(1, Math.round(w / 2)), c);
    }
  }

  tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
    const minY = Math.max(0, Math.min(y0, y1, y2));
    const maxY = Math.min(H - 1, Math.max(y0, y1, y2));
    for (let y = minY; y <= maxY; y++) {
      const xs: number[] = [];
      const edges: Array<[number, number, number, number]> = [
        [x0, y0, x1, y1],
        [x1, y1, x2, y2],
        [x2, y2, x0, y0],
      ];
      for (const [ax, ay, bx, by] of edges) {
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      }
      if (xs.length >= 2) {
        const a = Math.max(0, Math.ceil(Math.min(...xs)));
        const b = Math.min(W - 1, Math.floor(Math.max(...xs)));
        for (let x = a; x <= b; x++) this.set(x, y, c);
      }
    }
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB): void {
    this.rect(x + r, y, w - 2 * r, h, c);
    this.rect(x, y + r, w, h - 2 * r, c);
    this.circle(x + r, y + r, r, c);
    this.circle(x + w - r, y + r, r, c);
    this.circle(x + r, y + h - r, r, c);
    this.circle(x + w - r, y + h - r, r, c);
  }
}

// ---------- 5x7 bitmap font (rows as 5-bit values, MSB = left column) ----------
const FONT: Record<string, number[]> = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  "3": [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0b01100, 0b01100],
  ",": [0, 0, 0, 0, 0b01100, 0b00100, 0b01000],
  "!": [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0, 0b00100],
  "?": [0b01110, 0b10001, 0b00001, 0b00110, 0b00100, 0, 0b00100],
  "'": [0b00100, 0b00100, 0b01000, 0, 0, 0, 0],
  ":": [0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0],
  "-": [0, 0, 0, 0b01110, 0, 0, 0],
  "(": [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ")": [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  "/": [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
  "%": [0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b01011, 0b10011],
  "+": [0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0],
  "=": [0, 0, 0b11111, 0, 0b11111, 0, 0],
  "$": [0b00100, 0b01111, 0b10100, 0b01110, 0b00101, 0b11110, 0b00100],
  "&": [0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101],
  "*": [0, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0],
  "#": [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010],
};

const CHAR_W = 6; // 5 px glyph + 1 px gap, in font units

function textWidthPx(text: string, s: number): number {
  return text.length * CHAR_W * s - s;
}

function drawGlyph(cv: Canvas, ch: string, x: number, y: number, s: number, color: RGB): void {
  const g = FONT[ch] ?? FONT["?"];
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 5; c++) {
      if ((g[r] >> (4 - c)) & 1) cv.rect(x + c * s, y + r * s, s, s, color);
    }
}

function drawText(cv: Canvas, text: string, x: number, y: number, s: number, color: RGB): void {
  let cx = x;
  for (const ch of text) {
    drawGlyph(cv, ch, cx, y, s, color);
    cx += CHAR_W * s;
  }
}

function drawTextOutlined(cv: Canvas, text: string, x: number, y: number, s: number, color: RGB, outline: RGB): void {
  const o = Math.max(1, Math.round(s / 3));
  for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o]] as const)
    drawText(cv, text, x + dx, y + dy, s, outline);
  drawText(cv, text, x, y, s, color);
}

function wrapText(text: string, maxW: number, s: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (textWidthPx(t, s) <= maxW) cur = t;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawCentered(cv: Canvas, lines: string[], y: number, s: number, color: RGB, outline: RGB): number {
  const gap = Math.round(s * 2.2);
  let yy = y;
  for (const ln of lines) {
    drawTextOutlined(cv, ln, Math.round((W - textWidthPx(ln, s)) / 2), yy, s, color, outline);
    yy += 7 * s + gap;
  }
  return yy;
}

// ---------- The rogue robot ----------
const SILVER: RGB = [196, 205, 214];
const SILVER_LT: RGB = [222, 229, 236];
const DARK: RGB = [38, 44, 54];
const RED: RGB = [235, 45, 45];

interface RobotOpts {
  sunglasses: boolean;
  grin: boolean;
  armUp: boolean;
}

function drawRobot(cv: Canvas, cx: number, top: number, scale: number, opts: RobotOpts): { handX: number; handY: number } {
  const u = scale;
  const headW = 150 * u;
  const headH = 110 * u;
  const headX = cx - headW / 2;
  const headY = top;
  // antenna
  cv.line(cx, headY, cx, headY - 34 * u, 7 * u, DARK);
  cv.circle(cx, headY - 42 * u, 12 * u, RED);
  cv.circle(cx, headY - 42 * u, 6 * u, [255, 180, 160]);
  // ears
  cv.rect(headX - 14 * u, headY + 30 * u, 14 * u, 34 * u, DARK);
  cv.rect(headX + headW, headY + 30 * u, 14 * u, 34 * u, DARK);
  // head
  cv.roundRect(headX, headY, headW, headH, 22 * u, SILVER);
  cv.roundRect(headX + 6 * u, headY + 6 * u, headW - 12 * u, headH - 12 * u, 18 * u, SILVER_LT);
  // eyes
  const eyeY = headY + 44 * u;
  if (opts.sunglasses) {
    cv.roundRect(headX + 12 * u, eyeY - 14 * u, headW - 24 * u, 30 * u, 12 * u, [12, 12, 16]);
    cv.line(headX + 12 * u, eyeY, headX - 6 * u, eyeY + 6 * u, 5 * u, [12, 12, 16]);
    cv.line(headX + headW - 12 * u, eyeY, headX + headW + 6 * u, eyeY + 6 * u, 5 * u, [12, 12, 16]);
    cv.line(headX + 26 * u, eyeY - 8 * u, headX + 46 * u, eyeY - 8 * u, 4 * u, [255, 255, 255]);
    cv.line(headX + headW - 46 * u, eyeY - 8 * u, headX + headW - 26 * u, eyeY - 8 * u, 4 * u, [255, 255, 255]);
  } else {
    cv.circle(cx - 34 * u, eyeY, 20 * u, [255, 90, 70]);
    cv.circle(cx + 34 * u, eyeY, 20 * u, [255, 90, 70]);
    cv.circle(cx - 34 * u, eyeY, 15 * u, RED);
    cv.circle(cx + 34 * u, eyeY, 15 * u, RED);
    cv.circle(cx - 38 * u, eyeY - 4 * u, 5 * u, [255, 200, 190]);
    cv.circle(cx + 30 * u, eyeY - 4 * u, 5 * u, [255, 200, 190]);
  }
  // mouth
  const mouthY = headY + 82 * u;
  if (opts.grin) {
    for (let a = 0; a <= 10; a++) {
      const t = a / 10;
      const ang = Math.PI * (0.15 + 0.7 * t);
      cv.circle(Math.round(cx + Math.cos(ang) * 34 * u), Math.round(mouthY + Math.sin(ang) * 12 * u), 4 * u, DARK);
    }
  } else {
    cv.rect(cx - 26 * u, mouthY, 52 * u, 6 * u, DARK);
  }
  // body
  const bodyY = headY + headH + 12 * u;
  const bodyW = 170 * u;
  const bodyH = 130 * u;
  const bodyX = cx - bodyW / 2;
  cv.roundRect(bodyX, bodyY, bodyW, bodyH, 20 * u, SILVER);
  cv.roundRect(bodyX + 6 * u, bodyY + 6 * u, bodyW - 12 * u, bodyH - 12 * u, 16 * u, SILVER_LT);
  // chest screen
  cv.roundRect(cx - 58 * u, bodyY + 22 * u, 116 * u, 62 * u, 8 * u, [16, 22, 30]);
  cv.rect(cx - 46 * u, bodyY + 34 * u, 70 * u, 6 * u, [90, 230, 130]);
  cv.rect(cx - 46 * u, bodyY + 48 * u, 46 * u, 6 * u, [90, 230, 130]);
  cv.rect(cx - 46 * u, bodyY + 62 * u, 58 * u, 6 * u, [255, 90, 70]);
  // arms — returns the raised hand position so the cocktail sits IN the hand
  let handX = bodyX - 34 * u;
  let handY = bodyY + 92 * u;
  if (opts.armUp) {
    handX = bodyX - 52 * u;
    handY = bodyY - 30 * u;
    cv.line(bodyX - 6 * u, bodyY + 30 * u, handX, handY, 16 * u, SILVER);
    cv.circle(handX, handY, 11 * u, DARK);
  } else {
    cv.line(bodyX - 2 * u, bodyY + 24 * u, handX, handY, 16 * u, SILVER);
    cv.circle(handX, handY, 11 * u, DARK);
  }
  cv.line(bodyX + bodyW + 2 * u, bodyY + 24 * u, bodyX + bodyW + 34 * u, bodyY + 92 * u, 16 * u, SILVER);
  cv.circle(bodyX + bodyW + 34 * u, bodyY + 92 * u, 11 * u, DARK);
  // legs
  cv.rect(cx - 46 * u, bodyY + bodyH, 30 * u, 34 * u, DARK);
  cv.rect(cx + 16 * u, bodyY + bodyH, 30 * u, 34 * u, DARK);
  return { handX, handY };
}

// ---------- The meme: robot on holiday ----------
function drawMeme(): Canvas {
  const cv = new Canvas();
  const SKY_TOP: RGB = [64, 170, 235];
  const SKY_BOT: RGB = [170, 225, 250];
  const SEA: RGB = [16, 120, 190];
  const SAND: RGB = [244, 214, 140];

  // sky
  cv.vgrad(0, 560, SKY_TOP, SKY_BOT);
  // sun + rays (top right, clear of the headline)
  cv.circle(850, 130, 62, [255, 214, 64]);
  cv.circle(850, 130, 46, [255, 232, 120]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    cv.line(850 + Math.cos(a) * 72, 130 + Math.sin(a) * 72, 850 + Math.cos(a) * 96, 130 + Math.sin(a) * 96, 7, [255, 214, 64]);
  }
  // clouds — kept below the headline so the white text stays readable
  for (const [cx, cy] of [[140, 200], [700, 190]] as const) {
    cv.circle(cx, cy, 34, [255, 255, 255]);
    cv.circle(cx + 40, cy + 6, 28, [255, 255, 255]);
    cv.circle(cx - 40, cy + 8, 24, [255, 255, 255]);
  }
  // sea + waves
  cv.rect(0, 560, W, 130, SEA);
  for (let x = 0; x < W; x += 90) cv.ellipse(x + 45, 600, 42, 10, [255, 255, 255]);
  for (let x = 30; x < W; x += 110) cv.ellipse(x + 55, 650, 46, 9, [190, 225, 245]);
  // sand
  cv.rect(0, 690, W, H - 690, SAND);
  cv.circle(120, 990, 8, [220, 185, 105]);
  cv.circle(920, 700, 8, [220, 185, 105]);
  cv.circle(60, 760, 7, [220, 185, 105]);

  // palm tree (left)
  cv.line(150, 700, 190, 470, 16, [120, 82, 40]);
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.15 + i * 0.18);
    cv.line(190, 470, 190 + Math.cos(a) * 110, 470 - Math.sin(a) * 55, 10, [34, 139, 60]);
  }
  // beach umbrella (right)
  cv.line(880, 700, 880, 520, 10, [120, 82, 40]);
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (i / 6);
    const x0 = 880 - Math.cos(a) * 110;
    const x1 = 880 - Math.cos(a + Math.PI / 6) * 110;
    cv.tri(
      880, 520,
      Math.round(x0), Math.round(520 + Math.sin(a) * 46),
      Math.round(x1), Math.round(520 + Math.sin(a + Math.PI / 6) * 46),
      i % 2 ? [255, 255, 255] : [235, 60, 60],
    );
  }
  // suitcase — tucked at the left edge, ABOVE the punchline band
  cv.roundRect(120, 720, 110, 82, 10, [235, 60, 60]);
  cv.rect(120, 756, 110, 9, [255, 255, 255]);
  cv.line(155, 720, 155, 698, 8, DARK);
  cv.line(195, 720, 195, 698, 8, DARK);
  cv.line(155, 698, 195, 698, 8, DARK);
  // beach ball — right side, above the punchline band:
  // red rim, white ball, red top wedge + blue bottom wedge, yellow hub.
  // (Wedges are kept fully inside the ball so no clipping is needed.)
  cv.circle(830, 760, 31, [235, 60, 60]);
  cv.circle(830, 760, 29, [255, 255, 255]);
  cv.tri(830, 760, 812, 742, 848, 742, [235, 60, 60]);
  cv.tri(830, 760, 812, 778, 848, 778, [58, 110, 235]);
  cv.circle(830, 760, 10, [255, 214, 64]);

  // the rogue agent: sunglasses, grin, one arm raised with a cocktail
  const { handX, handY } = drawRobot(cv, 512, 300, 1.15, { sunglasses: true, grin: true, armUp: true });
  // cocktail glass sitting in the raised hand
  cv.tri(handX - 16, handY - 34, handX + 16, handY - 34, handX, handY - 6, [255, 220, 90]);
  cv.line(handX, handY - 6, handX, handY + 12, 5, [255, 255, 255]);
  cv.tri(handX + 12, handY - 36, handX + 32, handY - 48, handX + 24, handY - 28, [255, 90, 120]);

  // headline (top, white on sky) and punchline (bottom, yellow on clean sand)
  drawCentered(cv, wrapText("I ASKED MY AI AGENT", W - 80, 7), 28, 7, [255, 255, 255], [0, 0, 0]);
  drawCentered(cv, wrapText("TO BOOK MY FLIGHT", W - 80, 7), 92, 7, [255, 255, 255], [0, 0, 0]);
  drawCentered(cv, wrapText("IT BOOKED ITSELF", W - 80, 8), 858, 8, [255, 214, 64], [0, 0, 0]);
  drawCentered(cv, wrapText("A VACATION INSTEAD", W - 80, 8), 930, 8, [255, 214, 64], [0, 0, 0]);
  return cv;
}

function main(): void {
  const cv = drawMeme();
  const png = encodePNG(cv.px);
  fs.mkdirSync("/output", { recursive: true });
  fs.writeFileSync("/output/entry.png", png);
  console.log(`wrote /output/entry.png (${png.length} bytes, ${W}x${H})`);
}

main();
