import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { RobotBitmap } from "./ocr-engine";

export type MithrilActiveMarkerBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixelCount: number;
  fillRatio: number;
  aspectRatio: number;
  avgRed: number;
  avgGreen: number;
  avgBlue: number;
  score: number;
};

type BoxCandidate = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
  redSum: number;
  greenSum: number;
  blueSum: number;
};

const MIN_PIXEL_COUNT = 120;
const MAX_PIXEL_COUNT = 320;
const MIN_BOX_SIZE_PX = 20;
const MAX_BOX_SIZE_PX = 40;
const MIN_FILL_RATIO = 0.1;
const MAX_FILL_RATIO = 0.35;
const MIN_YELLOW_DOMINANCE = 18;
const MERGE_GAP_PX = 2;

function isMithrilActiveMarkerPixel(r: number, g: number, b: number): boolean {
  return r >= 110 && g >= 80 && b <= 80 && r - g >= 8 && g - b >= 10 && r - b >= 40 && r + g >= 210;
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

function buildMarkerMask(bitmap: RobotBitmap): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isMithrilActiveMarkerPixel(r, g, b)) {
        continue;
      }

      mask[y * bitmap.width + x] = 1;
    }
  }

  return mask;
}

function collectConnectedComponents(mask: Uint8Array, bitmap: RobotBitmap): BoxCandidate[] {
  const remaining = mask.slice();
  const components: BoxCandidate[] = [];

  for (let startIndex = 0; startIndex < remaining.length; startIndex += 1) {
    if (!remaining[startIndex]) {
      continue;
    }

    remaining[startIndex] = 0;
    const stack = [startIndex];

    let minX = bitmap.width;
    let minY = bitmap.height;
    let maxX = -1;
    let maxY = -1;
    let pixelCount = 0;
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;

    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) {
        break;
      }

      const x = index % bitmap.width;
      const y = Math.floor(index / bitmap.width);
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      pixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      redSum += r;
      greenSum += g;
      blueSum += b;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }

          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= bitmap.width || nextY >= bitmap.height) {
            continue;
          }

          const nextIndex = nextY * bitmap.width + nextX;
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
      redSum,
      greenSum,
      blueSum,
    });
  }

  return components;
}

function mergeNearbyComponents(components: BoxCandidate[], gap: number): BoxCandidate[] {
  const pending = components.slice();
  const merged: BoxCandidate[] = [];

  while (pending.length > 0) {
    let current = pending.pop();
    if (!current) {
      break;
    }

    let mergedOne = true;
    while (mergedOne) {
      mergedOne = false;

      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const next = pending[index];
        const separated =
          current.maxX + gap < next.minX ||
          next.maxX + gap < current.minX ||
          current.maxY + gap < next.minY ||
          next.maxY + gap < current.minY;

        if (separated) {
          continue;
        }

        pending.splice(index, 1);
        current = {
          minX: Math.min(current.minX, next.minX),
          minY: Math.min(current.minY, next.minY),
          maxX: Math.max(current.maxX, next.maxX),
          maxY: Math.max(current.maxY, next.maxY),
          pixelCount: current.pixelCount + next.pixelCount,
          redSum: current.redSum + next.redSum,
          greenSum: current.greenSum + next.greenSum,
          blueSum: current.blueSum + next.blueSum,
        };
        mergedOne = true;
      }
    }

    merged.push(current);
  }

  return merged;
}

function toMarkerBox(candidate: BoxCandidate): MithrilActiveMarkerBox | null {
  const width = candidate.maxX - candidate.minX + 1;
  const height = candidate.maxY - candidate.minY + 1;
  const fillRatio = candidate.pixelCount / (width * height);
  const aspectRatio = width / height;

  if (candidate.pixelCount < MIN_PIXEL_COUNT || candidate.pixelCount > MAX_PIXEL_COUNT) {
    return null;
  }

  if (width < MIN_BOX_SIZE_PX || width > MAX_BOX_SIZE_PX) {
    return null;
  }

  if (height < MIN_BOX_SIZE_PX || height > MAX_BOX_SIZE_PX) {
    return null;
  }

  if (fillRatio < MIN_FILL_RATIO || fillRatio > MAX_FILL_RATIO) {
    return null;
  }

  if (aspectRatio < 0.75 || aspectRatio > 1.25) {
    return null;
  }

  const avgRed = candidate.redSum / candidate.pixelCount;
  const avgGreen = candidate.greenSum / candidate.pixelCount;
  const avgBlue = candidate.blueSum / candidate.pixelCount;
  const yellowDominance = avgGreen - avgBlue;
  if (yellowDominance < MIN_YELLOW_DOMINANCE) {
    return null;
  }

  const centerX = Math.round(candidate.minX + width / 2);
  const centerY = Math.round(candidate.minY + height / 2);
  const score = candidate.pixelCount + fillRatio * 300 - Math.abs(aspectRatio - 1) * 120 + (avgRed - avgBlue) * 2;

  return {
    x: candidate.minX,
    y: candidate.minY,
    width,
    height,
    centerX,
    centerY,
    pixelCount: candidate.pixelCount,
    fillRatio,
    aspectRatio,
    avgRed,
    avgGreen,
    avgBlue,
    score,
  };
}

function sortBoxes(boxes: MithrilActiveMarkerBox[]): MithrilActiveMarkerBox[] {
  return boxes.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    if (b.pixelCount !== a.pixelCount) {
      return b.pixelCount - a.pixelCount;
    }

    return a.x - b.x;
  });
}

export function detectMithrilActiveMarkerBoxesInScreenshot(bitmap: RobotBitmap): MithrilActiveMarkerBox[] {
  const mask = buildMarkerMask(bitmap);
  const components = collectConnectedComponents(mask, bitmap).filter((candidate) => candidate.pixelCount >= 8);
  const mergedComponents = mergeNearbyComponents(components, MERGE_GAP_PX);
  const boxes = mergedComponents.map(toMarkerBox).filter((box): box is MithrilActiveMarkerBox => box !== null);
  return sortBoxes(boxes);
}

export function saveBitmapWithMithrilActiveMarkerBoxes(
  bitmap: RobotBitmap,
  boxes: MithrilActiveMarkerBox[],
  filename: string,
): void {
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
    drawRectangleOnPng(png, box.x, box.y, box.width, box.height, { r: 255, g: 0, b: 0 }, 2);
  }

  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(filename));
}
