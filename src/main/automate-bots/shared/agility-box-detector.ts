import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { RobotBitmap } from "./ocr-engine";

export type AgilityBoxColor = "red" | "magenta";

export type AgilityBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  color: AgilityBoxColor;
  pixelCount: number;
  fillRatio: number;
  score: number;
};

type BoxCandidate = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
  color: AgilityBoxColor;
};

type MaskComponent = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
  pixels: number[];
};

const MIN_PIXEL_COUNT = 250;
const MIN_BOX_SIDE_PX = 24;
const MAX_FILL_RATIO = 0.82;
const MIN_COMPONENT_SPLIT_IMPROVEMENT_RATIO = 0.15;
const MAX_COMPONENT_SPLIT_DEPTH = 2;

function isRedOverlayPixel(r: number, g: number, b: number): boolean {
  return r >= 135 && r - g >= 40 && r - b >= 28 && b <= g + 25;
}

function isMagentaOverlayPixel(r: number, g: number, b: number): boolean {
  return r >= 135 && b >= 110 && r - g >= 50 && b - g >= 40 && Math.abs(r - b) <= 90;
}

function isOverlayPixel(color: AgilityBoxColor, r: number, g: number, b: number): boolean {
  return color === "red" ? isRedOverlayPixel(r, g, b) : isMagentaOverlayPixel(r, g, b);
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

function buildOverlayMask(bitmap: RobotBitmap, color: AgilityBoxColor): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isOverlayPixel(color, r, g, b)) {
        continue;
      }

      const index = y * bitmap.width + x;
      mask[index] = 1;
    }
  }

  return mask;
}

function collectConnectedComponents(mask: Uint8Array, width: number, height: number): MaskComponent[] {
  const remaining = mask.slice();
  const components: MaskComponent[] = [];

  for (let startIndex = 0; startIndex < remaining.length; startIndex += 1) {
    if (!remaining[startIndex]) {
      continue;
    }

    const stack = [startIndex];
    remaining[startIndex] = 0;

    let pixelCount = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    const pixels: number[] = [];

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
      pixels.push(index);

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }

          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
            continue;
          }

          const nextIndex = nextY * width + nextX;
          if (!remaining[nextIndex]) {
            continue;
          }

          remaining[nextIndex] = 0;
          stack.push(nextIndex);
        }
      }
    }

    components.push({
      minX,
      minY,
      maxX,
      maxY,
      pixelCount,
      pixels,
    });
  }

  return components;
}

function buildComponentFromAssignedPixels(pixels: number[], width: number): MaskComponent | null {
  if (pixels.length === 0) {
    return null;
  }

  let minX = width;
  let minY = Number.MAX_SAFE_INTEGER;
  let maxX = -1;
  let maxY = -1;

  for (const index of pixels) {
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    pixelCount: pixels.length,
    pixels,
  };
}

function toBoxCandidate(component: MaskComponent, color: AgilityBoxColor): BoxCandidate {
  return {
    minX: component.minX,
    minY: component.minY,
    maxX: component.maxX,
    maxY: component.maxY,
    pixelCount: component.pixelCount,
    color,
  };
}

function getCandidateArea(candidate: BoxCandidate): number {
  return (candidate.maxX - candidate.minX + 1) * (candidate.maxY - candidate.minY + 1);
}

function findBestAxisSplit(component: MaskComponent, sourceWidth: number, color: AgilityBoxColor): [MaskComponent, MaskComponent] | null {
  const originalCandidate = toBoxCandidate(component, color);
  const originalArea = getCandidateArea(originalCandidate);
  let bestSplit: { first: MaskComponent; second: MaskComponent; improvement: number } | null = null;

  const considerSplit = (firstPixels: number[], secondPixels: number[]) => {
    const first = buildComponentFromAssignedPixels(firstPixels, sourceWidth);
    const second = buildComponentFromAssignedPixels(secondPixels, sourceWidth);
    if (!first || !second) {
      return;
    }

    const firstCandidate = toBoxCandidate(first, color);
    const secondCandidate = toBoxCandidate(second, color);
    if (!toAgilityBox(firstCandidate) || !toAgilityBox(secondCandidate)) {
      return;
    }

    const improvement = originalArea - (getCandidateArea(firstCandidate) + getCandidateArea(secondCandidate));
    if (improvement <= 0) {
      return;
    }

    if (!bestSplit || improvement > bestSplit.improvement) {
      bestSplit = { first, second, improvement };
    }
  };

  for (let splitX = component.minX; splitX < component.maxX; splitX += 1) {
    const leftPixels: number[] = [];
    const rightPixels: number[] = [];

    for (const index of component.pixels) {
      const x = index % sourceWidth;
      if (x <= splitX) {
        leftPixels.push(index);
      } else {
        rightPixels.push(index);
      }
    }

    considerSplit(leftPixels, rightPixels);
  }

  for (let splitY = component.minY; splitY < component.maxY; splitY += 1) {
    const topPixels: number[] = [];
    const bottomPixels: number[] = [];

    for (const index of component.pixels) {
      const y = Math.floor(index / sourceWidth);
      if (y <= splitY) {
        topPixels.push(index);
      } else {
        bottomPixels.push(index);
      }
    }

    considerSplit(topPixels, bottomPixels);
  }

  if (!bestSplit) {
    return null;
  }

  const finalSplit: { first: MaskComponent; second: MaskComponent; improvement: number } = bestSplit;
  if (finalSplit.improvement / originalArea < MIN_COMPONENT_SPLIT_IMPROVEMENT_RATIO) {
    return null;
  }

  return [finalSplit.first, finalSplit.second];
}

function splitComponentIfNeeded(
  component: MaskComponent,
  sourceWidth: number,
  color: AgilityBoxColor,
  depth = 0,
): BoxCandidate[] {
  if (depth >= MAX_COMPONENT_SPLIT_DEPTH) {
    return [toBoxCandidate(component, color)];
  }

  const split = findBestAxisSplit(component, sourceWidth, color);
  if (!split) {
    return [toBoxCandidate(component, color)];
  }

  return [
    ...splitComponentIfNeeded(split[0], sourceWidth, color, depth + 1),
    ...splitComponentIfNeeded(split[1], sourceWidth, color, depth + 1),
  ];
}

function buildCandidateBoxes(bitmap: RobotBitmap, color: AgilityBoxColor): BoxCandidate[] {
  const mask = buildOverlayMask(bitmap, color);
  const components = collectConnectedComponents(mask, bitmap.width, bitmap.height);
  const candidates: BoxCandidate[] = [];

  for (const component of components) {
    candidates.push(...splitComponentIfNeeded(component, bitmap.width, color));
  }

  return candidates;
}

function toAgilityBox(candidate: BoxCandidate): AgilityBox | null {
  const width = candidate.maxX - candidate.minX + 1;
  const height = candidate.maxY - candidate.minY + 1;

  if (candidate.pixelCount < MIN_PIXEL_COUNT) {
    return null;
  }

  if (Math.min(width, height) < MIN_BOX_SIDE_PX) {
    return null;
  }

  const fillRatio = candidate.pixelCount / (width * height);
  if (fillRatio > MAX_FILL_RATIO) {
    return null;
  }

  const boxArea = width * height;
  const score = candidate.pixelCount + boxArea * 0.1;

  return {
    x: candidate.minX,
    y: candidate.minY,
    width,
    height,
    color: candidate.color,
    pixelCount: candidate.pixelCount,
    fillRatio,
    score,
  };
}

function sortBoxes(boxes: AgilityBox[]): AgilityBox[] {
  return boxes.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    if (b.pixelCount !== a.pixelCount) {
      return b.pixelCount - a.pixelCount;
    }

    return a.color.localeCompare(b.color);
  });
}

export function detectAgilityBoxesInScreenshot(bitmap: RobotBitmap): AgilityBox[] {
  const redBoxes = buildCandidateBoxes(bitmap, "red").map(toAgilityBox).filter((box): box is AgilityBox => box !== null);
  const magentaBoxes = buildCandidateBoxes(bitmap, "magenta").map(toAgilityBox).filter((box): box is AgilityBox => box !== null);

  return sortBoxes([...redBoxes, ...magentaBoxes]);
}

export function detectBestAgilityBoxInScreenshot(bitmap: RobotBitmap, preferredColor?: AgilityBoxColor): AgilityBox | null {
  const boxes = detectAgilityBoxesInScreenshot(bitmap);
  if (!preferredColor) {
    return boxes[0] ?? null;
  }

  return boxes.find((box) => box.color === preferredColor) ?? null;
}

export function saveBitmapWithAgilityBoxes(bitmap: RobotBitmap, boxes: AgilityBox[], filename: string): void {
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
    drawRectangleOnPng(png, box.x, box.y, box.width, box.height, { r: 0, g: 0, b: 0 }, 3);
  }

  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(filename));
}
