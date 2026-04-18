import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { RobotBitmap } from "./ocr-engine";

export type MotherlodeMineBox = {
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
  greenDominance: number;
  score: number;
  color: "green" | "yellow";
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

const MIN_PIXEL_COUNT = 220;
const MIN_BOX_WIDTH_PX = 24;
const MIN_BOX_HEIGHT_PX = 24;
const MAX_BOX_WIDTH_PX = 76;
const MAX_BOX_HEIGHT_PX = 76;
const MIN_FILL_RATIO = 0.3;
const MAX_FILL_RATIO = 0.92;
const MIN_ASPECT_RATIO = 0.68;
const MAX_ASPECT_RATIO = 1.45;
const MIN_AVG_GREEN = 145;
const MIN_GREEN_DOMINANCE = 105;
const GREEN_RING_MIN_PIXEL_COUNT = 140;
const GREEN_RING_MIN_SIDE_PX = 30;
const GREEN_RING_MAX_SIDE_PX = 40;
const GREEN_RING_MIN_FILL_RATIO = 0.12;
const GREEN_RING_MAX_FILL_RATIO = 0.38;
const GREEN_RING_MIN_ASPECT_RATIO = 0.85;
const GREEN_RING_MAX_ASPECT_RATIO = 1.2;
const GREEN_RING_MIN_AVG_GREEN = 150;
const GREEN_RING_MIN_GREEN_DOMINANCE = 88;
const MIN_AVG_YELLOW_RED = 165;
const MIN_YELLOW_RED_DOMINANCE = 60;
const YELLOW_RING_MIN_PIXEL_COUNT = 130;
const YELLOW_RING_MIN_SIDE_PX = 22;
const YELLOW_RING_MAX_SIDE_PX = 44;
const YELLOW_RING_MIN_FILL_RATIO = 0.1;
const YELLOW_RING_MAX_FILL_RATIO = 0.62;
const YELLOW_RING_MIN_ASPECT_RATIO = 0.7;
const YELLOW_RING_MAX_ASPECT_RATIO = 1.45;
const YELLOW_RING_MIN_AVG_RED = 160;
const YELLOW_RING_MIN_RED_DOMINANCE = 60;
const COMPONENT_MERGE_GAP_PX = 5;
const COMPONENT_MIN_OVERLAP_RATIO = 0.8;
const MAX_MERGED_COMPONENT_WIDTH_PX = MAX_BOX_WIDTH_PX + 8;
const MAX_MERGED_COMPONENT_HEIGHT_PX = MAX_BOX_HEIGHT_PX + 8;

function isMotherlodeGreenPixel(r: number, g: number, b: number): boolean {
  return g >= 132 && g - r >= 55 && g - b >= 28 && r <= 190 && b <= 190;
}

function isMotherlodeYellowPixel(r: number, g: number, b: number): boolean {
  return r >= 155 && g >= 105 && b <= 105 && r + g >= 285 && r - b >= 85 && g - b >= 35;
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

function buildMotherlodeMask(
  bitmap: RobotBitmap,
  pixelDetector: (r: number, g: number, b: number) => boolean,
): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!pixelDetector(r, g, b)) {
        continue;
      }

      mask[y * bitmap.width + x] = 1;
    }
  }

  return mask;
}

function buildMotherlodeGreenMask(bitmap: RobotBitmap): Uint8Array {
  return buildMotherlodeMask(bitmap, isMotherlodeGreenPixel);
}

function buildMotherlodeYellowMask(bitmap: RobotBitmap): Uint8Array {
  return buildMotherlodeMask(bitmap, isMotherlodeYellowPixel);
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

function axisGap(minA: number, maxA: number, minB: number, maxB: number): number {
  if (maxA < minB) {
    return minB - maxA - 1;
  }

  if (maxB < minA) {
    return minA - maxB - 1;
  }

  return 0;
}

function axisOverlap(minA: number, maxA: number, minB: number, maxB: number): number {
  return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB) + 1);
}

function axisOverlapRatio(minA: number, maxA: number, minB: number, maxB: number): number {
  const overlap = axisOverlap(minA, maxA, minB, maxB);
  if (overlap <= 0) {
    return 0;
  }

  const lengthA = maxA - minA + 1;
  const lengthB = maxB - minB + 1;
  return overlap / Math.min(lengthA, lengthB);
}

function mergeComponent(a: BoxCandidate, b: BoxCandidate): BoxCandidate {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    pixelCount: a.pixelCount + b.pixelCount,
    redSum: a.redSum + b.redSum,
    greenSum: a.greenSum + b.greenSum,
    blueSum: a.blueSum + b.blueSum,
  };
}

function shouldMergeComponents(a: BoxCandidate, b: BoxCandidate): boolean {
  const gapX = axisGap(a.minX, a.maxX, b.minX, b.maxX);
  const gapY = axisGap(a.minY, a.maxY, b.minY, b.maxY);
  if (gapX > COMPONENT_MERGE_GAP_PX || gapY > COMPONENT_MERGE_GAP_PX) {
    return false;
  }

  const overlapXRatio = axisOverlapRatio(a.minX, a.maxX, b.minX, b.maxX);
  const overlapYRatio = axisOverlapRatio(a.minY, a.maxY, b.minY, b.maxY);
  if (overlapXRatio < COMPONENT_MIN_OVERLAP_RATIO && overlapYRatio < COMPONENT_MIN_OVERLAP_RATIO) {
    return false;
  }

  const mergedWidth = Math.max(a.maxX, b.maxX) - Math.min(a.minX, b.minX) + 1;
  const mergedHeight = Math.max(a.maxY, b.maxY) - Math.min(a.minY, b.minY) + 1;

  return mergedWidth <= MAX_MERGED_COMPONENT_WIDTH_PX && mergedHeight <= MAX_MERGED_COMPONENT_HEIGHT_PX;
}

function mergeNearbyComponents(components: BoxCandidate[]): BoxCandidate[] {
  if (components.length < 2) {
    return components;
  }

  const merged = components.slice();

  let didMerge = true;
  while (didMerge) {
    didMerge = false;

    for (let i = 0; i < merged.length; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        if (!shouldMergeComponents(merged[i], merged[j])) {
          continue;
        }

        merged[i] = mergeComponent(merged[i], merged[j]);
        merged.splice(j, 1);
        didMerge = true;
        break;
      }

      if (didMerge) {
        break;
      }
    }
  }

  return merged;
}

function toMotherlodeMineBox(
  candidate: BoxCandidate,
  sourceWidth: number,
  sourceHeight: number,
  color: "green" | "yellow",
): MotherlodeMineBox | null {
  const width = candidate.maxX - candidate.minX + 1;
  const height = candidate.maxY - candidate.minY + 1;
  const fillRatio = candidate.pixelCount / (width * height);
  const aspectRatio = width / height;

  const avgRed = candidate.redSum / candidate.pixelCount;
  const avgGreen = candidate.greenSum / candidate.pixelCount;
  const avgBlue = candidate.blueSum / candidate.pixelCount;
  const greenDominance = avgGreen - (avgRed + avgBlue) / 2;

  // Validation depends on color type
  if (color === "green") {
    const denseGreenGeometryOk =
      candidate.pixelCount >= MIN_PIXEL_COUNT &&
      width >= MIN_BOX_WIDTH_PX &&
      height >= MIN_BOX_HEIGHT_PX &&
      width <= MAX_BOX_WIDTH_PX &&
      height <= MAX_BOX_HEIGHT_PX &&
      fillRatio >= MIN_FILL_RATIO &&
      fillRatio <= MAX_FILL_RATIO &&
      aspectRatio >= MIN_ASPECT_RATIO &&
      aspectRatio <= MAX_ASPECT_RATIO;

    const ringGreenGeometryOk =
      candidate.pixelCount >= GREEN_RING_MIN_PIXEL_COUNT &&
      width >= GREEN_RING_MIN_SIDE_PX &&
      height >= GREEN_RING_MIN_SIDE_PX &&
      width <= GREEN_RING_MAX_SIDE_PX &&
      height <= GREEN_RING_MAX_SIDE_PX &&
      fillRatio >= GREEN_RING_MIN_FILL_RATIO &&
      fillRatio <= GREEN_RING_MAX_FILL_RATIO &&
      aspectRatio >= GREEN_RING_MIN_ASPECT_RATIO &&
      aspectRatio <= GREEN_RING_MAX_ASPECT_RATIO;

    const denseGreenSignalOk = avgGreen >= MIN_AVG_GREEN && greenDominance >= MIN_GREEN_DOMINANCE;
    const ringGreenSignalOk = avgGreen >= GREEN_RING_MIN_AVG_GREEN && greenDominance >= GREEN_RING_MIN_GREEN_DOMINANCE;

    if (!(denseGreenGeometryOk && denseGreenSignalOk) && !(ringGreenGeometryOk && ringGreenSignalOk)) {
      return null;
    }
  } else if (color === "yellow") {
    const redDominance = avgRed - (avgGreen + avgBlue) / 2;

    const denseYellowGeometryOk =
      candidate.pixelCount >= MIN_PIXEL_COUNT &&
      width >= MIN_BOX_WIDTH_PX &&
      height >= MIN_BOX_HEIGHT_PX &&
      width <= MAX_BOX_WIDTH_PX &&
      height <= MAX_BOX_HEIGHT_PX &&
      fillRatio >= MIN_FILL_RATIO &&
      fillRatio <= MAX_FILL_RATIO &&
      aspectRatio >= MIN_ASPECT_RATIO &&
      aspectRatio <= MAX_ASPECT_RATIO;

    const ringYellowGeometryOk =
      candidate.pixelCount >= YELLOW_RING_MIN_PIXEL_COUNT &&
      width >= YELLOW_RING_MIN_SIDE_PX &&
      height >= YELLOW_RING_MIN_SIDE_PX &&
      width <= YELLOW_RING_MAX_SIDE_PX &&
      height <= YELLOW_RING_MAX_SIDE_PX &&
      fillRatio >= YELLOW_RING_MIN_FILL_RATIO &&
      fillRatio <= YELLOW_RING_MAX_FILL_RATIO &&
      aspectRatio >= YELLOW_RING_MIN_ASPECT_RATIO &&
      aspectRatio <= YELLOW_RING_MAX_ASPECT_RATIO;

    const denseYellowSignalOk = avgRed >= MIN_AVG_YELLOW_RED && redDominance >= MIN_YELLOW_RED_DOMINANCE;
    const ringYellowSignalOk = avgRed >= YELLOW_RING_MIN_AVG_RED && redDominance >= YELLOW_RING_MIN_RED_DOMINANCE;

    if (!(denseYellowGeometryOk && denseYellowSignalOk) && !(ringYellowGeometryOk && ringYellowSignalOk)) {
      return null;
    }
  }

  const centerX = Math.round(candidate.minX + width / 2);
  const centerY = Math.round(candidate.minY + height / 2);
  const dx = centerX - sourceWidth / 2;
  const dy = centerY - sourceHeight / 2;
  const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
  const maxDistance = Math.sqrt((sourceWidth / 2) ** 2 + (sourceHeight / 2) ** 2);
  const normalizedDistance = maxDistance > 0 ? distanceFromCenter / maxDistance : 0;

  const dominance = color === "green" ? greenDominance : avgRed - (avgGreen + avgBlue) / 2;
  const score =
    candidate.pixelCount + fillRatio * 350 + dominance * 9 - Math.abs(aspectRatio - 1) * 140 - normalizedDistance * 170;

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
    greenDominance,
    score,
    color,
  };
}

function sortBoxes(boxes: MotherlodeMineBox[]): MotherlodeMineBox[] {
  return boxes.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    if (b.pixelCount !== a.pixelCount) {
      return b.pixelCount - a.pixelCount;
    }

    if (b.fillRatio !== a.fillRatio) {
      return b.fillRatio - a.fillRatio;
    }

    return a.x - b.x;
  });
}

export function detectMotherlodeMineBoxesInScreenshot(bitmap: RobotBitmap): MotherlodeMineBox[] {
  // Detect green nodes
  const greenMask = buildMotherlodeGreenMask(bitmap);
  const greenComponents = mergeNearbyComponents(
    collectConnectedComponents(greenMask, bitmap).filter((candidate) => candidate.pixelCount >= 8),
  );
  const greenBoxes = greenComponents
    .map((candidate) => toMotherlodeMineBox(candidate, bitmap.width, bitmap.height, "green"))
    .filter((box): box is MotherlodeMineBox => box !== null);

  // Detect yellow nodes
  const yellowMask = buildMotherlodeYellowMask(bitmap);
  const yellowComponents = mergeNearbyComponents(
    collectConnectedComponents(yellowMask, bitmap).filter((candidate) => candidate.pixelCount >= 8),
  );
  const yellowBoxes = yellowComponents
    .map((candidate) => toMotherlodeMineBox(candidate, bitmap.width, bitmap.height, "yellow"))
    .filter((box): box is MotherlodeMineBox => box !== null);

  // Combine and sort all boxes
  const allBoxes = [...greenBoxes, ...yellowBoxes];
  return sortBoxes(allBoxes);
}

export function detectBestMotherlodeMineBoxInScreenshot(bitmap: RobotBitmap): MotherlodeMineBox | null {
  return detectMotherlodeMineBoxesInScreenshot(bitmap)[0] ?? null;
}

export function detectBestGreenMotherlodeMineBoxInScreenshot(bitmap: RobotBitmap): MotherlodeMineBox | null {
  const mask = buildMotherlodeGreenMask(bitmap);
  const components = mergeNearbyComponents(
    collectConnectedComponents(mask, bitmap).filter((candidate) => candidate.pixelCount >= 8),
  );
  const boxes = components
    .map((candidate) => toMotherlodeMineBox(candidate, bitmap.width, bitmap.height, "green"))
    .filter((box): box is MotherlodeMineBox => box !== null);

  return sortBoxes(boxes)[0] ?? null;
}

export function detectBestYellowMotherlodeMineBoxInScreenshot(bitmap: RobotBitmap): MotherlodeMineBox | null {
  const mask = buildMotherlodeYellowMask(bitmap);
  const components = mergeNearbyComponents(
    collectConnectedComponents(mask, bitmap).filter((candidate) => candidate.pixelCount >= 8),
  );
  const boxes = components
    .map((candidate) => toMotherlodeMineBox(candidate, bitmap.width, bitmap.height, "yellow"))
    .filter((box): box is MotherlodeMineBox => box !== null);

  return sortBoxes(boxes)[0] ?? null;
}

export function saveBitmapWithMotherlodeMineBoxes(
  bitmap: RobotBitmap,
  boxes: MotherlodeMineBox[],
  filename: string,
  activeTarget?: { x: number; y: number } | null,
  playerBox?: { x: number; y: number; width: number; height: number } | null,
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
    drawRectangleOnPng(png, box.x, box.y, box.width, box.height, { r: 255, g: 64, b: 64 }, 3);
  }

  if (activeTarget) {
    const markerSize = 16;
    const markerHalf = Math.floor(markerSize / 2);
    drawRectangleOnPng(
      png,
      activeTarget.x - markerHalf,
      activeTarget.y - markerHalf,
      markerSize,
      markerSize,
      { r: 64, g: 220, b: 255 },
      2,
    );
  }

  if (playerBox) {
    // Expand the player box slightly so the outline remains visible even when the raw marker is thin.
    const padding = 3;
    drawRectangleOnPng(
      png,
      playerBox.x - padding,
      playerBox.y - padding,
      playerBox.width + padding * 2,
      playerBox.height + padding * 2,
      { r: 0, g: 0, b: 0 },
      2,
    );
  }

  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(filename));
}
