import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { RobotBitmap } from "./ocr-engine";

export type AttackOptionRow = {
  x: number;
  y: number;
  width: number;
  height: number;
  textX: number;
  textY: number;
  textWidth: number;
  textHeight: number;
  centerX: number;
  centerY: number;
  brightPixelCount: number;
  whitePixelCount: number;
  yellowPixelCount: number;
  redPixelCount: number;
  attackColorPixelCount: number;
  score: number;
};

export type AttackBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  bodyX: number;
  bodyY: number;
  bodyWidth: number;
  bodyHeight: number;
  pixelCount: number;
  fillRatio: number;
  optionCount: number;
  attackOption: AttackOptionRow | null;
  score: number;
};

type BoxCandidate = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
};

type RowBand = {
  startY: number;
  endY: number;
};

const MENU_BODY_TARGET = { r: 93, g: 84, b: 71 };
const MENU_BODY_TOLERANCE = 6;
const MIN_BODY_PIXEL_COUNT = 1800;
const MIN_BODY_WIDTH_PX = 120;
const MIN_BODY_HEIGHT_PX = 50;
const MIN_BODY_FILL_RATIO = 0.4;
const MAX_BODY_FILL_RATIO = 0.98;
const MIN_BODY_ASPECT_RATIO = 1.5;
const MAX_BODY_ASPECT_RATIO = 8.5;
const MIN_FRAME_PIXEL_COUNT = 150;
const MAX_FRAME_WIDTH_DELTA_PX = 28;
const MAX_FRAME_VERTICAL_GAP_PX = 64;
const MAX_FRAME_OVERLAP_MARGIN_PX = 12;
const ROW_MERGE_GAP_PX = 4;
const MIN_OPTION_BAND_HEIGHT_PX = 6;
const MAX_OPTION_BAND_HEIGHT_PX = 36;
const MIN_ATTACK_COLOR_PIXELS = 120;

function isNearColor(
  r: number,
  g: number,
  b: number,
  target: { r: number; g: number; b: number },
  tolerance: number,
): boolean {
  return Math.abs(r - target.r) <= tolerance && Math.abs(g - target.g) <= tolerance && Math.abs(b - target.b) <= tolerance;
}

function isMenuBodyPixel(r: number, g: number, b: number): boolean {
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return (
    isNearColor(r, g, b, MENU_BODY_TARGET, MENU_BODY_TOLERANCE) &&
    r >= g &&
    g >= b &&
    spread <= 36
  );
}

function isMenuFramePixel(r: number, g: number, b: number): boolean {
  return r <= 12 && g <= 12 && b <= 12;
}

function isWhiteOptionPixel(r: number, g: number, b: number): boolean {
  return r >= 220 && g >= 220 && b >= 220;
}

function isYellowOptionPixel(r: number, g: number, b: number): boolean {
  return r >= 180 && g >= 150 && b <= 110 && r - b >= 70;
}

function isRedOptionPixel(r: number, g: number, b: number): boolean {
  return r >= 170 && g <= 120 && b <= 120 && r - Math.max(g, b) >= 70;
}

function isBrightOptionPixel(r: number, g: number, b: number): boolean {
  return isWhiteOptionPixel(r, g, b) || isYellowOptionPixel(r, g, b) || isRedOptionPixel(r, g, b);
}

function drawRectangleOnPng(
  png: PNG,
  x: number,
  y: number,
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
  thickness: number,
): void {
  const clampX0 = Math.max(0, Math.min(png.width - 1, x));
  const clampY0 = Math.max(0, Math.min(png.height - 1, y));
  const clampX1 = Math.max(0, Math.min(png.width - 1, x + width - 1));
  const clampY1 = Math.max(0, Math.min(png.height - 1, y + height - 1));

  if (clampX1 < clampX0 || clampY1 < clampY0) {
    return;
  }

  const paintPixel = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= png.width || py >= png.height) {
      return;
    }

    const idx = (py * png.width + px) * 4;
    png.data[idx] = color.r;
    png.data[idx + 1] = color.g;
    png.data[idx + 2] = color.b;
    png.data[idx + 3] = 255;
  };

  for (let t = 0; t < thickness; t += 1) {
    const top = clampY0 + t;
    const bottom = clampY1 - t;
    const left = clampX0 + t;
    const right = clampX1 - t;

    if (left > right || top > bottom) {
      break;
    }

    for (let px = left; px <= right; px += 1) {
      paintPixel(px, top);
      paintPixel(px, bottom);
    }

    for (let py = top; py <= bottom; py += 1) {
      paintPixel(left, py);
      paintPixel(right, py);
    }
  }
}

function buildMask(bitmap: RobotBitmap, predicate: (r: number, g: number, b: number) => boolean): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!predicate(r, g, b)) {
        continue;
      }

      mask[y * bitmap.width + x] = 1;
    }
  }

  return mask;
}

function collectConnectedComponents(mask: Uint8Array, width: number, height: number): BoxCandidate[] {
  const remaining = mask.slice();
  const components: BoxCandidate[] = [];

  for (let startIndex = 0; startIndex < remaining.length; startIndex += 1) {
    if (!remaining[startIndex]) {
      continue;
    }

    const stack = [startIndex];
    remaining[startIndex] = 0;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let pixelCount = 0;

    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) {
        break;
      }

      const x = index % width;
      const y = Math.floor(index / width);

      pixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const nextIndex of neighbors) {
        if (nextIndex < 0 || nextIndex >= remaining.length || !remaining[nextIndex]) {
          continue;
        }

        const nextX = nextIndex % width;
        const nextY = Math.floor(nextIndex / width);
        if (Math.abs(nextX - x) + Math.abs(nextY - y) !== 1) {
          continue;
        }

        remaining[nextIndex] = 0;
        stack.push(nextIndex);
      }
    }

    components.push({
      minX,
      minY,
      maxX,
      maxY,
      pixelCount,
    });
  }

  return components;
}

function getWidth(candidate: BoxCandidate): number {
  return candidate.maxX - candidate.minX + 1;
}

function getHeight(candidate: BoxCandidate): number {
  return candidate.maxY - candidate.minY + 1;
}

function getFillRatio(candidate: BoxCandidate): number {
  return candidate.pixelCount / (getWidth(candidate) * getHeight(candidate));
}

function getXOverlap(a: BoxCandidate, b: BoxCandidate): number {
  return Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) + 1);
}

function getVerticalGap(a: BoxCandidate, b: BoxCandidate): number {
  if (a.maxY < b.minY) {
    return b.minY - a.maxY;
  }

  if (b.maxY < a.minY) {
    return a.minY - b.maxY;
  }

  return 0;
}

function unionBounds(candidates: BoxCandidate[]): BoxCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  let minX = Number.MAX_SAFE_INTEGER;
  let minY = Number.MAX_SAFE_INTEGER;
  let maxX = -1;
  let maxY = -1;
  let pixelCount = 0;

  for (const candidate of candidates) {
    minX = Math.min(minX, candidate.minX);
    minY = Math.min(minY, candidate.minY);
    maxX = Math.max(maxX, candidate.maxX);
    maxY = Math.max(maxY, candidate.maxY);
    pixelCount += candidate.pixelCount;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    pixelCount,
  };
}

function findRelevantFrameComponents(bodyCandidate: BoxCandidate, frameComponents: BoxCandidate[]): BoxCandidate[] {
  const bodyWidth = getWidth(bodyCandidate);

  return frameComponents.filter((component) => {
    const componentWidth = getWidth(component);
    const widthDelta = Math.abs(componentWidth - (bodyWidth + 4));
    const xOverlap = getXOverlap(component, {
      ...bodyCandidate,
      minX: bodyCandidate.minX - MAX_FRAME_OVERLAP_MARGIN_PX,
      maxX: bodyCandidate.maxX + MAX_FRAME_OVERLAP_MARGIN_PX,
    });
    const overlapRatio = xOverlap / Math.max(1, bodyWidth);
    const verticalGap = getVerticalGap(component, bodyCandidate);

    return (
      component.pixelCount >= MIN_FRAME_PIXEL_COUNT &&
      componentWidth >= bodyWidth - MAX_FRAME_WIDTH_DELTA_PX &&
      componentWidth <= bodyWidth + MAX_FRAME_WIDTH_DELTA_PX &&
      overlapRatio >= 0.88 &&
      verticalGap <= MAX_FRAME_VERTICAL_GAP_PX
    );
  });
}

function findOptionRowBands(bitmap: RobotBitmap, searchBounds: BoxCandidate): RowBand[] {
  const width = getWidth(searchBounds);
  const rowThreshold = Math.max(10, Math.floor(width * 0.02));
  const bands: RowBand[] = [];
  let activeStart = -1;
  let inactiveGap = 0;

  for (let y = searchBounds.minY; y <= searchBounds.maxY; y += 1) {
    let brightCount = 0;

    for (let x = searchBounds.minX; x <= searchBounds.maxX; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (isBrightOptionPixel(r, g, b)) {
        brightCount += 1;
      }
    }

    if (brightCount >= rowThreshold) {
      if (activeStart < 0) {
        activeStart = y;
      }
      inactiveGap = 0;
      continue;
    }

    if (activeStart < 0) {
      continue;
    }

    inactiveGap += 1;
    if (inactiveGap <= ROW_MERGE_GAP_PX) {
      continue;
    }

    const endY = y - inactiveGap;
    if (endY - activeStart + 1 >= MIN_OPTION_BAND_HEIGHT_PX && endY - activeStart + 1 <= MAX_OPTION_BAND_HEIGHT_PX) {
      bands.push({ startY: activeStart, endY });
    }

    activeStart = -1;
    inactiveGap = 0;
  }

  if (activeStart >= 0) {
    const endY = searchBounds.maxY;
    if (endY - activeStart + 1 >= MIN_OPTION_BAND_HEIGHT_PX && endY - activeStart + 1 <= MAX_OPTION_BAND_HEIGHT_PX) {
      bands.push({ startY: activeStart, endY });
    }
  }

  return bands;
}

function buildOptionRow(bitmap: RobotBitmap, menuBounds: BoxCandidate, band: RowBand): AttackOptionRow | null {
  let minTextX = Number.MAX_SAFE_INTEGER;
  let minTextY = Number.MAX_SAFE_INTEGER;
  let maxTextX = -1;
  let maxTextY = -1;
  let brightPixelCount = 0;
  let whitePixelCount = 0;
  let yellowPixelCount = 0;
  let redPixelCount = 0;

  for (let y = band.startY; y <= band.endY; y += 1) {
    for (let x = menuBounds.minX; x <= menuBounds.maxX; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      const isWhite = isWhiteOptionPixel(r, g, b);
      const isYellow = isYellowOptionPixel(r, g, b);
      const isRed = isRedOptionPixel(r, g, b);
      if (!isWhite && !isYellow && !isRed) {
        continue;
      }

      brightPixelCount += 1;
      whitePixelCount += isWhite ? 1 : 0;
      yellowPixelCount += isYellow ? 1 : 0;
      redPixelCount += isRed ? 1 : 0;
      minTextX = Math.min(minTextX, x);
      minTextY = Math.min(minTextY, y);
      maxTextX = Math.max(maxTextX, x);
      maxTextY = Math.max(maxTextY, y);
    }
  }

  if (brightPixelCount === 0 || maxTextX < minTextX || maxTextY < minTextY) {
    return null;
  }

  const rowX = menuBounds.minX + 2;
  const rowY = Math.max(menuBounds.minY, band.startY - 3);
  const rowRight = Math.max(rowX, menuBounds.maxX - 2);
  const rowBottom = Math.min(menuBounds.maxY, band.endY + 3);
  const rowWidth = rowRight - rowX + 1;
  const rowHeight = rowBottom - rowY + 1;
  const textX = Math.max(rowX, minTextX - 4);
  const textY = Math.max(rowY, minTextY - 1);
  const textRight = Math.min(rowRight, maxTextX + 4);
  const textBottom = Math.min(rowBottom, maxTextY + 1);
  const textWidth = textRight - textX + 1;
  const textHeight = textBottom - textY + 1;
  const attackColorPixelCount = yellowPixelCount + redPixelCount;
  const centerX = Math.round(textX + textWidth / 2);
  const centerY = Math.round(rowY + rowHeight / 2);
  const score = brightPixelCount + attackColorPixelCount * 3 + rowWidth * 0.2;

  return {
    x: rowX,
    y: rowY,
    width: rowWidth,
    height: rowHeight,
    textX,
    textY,
    textWidth,
    textHeight,
    centerX,
    centerY,
    brightPixelCount,
    whitePixelCount,
    yellowPixelCount,
    redPixelCount,
    attackColorPixelCount,
    score,
  };
}

function fallbackMenuBounds(bitmap: RobotBitmap, bodyCandidate: BoxCandidate): BoxCandidate {
  return {
    minX: Math.max(0, bodyCandidate.minX - 2),
    minY: Math.max(0, bodyCandidate.minY - Math.max(18, Math.round(getHeight(bodyCandidate) * 0.28))),
    maxX: Math.min(bitmap.width - 1, bodyCandidate.maxX + 2),
    maxY: Math.min(bitmap.height - 1, bodyCandidate.maxY + 2),
    pixelCount: bodyCandidate.pixelCount,
  };
}

function toAttackBox(bitmap: RobotBitmap, bodyCandidate: BoxCandidate, frameComponents: BoxCandidate[]): AttackBox | null {
  const bodyWidth = getWidth(bodyCandidate);
  const bodyHeight = getHeight(bodyCandidate);
  const fillRatio = getFillRatio(bodyCandidate);
  const aspectRatio = bodyWidth / bodyHeight;

  if (bodyCandidate.pixelCount < MIN_BODY_PIXEL_COUNT) {
    return null;
  }

  if (bodyWidth < MIN_BODY_WIDTH_PX || bodyHeight < MIN_BODY_HEIGHT_PX) {
    return null;
  }

  if (fillRatio < MIN_BODY_FILL_RATIO || fillRatio > MAX_BODY_FILL_RATIO) {
    return null;
  }

  if (aspectRatio < MIN_BODY_ASPECT_RATIO || aspectRatio > MAX_BODY_ASPECT_RATIO) {
    return null;
  }

  const relevantFrameComponents = findRelevantFrameComponents(bodyCandidate, frameComponents);
  const mergedBounds = unionBounds([bodyCandidate, ...relevantFrameComponents]) ?? fallbackMenuBounds(bitmap, bodyCandidate);
  const menuBounds = relevantFrameComponents.length > 0 ? mergedBounds : fallbackMenuBounds(bitmap, bodyCandidate);
  const optionBands = findOptionRowBands(bitmap, {
    ...menuBounds,
    minY: Math.max(bodyCandidate.minY, menuBounds.minY),
  });
  const optionRows = optionBands.map((band) => buildOptionRow(bitmap, menuBounds, band)).filter((row): row is AttackOptionRow => row !== null);
  const attackOptions = optionRows.filter((row) => row.attackColorPixelCount >= MIN_ATTACK_COLOR_PIXELS);
  const attackOption = attackOptions.length > 0 ? attackOptions[attackOptions.length - 1] : null;
  const score =
    bodyCandidate.pixelCount +
    optionRows.length * 350 +
    (attackOption ? 1800 + attackOption.attackColorPixelCount : 0) +
    relevantFrameComponents.length * 220 -
    Math.abs(aspectRatio - 4) * 40;

  return {
    x: menuBounds.minX,
    y: menuBounds.minY,
    width: getWidth(menuBounds),
    height: getHeight(menuBounds),
    bodyX: bodyCandidate.minX,
    bodyY: bodyCandidate.minY,
    bodyWidth,
    bodyHeight,
    pixelCount: bodyCandidate.pixelCount,
    fillRatio,
    optionCount: optionRows.length,
    attackOption,
    score,
  };
}

function sortBoxes(boxes: AttackBox[]): AttackBox[] {
  return boxes.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    if (b.optionCount !== a.optionCount) {
      return b.optionCount - a.optionCount;
    }

    return a.x - b.x;
  });
}

export function detectAttackBoxesInScreenshot(bitmap: RobotBitmap): AttackBox[] {
  const bodyMask = buildMask(bitmap, isMenuBodyPixel);
  const frameMask = buildMask(bitmap, isMenuFramePixel);
  const bodyComponents = collectConnectedComponents(bodyMask, bitmap.width, bitmap.height);
  const frameComponents = collectConnectedComponents(frameMask, bitmap.width, bitmap.height);

  return sortBoxes(bodyComponents.map((candidate) => toAttackBox(bitmap, candidate, frameComponents)).filter((box): box is AttackBox => box !== null));
}

export function detectBestAttackBoxInScreenshot(bitmap: RobotBitmap): AttackBox | null {
  return detectAttackBoxesInScreenshot(bitmap)[0] ?? null;
}

export function saveBitmapWithAttackBoxes(bitmap: RobotBitmap, boxes: AttackBox[], filename: string): void {
  const png = new PNG({
    width: bitmap.width,
    height: bitmap.height,
  });

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const pngIdx = (y * bitmap.width + x) * 4;
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      png.data[pngIdx] = r;
      png.data[pngIdx + 1] = g;
      png.data[pngIdx + 2] = b;
      png.data[pngIdx + 3] = 255;
    }
  }

  for (const box of boxes) {
    drawRectangleOnPng(png, box.x, box.y, box.width, box.height, { r: 0, g: 255, b: 255 }, 3);
    drawRectangleOnPng(png, box.bodyX, box.bodyY, box.bodyWidth, box.bodyHeight, { r: 255, g: 255, b: 0 }, 2);

    if (box.attackOption) {
      drawRectangleOnPng(
        png,
        box.attackOption.x,
        box.attackOption.y,
        box.attackOption.width,
        box.attackOption.height,
        { r: 255, g: 0, b: 0 },
        2,
      );
      drawRectangleOnPng(
        png,
        box.attackOption.textX,
        box.attackOption.textY,
        box.attackOption.textWidth,
        box.attackOption.textHeight,
        { r: 255, g: 255, b: 255 },
        1,
      );
    }
  }

  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(filename));
}
