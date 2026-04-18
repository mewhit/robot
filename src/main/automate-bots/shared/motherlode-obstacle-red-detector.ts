import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { RobotBitmap } from "./ocr-engine";

export type MotherlodeObstacleRedBox = {
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
  redDominance: number;
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

type SearchBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const SEARCH_LEFT_RATIO = 0.14;
const SEARCH_RIGHT_RATIO = 0.78;
const SEARCH_TOP_RATIO = 0.18;
const SEARCH_BOTTOM_RATIO = 0.78;

const MIN_PIXEL_COUNT = 220;
const MIN_BOX_SIDE_PX = 30;
const MAX_BOX_SIDE_PX = 70;
const MIN_FILL_RATIO = 0.2;
const MAX_FILL_RATIO = 0.96;
const MIN_ASPECT_RATIO = 0.75;
const MAX_ASPECT_RATIO = 1.32;
const MIN_AVG_RED = 145;
const MAX_AVG_GREEN = 95;
const MAX_AVG_BLUE = 95;
const MIN_RED_DOMINANCE = 34;
const MIN_RED_MINUS_GREEN = 55;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isMotherlodeObstacleRedPixel(r: number, g: number, b: number): boolean {
  return r >= 115 && r - g >= 24 && r - b >= 18 && b <= 140;
}

function resolveSearchBounds(bitmap: RobotBitmap): SearchBounds {
  const minX = clamp(Math.round(bitmap.width * SEARCH_LEFT_RATIO), 0, bitmap.width - 1);
  const maxX = clamp(Math.round(bitmap.width * SEARCH_RIGHT_RATIO), 0, bitmap.width - 1);
  const minY = clamp(Math.round(bitmap.height * SEARCH_TOP_RATIO), 0, bitmap.height - 1);
  const maxY = clamp(Math.round(bitmap.height * SEARCH_BOTTOM_RATIO), 0, bitmap.height - 1);

  return {
    minX,
    minY,
    maxX,
    maxY,
  };
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

function buildMask(bitmap: RobotBitmap, bounds: SearchBounds): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isMotherlodeObstacleRedPixel(r, g, b)) {
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

    const stack = [startIndex];
    remaining[startIndex] = 0;

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

function toMotherlodeObstacleRedBox(
  candidate: BoxCandidate,
  sourceWidth: number,
  sourceHeight: number,
): MotherlodeObstacleRedBox | null {
  const width = candidate.maxX - candidate.minX + 1;
  const height = candidate.maxY - candidate.minY + 1;
  const fillRatio = candidate.pixelCount / (width * height);
  const aspectRatio = width / height;

  if (candidate.pixelCount < MIN_PIXEL_COUNT) {
    return null;
  }

  if (
    width < MIN_BOX_SIDE_PX ||
    height < MIN_BOX_SIDE_PX ||
    width > MAX_BOX_SIDE_PX ||
    height > MAX_BOX_SIDE_PX
  ) {
    return null;
  }

  if (fillRatio < MIN_FILL_RATIO || fillRatio > MAX_FILL_RATIO) {
    return null;
  }

  if (aspectRatio < MIN_ASPECT_RATIO || aspectRatio > MAX_ASPECT_RATIO) {
    return null;
  }

  const avgRed = candidate.redSum / candidate.pixelCount;
  const avgGreen = candidate.greenSum / candidate.pixelCount;
  const avgBlue = candidate.blueSum / candidate.pixelCount;
  const redDominance = avgRed - (avgGreen + avgBlue) / 2;
  const redMinusGreen = avgRed - avgGreen;

  if (
    avgRed < MIN_AVG_RED ||
    avgGreen > MAX_AVG_GREEN ||
    avgBlue > MAX_AVG_BLUE ||
    redDominance < MIN_RED_DOMINANCE
  ) {
    return null;
  }

  if (redMinusGreen < MIN_RED_MINUS_GREEN) {
    return null;
  }

  const centerX = Math.round(candidate.minX + width / 2);
  const centerY = Math.round(candidate.minY + height / 2);

  const dx = centerX - sourceWidth / 2;
  const dy = centerY - sourceHeight / 2;
  const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
  const maxDistance = Math.sqrt((sourceWidth / 2) ** 2 + (sourceHeight / 2) ** 2);
  const normalizedDistance = maxDistance > 0 ? distanceFromCenter / maxDistance : 0;

  const score =
    candidate.pixelCount +
    fillRatio * 280 +
    redDominance * 3 -
    Math.abs(aspectRatio - 1) * 120 -
    normalizedDistance * 180;

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
    redDominance,
    score,
  };
}

function sortBoxes(boxes: MotherlodeObstacleRedBox[]): MotherlodeObstacleRedBox[] {
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

export function detectMotherlodeObstacleRedBoxesInScreenshot(bitmap: RobotBitmap): MotherlodeObstacleRedBox[] {
  const bounds = resolveSearchBounds(bitmap);
  const mask = buildMask(bitmap, bounds);
  const components = collectConnectedComponents(mask, bitmap).filter((candidate) => candidate.pixelCount >= 10);
  const boxes = components
    .map((candidate) => toMotherlodeObstacleRedBox(candidate, bitmap.width, bitmap.height))
    .filter((box): box is MotherlodeObstacleRedBox => box !== null);

  return sortBoxes(boxes);
}

export function detectBestMotherlodeObstacleRedBoxInScreenshot(bitmap: RobotBitmap): MotherlodeObstacleRedBox | null {
  return detectMotherlodeObstacleRedBoxesInScreenshot(bitmap)[0] ?? null;
}

export function saveBitmapWithMotherlodeObstacleRedBoxes(
  bitmap: RobotBitmap,
  boxes: MotherlodeObstacleRedBox[],
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
    // Draw a visible black frame around each detection (outside + edge ring).
    drawRectangleOnPng(png, box.x - 4, box.y - 4, box.width + 8, box.height + 8, { r: 0, g: 0, b: 0 }, 4);
    drawRectangleOnPng(png, box.x, box.y, box.width, box.height, { r: 0, g: 0, b: 0 }, 3);
  }

  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(filename));
}
