import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { RobotBitmap } from "./ocr-engine";

export type NpcBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixelCount: number;
  fillRatio: number;
  aspectRatio: number;
  score: number;
};

type BoxCandidate = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
};

const MIN_PIXEL_COUNT = 150;
const MIN_BOX_WIDTH_PX = 16;
const MIN_BOX_HEIGHT_PX = 24;
// Hollow UI shapes can merge with a nearby NPC ring and create an oversized false target.
// A slightly denser minimum still accepts real NPC outlines in the screenshot set.
const MIN_FILL_RATIO = 0.18;
const MAX_FILL_RATIO = 0.82;
// NPC indicators vary by model. Humanoids often look tall, while spiders and similar
// mobs produce near-square cyan rings, so the detector cannot require a portrait shape.
const MIN_ASPECT_RATIO = 0.7;
const MAX_ASPECT_RATIO = 5.5;
const MERGE_GAP_X_PX = 4;
const MERGE_GAP_Y_PX = 4;

function isNpcCyanPixel(r: number, g: number, b: number): boolean {
  return r <= 80 && g >= 145 && b >= 145 && g - r >= 70 && b - r >= 70 && Math.abs(g - b) <= 90;
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

function buildNpcMask(bitmap: RobotBitmap): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isNpcCyanPixel(r, g, b)) {
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

function mergeNearbyComponents(components: BoxCandidate[], gapX: number, gapY: number): BoxCandidate[] {
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
          current.maxX + gapX < next.minX ||
          next.maxX + gapX < current.minX ||
          current.maxY + gapY < next.minY ||
          next.maxY + gapY < current.minY;

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
        };
        mergedOne = true;
      }
    }

    merged.push(current);
  }

  return merged;
}

function toNpcBox(candidate: BoxCandidate): NpcBox | null {
  const width = candidate.maxX - candidate.minX + 1;
  const height = candidate.maxY - candidate.minY + 1;
  const fillRatio = candidate.pixelCount / (width * height);
  const aspectRatio = height / width;

  if (candidate.pixelCount < MIN_PIXEL_COUNT) {
    return null;
  }

  if (width < MIN_BOX_WIDTH_PX || height < MIN_BOX_HEIGHT_PX) {
    return null;
  }

  if (fillRatio < MIN_FILL_RATIO || fillRatio > MAX_FILL_RATIO) {
    return null;
  }

  if (aspectRatio < MIN_ASPECT_RATIO || aspectRatio > MAX_ASPECT_RATIO) {
    return null;
  }

  const centerX = Math.round(candidate.minX + width / 2);
  const centerY = Math.round(candidate.minY + height / 2);
  const score =
    candidate.pixelCount + height * 6 + width * 2 + fillRatio * 180 - Math.abs(aspectRatio - 2.1) * 35;

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
    score,
  };
}

function sortBoxes(boxes: NpcBox[]): NpcBox[] {
  return boxes.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    if (b.pixelCount !== a.pixelCount) {
      return b.pixelCount - a.pixelCount;
    }

    if (b.height !== a.height) {
      return b.height - a.height;
    }

    return a.x - b.x;
  });
}

export function detectNpcBoxesInScreenshot(bitmap: RobotBitmap): NpcBox[] {
  const mask = buildNpcMask(bitmap);
  const components = collectConnectedComponents(mask, bitmap.width, bitmap.height).filter((component) => component.pixelCount >= 8);
  const mergedComponents = mergeNearbyComponents(components, MERGE_GAP_X_PX, MERGE_GAP_Y_PX);
  return sortBoxes(mergedComponents.map(toNpcBox).filter((box): box is NpcBox => box !== null));
}

export function detectBestNpcBoxInScreenshot(bitmap: RobotBitmap): NpcBox | null {
  return detectNpcBoxesInScreenshot(bitmap)[0] ?? null;
}

export function saveBitmapWithNpcBoxes(bitmap: RobotBitmap, boxes: NpcBox[], filename: string): void {
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
