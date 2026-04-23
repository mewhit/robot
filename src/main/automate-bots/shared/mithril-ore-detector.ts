import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { RobotBitmap } from "./ocr-engine";

export type MithrilOreBox = {
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
  blueDominance: number;
  score: number;
};

export type DetectMithrilOreOptions = {
  tilePxHint?: number | null;
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
const MIN_BOX_WIDTH_PX = 14;
const MIN_BOX_HEIGHT_PX = 14;
const MAX_BOX_WIDTH_PX = 80;
const MAX_BOX_HEIGHT_PX = 80;
const MAX_BOX_WIDTH_RATIO = 0.04;
const MAX_BOX_HEIGHT_RATIO = 0.065;
const MIN_FILL_RATIO = 0.12;
const MAX_FILL_RATIO = 0.72;
const MIN_ASPECT_RATIO = 0.3;
const MAX_ASPECT_RATIO = 3.2;
const MIN_BLUE_DOMINANCE = 24;
const MERGE_GAP_PX = 8;
const SPLIT_TILE_MULTIPLIER = 1.45;
const SPLIT_MIN_CENTER_DISTANCE_TILES = 0.45;
const SPLIT_MIN_REDUCTION_RATIO = 0.88;
const SPLIT_KMEANS_ITERATIONS = 6;

function isMithrilOrePixel(r: number, g: number, b: number): boolean {
  return (
    r <= 96 &&
    g <= 98 &&
    b >= 64 &&
    b <= 145 &&
    Math.abs(r - g) <= 18 &&
    b - r >= 10 &&
    b - g >= 8
  );
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

function buildMithrilOreMask(bitmap: RobotBitmap): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isMithrilOrePixel(r, g, b)) {
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

function getCandidateWidth(candidate: BoxCandidate): number {
  return candidate.maxX - candidate.minX + 1;
}

function getCandidateHeight(candidate: BoxCandidate): number {
  return candidate.maxY - candidate.minY + 1;
}

function estimateTilePxHintFromComponents(components: BoxCandidate[]): number | null {
  const dimensions = components
    .filter((candidate) => candidate.pixelCount >= MIN_PIXEL_COUNT)
    .map((candidate) => Math.max(getCandidateWidth(candidate), getCandidateHeight(candidate)))
    .filter((value) => Number.isFinite(value) && value >= MIN_BOX_WIDTH_PX);

  if (dimensions.length === 0) {
    return null;
  }

  const sorted = dimensions.sort((a, b) => a - b);
  const trimStart = Math.floor(sorted.length * 0.15);
  const trimEnd = Math.max(trimStart + 1, Math.ceil(sorted.length * 0.85));
  const trimmed = sorted.slice(trimStart, trimEnd);
  const median = trimmed[Math.floor(trimmed.length / 2)] ?? sorted[Math.floor(sorted.length / 2)] ?? null;
  return median && Number.isFinite(median) ? median : null;
}

function resolveSplitTilePxHint(runtimeTilePxHint: number | null | undefined, inferredTilePxHint: number | null): number | null {
  const runtimeHint =
    typeof runtimeTilePxHint === "number" && Number.isFinite(runtimeTilePxHint) && runtimeTilePxHint > 0
      ? runtimeTilePxHint
      : null;
  const inferredHint =
    typeof inferredTilePxHint === "number" && Number.isFinite(inferredTilePxHint) && inferredTilePxHint > 0
      ? inferredTilePxHint
      : null;

  if (runtimeHint !== null && inferredHint !== null) {
    return Math.min(runtimeHint, inferredHint);
  }

  return runtimeHint ?? inferredHint;
}

type CandidatePixelCluster = {
  centroidX: number;
  centroidY: number;
  candidate: BoxCandidate;
};

function createEmptyCandidate(): BoxCandidate {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    pixelCount: 0,
    redSum: 0,
    greenSum: 0,
    blueSum: 0,
  };
}

function finalizeCluster(
  candidate: BoxCandidate,
  sumX: number,
  sumY: number,
): CandidatePixelCluster | null {
  if (candidate.pixelCount <= 0) {
    return null;
  }

  return {
    centroidX: sumX / candidate.pixelCount,
    centroidY: sumY / candidate.pixelCount,
    candidate,
  };
}

function collectSplitClusters(
  candidate: BoxCandidate,
  mask: Uint8Array,
  bitmap: RobotBitmap,
  centroidA: { x: number; y: number },
  centroidB: { x: number; y: number },
): [CandidatePixelCluster, CandidatePixelCluster] | null {
  const candidateA = createEmptyCandidate();
  const candidateB = createEmptyCandidate();
  let sumAX = 0;
  let sumAY = 0;
  let sumBX = 0;
  let sumBY = 0;

  for (let y = candidate.minY; y <= candidate.maxY; y += 1) {
    for (let x = candidate.minX; x <= candidate.maxX; x += 1) {
      if (!mask[y * bitmap.width + x]) {
        continue;
      }

      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      const distanceA = (x - centroidA.x) * (x - centroidA.x) + (y - centroidA.y) * (y - centroidA.y);
      const distanceB = (x - centroidB.x) * (x - centroidB.x) + (y - centroidB.y) * (y - centroidB.y);
      const target = distanceA <= distanceB ? candidateA : candidateB;

      target.minX = Math.min(target.minX, x);
      target.minY = Math.min(target.minY, y);
      target.maxX = Math.max(target.maxX, x);
      target.maxY = Math.max(target.maxY, y);
      target.pixelCount += 1;
      target.redSum += r;
      target.greenSum += g;
      target.blueSum += b;

      if (target === candidateA) {
        sumAX += x;
        sumAY += y;
      } else {
        sumBX += x;
        sumBY += y;
      }
    }
  }

  const clusterA = finalizeCluster(candidateA, sumAX, sumAY);
  const clusterB = finalizeCluster(candidateB, sumBX, sumBY);
  if (!clusterA || !clusterB) {
    return null;
  }

  return [clusterA, clusterB];
}

function trySplitCandidateByKMeans(
  candidate: BoxCandidate,
  mask: Uint8Array,
  bitmap: RobotBitmap,
  tilePxHint: number,
): BoxCandidate[] | null {
  const width = getCandidateWidth(candidate);
  const height = getCandidateHeight(candidate);
  const splitThresholdPx = Math.max(Math.round(tilePxHint * SPLIT_TILE_MULTIPLIER), MIN_BOX_WIDTH_PX * 2);
  if (width < splitThresholdPx && height < splitThresholdPx) {
    return null;
  }

  if (candidate.pixelCount < MIN_PIXEL_COUNT * 2) {
    return null;
  }

  const initialPairs: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
  if (width >= splitThresholdPx && height >= splitThresholdPx) {
    initialPairs.push(
      [{ x: candidate.minX, y: candidate.minY }, { x: candidate.maxX, y: candidate.maxY }],
      [{ x: candidate.minX, y: candidate.maxY }, { x: candidate.maxX, y: candidate.minY }],
    );
  } else if (width >= height) {
    initialPairs.push([{ x: candidate.minX, y: (candidate.minY + candidate.maxY) / 2 }, { x: candidate.maxX, y: (candidate.minY + candidate.maxY) / 2 }]);
  } else {
    initialPairs.push([{ x: (candidate.minX + candidate.maxX) / 2, y: candidate.minY }, { x: (candidate.minX + candidate.maxX) / 2, y: candidate.maxY }]);
  }

  const parentMaxDimension = Math.max(width, height);
  const minCenterDistancePx = Math.max(12, Math.round(tilePxHint * SPLIT_MIN_CENTER_DISTANCE_TILES));

  for (const [initialA, initialB] of initialPairs) {
    let centroidA = initialA;
    let centroidB = initialB;
    let clusters: [CandidatePixelCluster, CandidatePixelCluster] | null = null;

    for (let iteration = 0; iteration < SPLIT_KMEANS_ITERATIONS; iteration += 1) {
      clusters = collectSplitClusters(candidate, mask, bitmap, centroidA, centroidB);
      if (!clusters) {
        break;
      }

      centroidA = { x: clusters[0].centroidX, y: clusters[0].centroidY };
      centroidB = { x: clusters[1].centroidX, y: clusters[1].centroidY };
    }

    if (!clusters) {
      continue;
    }

    const candidateA = clusters[0].candidate;
    const candidateB = clusters[1].candidate;
    const boxA = toMithrilOreBox(candidateA, bitmap);
    const boxB = toMithrilOreBox(candidateB, bitmap);
    if (!boxA || !boxB) {
      continue;
    }

    const childMaxDimension = Math.max(boxA.width, boxA.height, boxB.width, boxB.height);
    const centerDistance = Math.max(Math.abs(boxA.centerX - boxB.centerX), Math.abs(boxA.centerY - boxB.centerY));
    if (childMaxDimension >= parentMaxDimension * SPLIT_MIN_REDUCTION_RATIO) {
      continue;
    }

    if (centerDistance < minCenterDistancePx) {
      continue;
    }

    return [candidateA, candidateB];
  }

  return null;
}

function splitOversizedCandidate(
  candidate: BoxCandidate,
  mask: Uint8Array,
  bitmap: RobotBitmap,
  tilePxHint: number | null,
  depth: number = 0,
): BoxCandidate[] {
  if (!tilePxHint || !Number.isFinite(tilePxHint) || depth >= 2) {
    return [candidate];
  }

  const split = trySplitCandidateByKMeans(candidate, mask, bitmap, tilePxHint);
  if (!split) {
    return [candidate];
  }

  return split.flatMap((child) => splitOversizedCandidate(child, mask, bitmap, tilePxHint, depth + 1));
}

function resolveMaxBoxWidth(sourceWidth: number): number {
  return Math.max(MAX_BOX_WIDTH_PX, Math.round(sourceWidth * MAX_BOX_WIDTH_RATIO));
}

function resolveMaxBoxHeight(sourceHeight: number): number {
  return Math.max(MAX_BOX_HEIGHT_PX, Math.round(sourceHeight * MAX_BOX_HEIGHT_RATIO));
}

function toMithrilOreBox(candidate: BoxCandidate, bitmap: RobotBitmap): MithrilOreBox | null {
  const width = candidate.maxX - candidate.minX + 1;
  const height = candidate.maxY - candidate.minY + 1;
  const fillRatio = candidate.pixelCount / (width * height);
  const aspectRatio = width / height;
  const maxBoxWidth = resolveMaxBoxWidth(bitmap.width);
  const maxBoxHeight = resolveMaxBoxHeight(bitmap.height);

  if (candidate.pixelCount < MIN_PIXEL_COUNT) {
    return null;
  }

  if (width < MIN_BOX_WIDTH_PX || width > maxBoxWidth) {
    return null;
  }

  if (height < MIN_BOX_HEIGHT_PX || height > maxBoxHeight) {
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
  const blueDominance = avgBlue - (avgRed + avgGreen) / 2;
  if (blueDominance < MIN_BLUE_DOMINANCE) {
    return null;
  }

  const centerX = Math.round(candidate.minX + width / 2);
  const centerY = Math.round(candidate.minY + height / 2);
  const dx = centerX - bitmap.width / 2;
  const dy = centerY - bitmap.height / 2;
  const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
  const maxDistance = Math.sqrt((bitmap.width / 2) ** 2 + (bitmap.height / 2) ** 2);
  const normalizedDistance = maxDistance > 0 ? distanceFromCenter / maxDistance : 0;
  const score = candidate.pixelCount + fillRatio * 220 + blueDominance * 9 - Math.abs(aspectRatio - 1) * 80 - normalizedDistance * 150;

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
    blueDominance,
    score,
  };
}

function sortBoxes(boxes: MithrilOreBox[]): MithrilOreBox[] {
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

export function detectMithrilOreBoxesInScreenshot(bitmap: RobotBitmap, options: DetectMithrilOreOptions = {}): MithrilOreBox[] {
  const mask = buildMithrilOreMask(bitmap);
  const components = collectConnectedComponents(mask, bitmap).filter((candidate) => candidate.pixelCount >= 8);
  const mergedComponents = mergeNearbyComponents(components, MERGE_GAP_PX);
  const inferredTilePxHint = estimateTilePxHintFromComponents(mergedComponents);
  const resolvedTilePxHint = resolveSplitTilePxHint(options.tilePxHint, inferredTilePxHint);
  const refinedComponents = mergedComponents.flatMap((candidate) =>
    splitOversizedCandidate(candidate, mask, bitmap, resolvedTilePxHint),
  );
  const boxes = refinedComponents.map((candidate) => toMithrilOreBox(candidate, bitmap)).filter((box): box is MithrilOreBox => box !== null);
  return sortBoxes(boxes);
}

export function saveBitmapWithMithrilOreBoxes(
  bitmap: RobotBitmap,
  boxes: MithrilOreBox[],
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
    drawRectangleOnPng(png, box.x, box.y, box.width, box.height, { r: 255, g: 96, b: 0 }, 3);
  }

  if (activeTarget) {
    drawRectangleOnPng(png, activeTarget.x - 8, activeTarget.y - 8, 16, 16, { r: 64, g: 255, b: 255 }, 2);
  }

  if (playerBox) {
    drawRectangleOnPng(png, playerBox.x - 3, playerBox.y - 3, playerBox.width + 6, playerBox.height + 6, { r: 0, g: 0, b: 0 }, 2);
  }

  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(filename));
}
