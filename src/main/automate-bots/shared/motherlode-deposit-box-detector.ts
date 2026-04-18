import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { RobotBitmap } from "./ocr-engine";

export type MotherlodeDepositBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixelCount: number;
  fillRatio: number;
  aspectRatio: number;
  profile: "compact" | "flat";
  score: number;
};

type BoxCandidate = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
};

type SearchBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const SEARCH_LEFT_RATIO = 0.02;
const SEARCH_RIGHT_RATIO = 0.82;
const SEARCH_TOP_RATIO = 0.04;
const SEARCH_BOTTOM_RATIO = 0.82;

const COMPACT_MIN_PIXEL_COUNT = 120;
const COMPACT_MIN_WIDTH_PX = 16;
const COMPACT_MIN_HEIGHT_PX = 16;
const COMPACT_MAX_WIDTH_PX = 90;
const COMPACT_MAX_HEIGHT_PX = 90;
const COMPACT_MIN_FILL_RATIO = 0.1;
const COMPACT_MAX_FILL_RATIO = 0.88;
const COMPACT_MIN_ASPECT_RATIO = 0.5;
const COMPACT_MAX_ASPECT_RATIO = 3.2;

const FLAT_MIN_PIXEL_COUNT = 180;
const FLAT_MIN_WIDTH_PX = 44;
const FLAT_MIN_HEIGHT_PX = 10;
const FLAT_MAX_WIDTH_PX = 170;
const FLAT_MAX_HEIGHT_PX = 70;
const FLAT_MIN_FILL_RATIO = 0.08;
const FLAT_MAX_FILL_RATIO = 0.82;
const FLAT_MIN_ASPECT_RATIO = 0.1;
const FLAT_MAX_ASPECT_RATIO = 0.58;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isMotherlodeDepositCyanPixel(r: number, g: number, b: number): boolean {
  return r <= 80 && g >= 145 && b >= 145 && g - r >= 70 && b - r >= 70 && Math.abs(g - b) <= 90;
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

function buildDepositMask(bitmap: RobotBitmap, bounds: SearchBounds): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isMotherlodeDepositCyanPixel(r, g, b)) {
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
    });
  }

  return components;
}

function toDepositBox(candidate: BoxCandidate, sourceWidth: number, sourceHeight: number): MotherlodeDepositBox | null {
  const width = candidate.maxX - candidate.minX + 1;
  const height = candidate.maxY - candidate.minY + 1;
  const fillRatio = candidate.pixelCount / (width * height);
  const aspectRatio = height / width;

  const compactGeometryOk =
    candidate.pixelCount >= COMPACT_MIN_PIXEL_COUNT &&
    width >= COMPACT_MIN_WIDTH_PX &&
    height >= COMPACT_MIN_HEIGHT_PX &&
    width <= COMPACT_MAX_WIDTH_PX &&
    height <= COMPACT_MAX_HEIGHT_PX &&
    fillRatio >= COMPACT_MIN_FILL_RATIO &&
    fillRatio <= COMPACT_MAX_FILL_RATIO &&
    aspectRatio >= COMPACT_MIN_ASPECT_RATIO &&
    aspectRatio <= COMPACT_MAX_ASPECT_RATIO;

  const flatGeometryOk =
    candidate.pixelCount >= FLAT_MIN_PIXEL_COUNT &&
    width >= FLAT_MIN_WIDTH_PX &&
    height >= FLAT_MIN_HEIGHT_PX &&
    width <= FLAT_MAX_WIDTH_PX &&
    height <= FLAT_MAX_HEIGHT_PX &&
    fillRatio >= FLAT_MIN_FILL_RATIO &&
    fillRatio <= FLAT_MAX_FILL_RATIO &&
    aspectRatio >= FLAT_MIN_ASPECT_RATIO &&
    aspectRatio <= FLAT_MAX_ASPECT_RATIO;

  if (!compactGeometryOk && !flatGeometryOk) {
    return null;
  }

  const profile: "compact" | "flat" = flatGeometryOk && !compactGeometryOk ? "flat" : "compact";
  const centerX = Math.round(candidate.minX + width / 2);
  const centerY = Math.round(candidate.minY + height / 2);

  const dx = centerX - sourceWidth / 2;
  const dy = centerY - sourceHeight / 2;
  const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
  const maxDistance = Math.sqrt((sourceWidth / 2) ** 2 + (sourceHeight / 2) ** 2);
  const normalizedDistance = maxDistance > 0 ? distanceFromCenter / maxDistance : 0;

  const profileBias = profile === "flat" ? 120 : 80;
  const score =
    candidate.pixelCount +
    width * 2.4 +
    height * 1.8 +
    fillRatio * 260 +
    profileBias -
    normalizedDistance * 120;

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
    profile,
    score,
  };
}

function sortBoxes(boxes: MotherlodeDepositBox[]): MotherlodeDepositBox[] {
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

export function detectMotherlodeDepositBoxesInScreenshot(bitmap: RobotBitmap): MotherlodeDepositBox[] {
  const bounds = resolveSearchBounds(bitmap);
  const mask = buildDepositMask(bitmap, bounds);
  const components = collectConnectedComponents(mask, bitmap.width, bitmap.height).filter((c) => c.pixelCount >= 8);
  const boxes = components.map((candidate) => toDepositBox(candidate, bitmap.width, bitmap.height)).filter((box): box is MotherlodeDepositBox => box !== null);
  return sortBoxes(boxes);
}

export function detectBestMotherlodeDepositBoxInScreenshot(bitmap: RobotBitmap): MotherlodeDepositBox | null {
  return detectMotherlodeDepositBoxesInScreenshot(bitmap)[0] ?? null;
}

export function saveBitmapWithMotherlodeDepositBoxes(
  bitmap: RobotBitmap,
  boxes: MotherlodeDepositBox[],
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
    drawRectangleOnPng(png, box.x, box.y, box.width, box.height, { r: 0, g: 0, b: 0 }, 3);
  }

  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(filename));
}
