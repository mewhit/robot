import type { RobotBitmap } from "./ocr-engine";
import { axisDistance, clamp, type CenteredLocalBox, type LocalPoint } from "./osrs-helper";

export type BlueOutlineTier = "trail" | "step-12";

export type BlueOutlineDetection = CenteredLocalBox & {
  tier: BlueOutlineTier;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
  averageR: number;
  averageG: number;
  averageB: number;
  luminance: number;
};

type SearchBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const MIN_BLUE_OUTLINE_PIXELS = 30;
const MIN_BLUE_OUTLINE_WIDTH_PX = 4;
const MIN_BLUE_OUTLINE_HEIGHT_PX = 4;
const PURE_BLUE_TOLERANCE = 36;
const ROYAL_BLUE_TOLERANCE = 34;

function colorDistanceSquared(r: number, g: number, b: number, target: { r: number; g: number; b: number }): number {
  const dr = r - target.r;
  const dg = g - target.g;
  const db = b - target.b;
  return dr * dr + dg * dg + db * db;
}

function classifyBlueTier(r: number, g: number, b: number): BlueOutlineTier | null {
  if (r <= 70 && g <= 80 && b >= 170 && b - Math.max(r, g) >= 100) {
    const pureDistance = colorDistanceSquared(r, g, b, { r: 0, g: 0, b: 255 });
    if (pureDistance <= PURE_BLUE_TOLERANCE * PURE_BLUE_TOLERANCE) {
      return "trail";
    }
  }

  const royalDistance = colorDistanceSquared(r, g, b, { r: 65, g: 105, b: 225 });
  return royalDistance <= ROYAL_BLUE_TOLERANCE * ROYAL_BLUE_TOLERANCE ? "step-12" : null;
}

function resolveSearchBounds(bitmap: RobotBitmap): SearchBounds {
  return {
    minX: clamp(Math.round(bitmap.width * 0.02), 0, bitmap.width - 1),
    minY: clamp(Math.round(bitmap.height * 0.04), 0, bitmap.height - 1),
    maxX: clamp(Math.round(bitmap.width * 0.78), 0, bitmap.width - 1),
    maxY: clamp(Math.round(bitmap.height * 0.9), 0, bitmap.height - 1),
  };
}

export function detectBlueOutlines(bitmap: RobotBitmap): BlueOutlineDetection[] {
  const bounds = resolveSearchBounds(bitmap);
  const visited = new Uint8Array(bitmap.width * bitmap.height);
  const detections: BlueOutlineDetection[] = [];

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const startIndex = y * bitmap.width + x;
      if (visited[startIndex]) {
        continue;
      }

      visited[startIndex] = 1;
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      const tier = classifyBlueTier(r, g, b);
      if (!tier) {
        continue;
      }

      const stack = [{ x, y }];
      let pixelCount = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;

      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
          break;
        }

        const currentOffset = current.y * bitmap.byteWidth + current.x * bitmap.bytesPerPixel;
        const currentB = bitmap.image[currentOffset];
        const currentG = bitmap.image[currentOffset + 1];
        const currentR = bitmap.image[currentOffset + 2];
        pixelCount += 1;
        sumX += current.x;
        sumY += current.y;
        sumR += currentR;
        sumG += currentG;
        sumB += currentB;
        minX = Math.min(minX, current.x);
        minY = Math.min(minY, current.y);
        maxX = Math.max(maxX, current.x);
        maxY = Math.max(maxY, current.y);

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }

            const nextX = current.x + dx;
            const nextY = current.y + dy;
            if (nextX < bounds.minX || nextY < bounds.minY || nextX > bounds.maxX || nextY > bounds.maxY) {
              continue;
            }

            const nextIndex = nextY * bitmap.width + nextX;
            if (visited[nextIndex]) {
              continue;
            }

            visited[nextIndex] = 1;
            const nextOffset = nextY * bitmap.byteWidth + nextX * bitmap.bytesPerPixel;
            const nextB = bitmap.image[nextOffset];
            const nextG = bitmap.image[nextOffset + 1];
            const nextR = bitmap.image[nextOffset + 2];
            if (classifyBlueTier(nextR, nextG, nextB) === tier) {
              stack.push({ x: nextX, y: nextY });
            }
          }
        }
      }

      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      if (
        pixelCount < MIN_BLUE_OUTLINE_PIXELS ||
        width < MIN_BLUE_OUTLINE_WIDTH_PX ||
        height < MIN_BLUE_OUTLINE_HEIGHT_PX
      ) {
        continue;
      }

      const averageR = sumR / pixelCount;
      const averageG = sumG / pixelCount;
      const averageB = sumB / pixelCount;
      detections.push({
        tier,
        x: minX,
        y: minY,
        width,
        height,
        centerX: Math.round(sumX / pixelCount),
        centerY: Math.round(sumY / pixelCount),
        minX,
        minY,
        maxX,
        maxY,
        pixelCount,
        averageR,
        averageG,
        averageB,
        luminance: 0.2126 * averageR + 0.7152 * averageG + 0.0722 * averageB,
      });
    }
  }

  return detections.sort((a, b) => b.pixelCount - a.pixelCount);
}

export function pickFarthestBlueOutlineFromAnchor(
  detections: readonly BlueOutlineDetection[],
  anchor: LocalPoint,
): BlueOutlineDetection | null {
  let best: BlueOutlineDetection | null = null;
  let bestDistance = Number.NEGATIVE_INFINITY;
  let bestPixelCount = Number.NEGATIVE_INFINITY;

  for (const detection of detections) {
    const distance = axisDistance(detection.centerX - anchor.x, detection.centerY - anchor.y);
    if (distance > bestDistance || (distance === bestDistance && detection.pixelCount > bestPixelCount)) {
      best = detection;
      bestDistance = distance;
      bestPixelCount = detection.pixelCount;
    }
  }

  return best;
}
