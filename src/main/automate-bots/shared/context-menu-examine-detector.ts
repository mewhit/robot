import type { ScreenBitmap } from "../../windowsScreenCapture";
import { clamp, type ScreenPoint } from "./osrs-helper";

export type ContextMenuBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ContextMenuTextBand = {
  startY: number;
  endY: number;
  centerY: number;
  minX: number;
  maxX: number;
  pixelCount: number;
};

export type ContextMenuLabel =
  | "Examine"
  | "Cancel"
  | "Open"
  | "Close"
  | "Trade"
  | "Talk-to"
  | "Walk"
  | "Sell"
  | "Wield"
  | "Wear"
  | "Use"
  | "Drop"
  | "Choose Option";

export type ContextMenuWordMatch = {
  label: ContextMenuLabel;
  score: number;
  shapeScore: number;
  ratioScore: number;
  band: ContextMenuTextBand;
  wordBox: ContextMenuBox;
  whitePixelCount: number;
  actualRatio: number;
  expectedRatio: number;
};

type Rgb = { r: number; g: number; b: number };

type TemplateWord = {
  label: ContextMenuLabel;
  width: number;
  height: number;
  ratio: number;
  normalizedBits: Uint8Array;
};

const CONTEXT_MENU_TEMPLATE_WIDTH = 56;
const CONTEXT_MENU_TEMPLATE_HEIGHT = 13;
const CONTEXT_MENU_EXAMINE_MIN_SCORE = 0.54;
const CONTEXT_MENU_EXAMINE_RATIO = 5.55;
const CONTEXT_MENU_TRADE_RATIO = 3.4;
const CONTEXT_MENU_TRADE_MIN_RATIO = 2.85;
const CONTEXT_MENU_TRADE_MAX_RATIO = 3.75;
const CONTEXT_MENU_TRADE_MIN_WIDTH = 30;
const CONTEXT_MENU_TRADE_MAX_WIDTH = 90;

const CONTEXT_MENU_CHAR_ROWS: Record<string, readonly string[]> = {
  " ": ["000", "000", "000", "000", "000", "000", "000"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  a: ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
  c: ["00000", "00000", "01111", "10000", "10000", "10000", "01111"],
  d: ["00001", "00001", "01111", "10001", "10001", "10001", "01111"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
  h: ["10000", "10000", "11110", "10001", "10001", "10001", "10001"],
  i: ["010", "000", "110", "010", "010", "010", "111"],
  k: ["10000", "10000", "10010", "10100", "11000", "10100", "10010"],
  l: ["110", "010", "010", "010", "010", "010", "111"],
  m: ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
  n: ["00000", "00000", "11110", "10001", "10001", "10001", "10001"],
  o: ["00000", "00000", "01110", "10001", "10001", "10001", "01110"],
  p: ["00000", "00000", "11110", "10001", "11110", "10000", "10000"],
  r: ["00000", "00000", "10110", "11001", "10000", "10000", "10000"],
  s: ["00000", "00000", "01111", "10000", "01110", "00001", "11110"],
  t: ["01000", "01000", "11110", "01000", "01000", "01001", "00110"],
  x: ["00000", "00000", "10001", "01010", "00100", "01010", "10001"],
  "-": ["0000", "0000", "0000", "1111", "0000", "0000", "0000"],
};

const CONTEXT_MENU_LABELS: readonly ContextMenuLabel[] = [
  "Examine",
  "Cancel",
  "Open",
  "Close",
  "Trade",
  "Talk-to",
  "Walk",
  "Sell",
  "Wield",
  "Wear",
  "Use",
  "Drop",
  "Choose Option",
];

const CONTEXT_MENU_WORD_TEMPLATES = CONTEXT_MENU_LABELS.map((label) => buildTemplateWord(label));

function getBitmapRgb(bitmap: ScreenBitmap, x: number, y: number): Rgb {
  const safeX = clamp(Math.round(x), 0, bitmap.width - 1);
  const safeY = clamp(Math.round(y), 0, bitmap.height - 1);
  const offset = safeY * bitmap.byteWidth + safeX * bitmap.bytesPerPixel;
  return {
    b: bitmap.image[offset],
    g: bitmap.image[offset + 1],
    r: bitmap.image[offset + 2],
  };
}

function isMagentaDebugPixel(pixel: Rgb): boolean {
  return pixel.r >= 220 && pixel.g <= 110 && pixel.b >= 220;
}

function isCyanDebugPixel(pixel: Rgb): boolean {
  return pixel.r <= 80 && pixel.g >= 165 && pixel.b >= 185;
}

export function isContextMenuWhiteLabelPixel(pixel: Rgb): boolean {
  if (isMagentaDebugPixel(pixel) || isCyanDebugPixel(pixel)) {
    return false;
  }

  const min = Math.min(pixel.r, pixel.g, pixel.b);
  const max = Math.max(pixel.r, pixel.g, pixel.b);
  return min >= 105 && max - min <= 100;
}

function isContextMenuOrangeTextPixel(pixel: Rgb): boolean {
  if (isMagentaDebugPixel(pixel) || isCyanDebugPixel(pixel)) {
    return false;
  }

  return pixel.r >= 145 && pixel.g >= 65 && pixel.g <= 190 && pixel.b <= 155 && pixel.r - pixel.b >= 45;
}

export function isContextMenuTextPixel(pixel: Rgb): boolean {
  return isContextMenuWhiteLabelPixel(pixel) || isContextMenuOrangeTextPixel(pixel);
}

function templateRowsToBits(rows: readonly string[]): Uint8Array {
  const width = rows[0]?.length ?? 0;
  const bits = new Uint8Array(width * rows.length);
  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < width; x += 1) {
      bits[y * width + x] = rows[y][x] === "1" ? 1 : 0;
    }
  }
  return bits;
}

function normalizeBits(
  sourceBits: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  const bits = new Uint8Array(targetWidth * targetHeight);
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const syStart = Math.floor((ty * sourceHeight) / targetHeight);
    const syEnd = Math.max(syStart + 1, Math.ceil(((ty + 1) * sourceHeight) / targetHeight));
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const sxStart = Math.floor((tx * sourceWidth) / targetWidth);
      const sxEnd = Math.max(sxStart + 1, Math.ceil(((tx + 1) * sourceWidth) / targetWidth));
      let hits = 0;
      let total = 0;
      for (let sy = syStart; sy < syEnd; sy += 1) {
        for (let sx = sxStart; sx < sxEnd; sx += 1) {
          total += 1;
          hits += sourceBits[sy * sourceWidth + sx];
        }
      }
      bits[ty * targetWidth + tx] = hits / Math.max(1, total) >= 0.28 ? 1 : 0;
    }
  }
  return bits;
}

function buildTemplateWord(label: ContextMenuLabel): TemplateWord {
  const rows = Array.from({ length: 7 }, () => "");
  for (let charIndex = 0; charIndex < label.length; charIndex += 1) {
    const charRows = CONTEXT_MENU_CHAR_ROWS[label[charIndex]];
    if (!charRows) {
      continue;
    }

    for (let y = 0; y < rows.length; y += 1) {
      rows[y] += charRows[y];
      if (charIndex < label.length - 1) {
        rows[y] += "0";
      }
    }
  }

  const width = rows[0]?.length ?? 0;
  const height = rows.length;
  const bits = templateRowsToBits(rows);
  return {
    label,
    width,
    height,
    ratio: width / Math.max(1, height),
    normalizedBits: normalizeBits(bits, width, height, CONTEXT_MENU_TEMPLATE_WIDTH, CONTEXT_MENU_TEMPLATE_HEIGHT),
  };
}

function getTextSearchBounds(
  bitmap: ScreenBitmap,
  rightClickLocalPoint: ScreenPoint,
  menuBox: ContextMenuBox | null | undefined,
  rowHeightPx: number,
): { x: number; y: number; right: number; bottom: number } {
  if (menuBox) {
    const minHeight = Math.max(menuBox.height + rowHeightPx, rowHeightPx * 7);
    return {
      x: clamp(menuBox.x - 6, 0, Math.max(0, bitmap.width - 1)),
      y: clamp(menuBox.y - 8, 0, Math.max(0, bitmap.height - 1)),
      right: clamp(
        menuBox.x + Math.max(menuBox.width + 12, 230),
        0,
        Math.max(0, bitmap.width - 1),
      ),
      bottom: clamp(menuBox.y + minHeight, 0, Math.max(0, bitmap.height - 1)),
    };
  }

  const searchX = clamp(rightClickLocalPoint.x - 330, 0, Math.max(0, bitmap.width - 1));
  const searchY = clamp(rightClickLocalPoint.y - 80, 0, Math.max(0, bitmap.height - 1));
  return {
    x: searchX,
    y: searchY,
    right: clamp(rightClickLocalPoint.x + 260, searchX, Math.max(0, bitmap.width - 1)),
    bottom: clamp(rightClickLocalPoint.y + 190, searchY, Math.max(0, bitmap.height - 1)),
  };
}

export function detectContextMenuTextBands(
  bitmap: ScreenBitmap,
  rightClickLocalPoint: ScreenPoint,
  options: { menuBox?: ContextMenuBox | null; rowHeightPx?: number } = {},
): ContextMenuTextBand[] {
  const rowHeightPx = Math.max(12, Math.round(options.rowHeightPx ?? 15));
  const bounds = getTextSearchBounds(bitmap, rightClickLocalPoint, options.menuBox, rowHeightPx);
  const rowSearchRight = options.menuBox
    ? clamp(
        options.menuBox.x + Math.min(options.menuBox.width - 5, 105),
        bounds.x,
        bounds.right,
      )
    : bounds.right;
  const rawRows: { y: number; pixelCount: number; minX: number; maxX: number }[] = [];

  for (let y = bounds.y; y <= bounds.bottom; y += 1) {
    let pixelCount = 0;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let x = bounds.x; x <= rowSearchRight; x += 1) {
      if (!isContextMenuWhiteLabelPixel(getBitmapRgb(bitmap, x, y))) {
        continue;
      }

      pixelCount += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }

    if (pixelCount >= 4 && maxX - minX + 1 >= 12) {
      rawRows.push({ y, pixelCount, minX, maxX });
    }
  }

  const bands: ContextMenuTextBand[] = [];
  for (const row of rawRows) {
    const last = bands[bands.length - 1];
    if (last && row.y <= last.endY + 1) {
      last.endY = row.y;
      last.pixelCount += row.pixelCount;
      last.minX = Math.min(last.minX, row.minX);
      last.maxX = Math.max(last.maxX, row.maxX);
      last.centerY = Math.round((last.startY + last.endY) / 2);
      continue;
    }

    bands.push({
      startY: row.y,
      endY: row.y,
      centerY: row.y,
      minX: row.minX,
      maxX: row.maxX,
      pixelCount: row.pixelCount,
    });
  }

  return bands.filter((band) => {
    const height = band.endY - band.startY + 1;
    const width = band.maxX - band.minX + 1;
    return height >= 2 && height <= Math.max(18, rowHeightPx + 5) && width >= 12 && band.pixelCount >= 8;
  });
}

function findWhiteWordBox(bitmap: ScreenBitmap, band: ContextMenuTextBand, menuBox: ContextMenuBox): (ContextMenuBox & { pixels: number }) | null {
  const xStart = clamp(menuBox.x + 5, 0, Math.max(0, bitmap.width - 1));
  const xEnd = clamp(menuBox.x + Math.min(menuBox.width - 5, 170), xStart, Math.max(0, bitmap.width - 1));
  const yStart = clamp(band.startY - 2, 0, Math.max(0, bitmap.height - 1));
  const yEnd = clamp(band.endY + 2, yStart, Math.max(0, bitmap.height - 1));
  const columnSegments: Array<{ startX: number; endX: number; pixels: number }> = [];
  let segmentStart = -1;
  let segmentPixels = 0;

  for (let x = xStart; x <= xEnd; x += 1) {
    let columnPixels = 0;
    for (let y = yStart; y <= yEnd; y += 1) {
      if (isContextMenuWhiteLabelPixel(getBitmapRgb(bitmap, x, y))) {
        columnPixels += 1;
      }
    }

    if (columnPixels > 0) {
      if (segmentStart < 0) {
        segmentStart = x;
        segmentPixels = 0;
      }
      segmentPixels += columnPixels;
      continue;
    }

    if (segmentStart >= 0) {
      columnSegments.push({ startX: segmentStart, endX: x - 1, pixels: segmentPixels });
      segmentStart = -1;
      segmentPixels = 0;
    }
  }

  if (segmentStart >= 0) {
    columnSegments.push({ startX: segmentStart, endX: xEnd, pixels: segmentPixels });
  }

  if (columnSegments.length === 0) {
    return null;
  }

  const mergedSegments: Array<{ startX: number; endX: number; pixels: number }> = [];
  for (const segment of columnSegments) {
    const last = mergedSegments[mergedSegments.length - 1];
    if (last && segment.startX - last.endX - 1 <= 4) {
      last.endX = segment.endX;
      last.pixels += segment.pixels;
      continue;
    }

    mergedSegments.push({ ...segment });
  }

  const wordSegment = mergedSegments.find((segment) => {
    const width = segment.endX - segment.startX + 1;
    return width >= 8 && segment.pixels >= 8;
  });
  if (!wordSegment) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let pixels = 0;

  for (let y = yStart; y <= yEnd; y += 1) {
    for (let x = wordSegment.startX; x <= wordSegment.endX; x += 1) {
      if (!isContextMenuWhiteLabelPixel(getBitmapRgb(bitmap, x, y))) {
        continue;
      }

      pixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (pixels < 10 || !Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return null;
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (width < 10 || height < 3 || height > 18) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width,
    height,
    pixels,
  };
}

function normalizeBitmapWord(bitmap: ScreenBitmap, wordBox: ContextMenuBox): Uint8Array {
  const bits = new Uint8Array(CONTEXT_MENU_TEMPLATE_WIDTH * CONTEXT_MENU_TEMPLATE_HEIGHT);
  for (let ty = 0; ty < CONTEXT_MENU_TEMPLATE_HEIGHT; ty += 1) {
    const syStart = wordBox.y + Math.floor((ty * wordBox.height) / CONTEXT_MENU_TEMPLATE_HEIGHT);
    const syEnd = wordBox.y + Math.max(1, Math.ceil(((ty + 1) * wordBox.height) / CONTEXT_MENU_TEMPLATE_HEIGHT));
    for (let tx = 0; tx < CONTEXT_MENU_TEMPLATE_WIDTH; tx += 1) {
      const sxStart = wordBox.x + Math.floor((tx * wordBox.width) / CONTEXT_MENU_TEMPLATE_WIDTH);
      const sxEnd = wordBox.x + Math.max(1, Math.ceil(((tx + 1) * wordBox.width) / CONTEXT_MENU_TEMPLATE_WIDTH));
      let hits = 0;
      let total = 0;
      for (let sy = syStart; sy < syEnd; sy += 1) {
        for (let sx = sxStart; sx < sxEnd; sx += 1) {
          total += 1;
          if (isContextMenuWhiteLabelPixel(getBitmapRgb(bitmap, sx, sy))) {
            hits += 1;
          }
        }
      }
      bits[ty * CONTEXT_MENU_TEMPLATE_WIDTH + tx] = hits / Math.max(1, total) >= 0.22 ? 1 : 0;
    }
  }
  return bits;
}

function scoreWordShape(actualBits: Uint8Array, expectedBits: Uint8Array): number {
  let intersection = 0;
  let union = 0;
  let equalOff = 0;
  let offTotal = 0;

  for (let index = 0; index < actualBits.length; index += 1) {
    const actual = actualBits[index] === 1;
    const expected = expectedBits[index] === 1;
    if (actual || expected) {
      union += 1;
      if (actual && expected) {
        intersection += 1;
      }
      continue;
    }

    offTotal += 1;
    equalOff += 1;
  }

  const onScore = union > 0 ? intersection / union : 0;
  const offScore = offTotal > 0 ? equalOff / offTotal : 0;
  return onScore * 0.82 + offScore * 0.18;
}

function classifyWord(bitmap: ScreenBitmap, band: ContextMenuTextBand, wordBox: ContextMenuBox & { pixels: number }): ContextMenuWordMatch {
  const actualBits = normalizeBitmapWord(bitmap, wordBox);
  const actualRatio = wordBox.width / Math.max(1, wordBox.height);
  let best: ContextMenuWordMatch | null = null;

  for (const template of CONTEXT_MENU_WORD_TEMPLATES) {
    const shapeScore = scoreWordShape(actualBits, template.normalizedBits);
    const ratioScore = Math.max(0, 1 - Math.abs(actualRatio - template.ratio) / 1.9);
    const examineRatioBoost =
      template.label === "Examine" ? Math.max(0, 1 - Math.abs(actualRatio - CONTEXT_MENU_EXAMINE_RATIO) / 1.2) : 0;
    const score = shapeScore * 0.66 + ratioScore * 0.24 + examineRatioBoost * 0.1;
    const match: ContextMenuWordMatch = {
      label: template.label,
      score,
      shapeScore,
      ratioScore,
      band,
      wordBox,
      whitePixelCount: wordBox.pixels,
      actualRatio,
      expectedRatio: template.ratio,
    };

    if (!best || match.score > best.score) {
      best = match;
    }
  }

  return best!;
}

export function detectContextMenuWordMatches(
  bitmap: ScreenBitmap,
  textBands: readonly ContextMenuTextBand[],
  menuBox: ContextMenuBox,
): ContextMenuWordMatch[] {
  const matches: ContextMenuWordMatch[] = [];
  for (const band of textBands) {
    const wordBox = findWhiteWordBox(bitmap, band, menuBox);
    if (!wordBox) {
      continue;
    }

    matches.push(classifyWord(bitmap, band, wordBox));
  }

  return matches.sort((a, b) => b.score - a.score);
}

export function findContextMenuExamineMatch(
  bitmap: ScreenBitmap,
  textBands: readonly ContextMenuTextBand[],
  menuBox: ContextMenuBox,
): { match: ContextMenuWordMatch | null; matches: ContextMenuWordMatch[] } {
  const result = findContextMenuLabelMatch(bitmap, textBands, menuBox, "Examine");
  return { match: result.match, matches: result.matches };
}

export function findContextMenuLabelMatch(
  bitmap: ScreenBitmap,
  textBands: readonly ContextMenuTextBand[],
  menuBox: ContextMenuBox,
  targetLabel: ContextMenuLabel,
): { match: ContextMenuWordMatch | null; matches: ContextMenuWordMatch[] } {
  const matches = detectContextMenuWordMatches(bitmap, textBands, menuBox);
  let bestMatch: ContextMenuWordMatch | null = null;

  for (const match of matches) {
    if (match.label !== targetLabel) {
      continue;
    }

    const expectedRatio =
      targetLabel === "Examine"
        ? CONTEXT_MENU_EXAMINE_RATIO
        : targetLabel === "Trade"
          ? CONTEXT_MENU_TRADE_RATIO
          : match.expectedRatio;
    const ratioScore = Math.max(0, 1 - Math.abs(match.actualRatio - expectedRatio) / 1.4);
    const acceptedByTemplate = match.score >= (targetLabel === "Examine" ? CONTEXT_MENU_EXAMINE_MIN_SCORE : 0.48);
    const strictTradeGeometry =
      targetLabel !== "Trade" ||
      (match.wordBox.width >= CONTEXT_MENU_TRADE_MIN_WIDTH &&
        match.wordBox.width <= CONTEXT_MENU_TRADE_MAX_WIDTH &&
        match.actualRatio >= CONTEXT_MENU_TRADE_MIN_RATIO &&
        match.actualRatio <= CONTEXT_MENU_TRADE_MAX_RATIO);
    const acceptedByGeometry =
      match.wordBox.width >= (targetLabel === "Sell" ? 26 : 18) &&
      match.wordBox.width <= 90 &&
      match.wordBox.height >= 6 &&
      match.wordBox.height <= 18 &&
      ratioScore >= 0.45 &&
      match.whitePixelCount >= 18 &&
      strictTradeGeometry;

    if ((!acceptedByTemplate && !acceptedByGeometry) || !strictTradeGeometry) {
      continue;
    }

    const score = Math.max(match.score, 0.5 + ratioScore * 0.34 + Math.min(0.16, match.whitePixelCount / 800));
    const labelMatch = {
      ...match,
      label: targetLabel,
      score,
      ratioScore: Math.max(match.ratioScore, ratioScore),
      expectedRatio,
    };

    if (
      !bestMatch ||
      (targetLabel === "Sell" && labelMatch.band.centerY < bestMatch.band.centerY) ||
      (targetLabel !== "Sell" && labelMatch.score > bestMatch.score)
    ) {
      bestMatch = labelMatch;
    }
  }

  if (targetLabel === "Trade") {
    for (const match of matches) {
      const ratioScore = Math.max(0, 1 - Math.abs(match.actualRatio - CONTEXT_MENU_TRADE_RATIO) / 0.85);
      const geometryLooksLikeTrade =
        match.wordBox.width >= CONTEXT_MENU_TRADE_MIN_WIDTH &&
        match.wordBox.width <= CONTEXT_MENU_TRADE_MAX_WIDTH &&
        match.wordBox.height >= 6 &&
        match.wordBox.height <= 18 &&
        match.actualRatio >= CONTEXT_MENU_TRADE_MIN_RATIO &&
        match.actualRatio <= CONTEXT_MENU_TRADE_MAX_RATIO &&
        ratioScore >= 0.55 &&
        match.whitePixelCount >= 18;

      if (!geometryLooksLikeTrade) {
        continue;
      }

      const score = 0.62 + ratioScore * 0.32 + Math.min(0.06, match.whitePixelCount / 1200);
      const geometryMatch: ContextMenuWordMatch = {
        ...match,
        label: "Trade",
        score,
        ratioScore: Math.max(match.ratioScore, ratioScore),
        expectedRatio: CONTEXT_MENU_TRADE_RATIO,
      };

      if (!bestMatch || geometryMatch.score > bestMatch.score || geometryMatch.band.centerY < bestMatch.band.centerY) {
        bestMatch = geometryMatch;
      }
    }
  }

  return { match: bestMatch, matches };
}

export function formatContextMenuWordMatch(match: ContextMenuWordMatch): string {
  return `${match.label}@${match.wordBox.x},${match.wordBox.y},${match.wordBox.width}x${match.wordBox.height}:score=${match.score.toFixed(2)} shape=${match.shapeScore.toFixed(2)} ratio=${match.actualRatio.toFixed(2)}`;
}
