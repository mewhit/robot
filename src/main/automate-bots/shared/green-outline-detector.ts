import type { RobotBitmap } from "./ocr-engine";
import { axisDistance, clamp, type CenteredLocalBox, type LocalPoint } from "./osrs-helper";

export type GreenOutlineDetection = CenteredLocalBox & {
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

const MIN_GREEN_OUTLINE_PIXELS = 24;
const MIN_GREEN_OUTLINE_SIZE_PX = 4;
const STATUS_OVERLAY_MAX_X_RATIO = 0.16;
const STATUS_OVERLAY_MIN_Y_RATIO = 0.03;
const STATUS_OVERLAY_MAX_Y_RATIO = 0.24;

function isGreenOutlinePixel(r: number, g: number, b: number): boolean {
  return g >= 145 && r <= 95 && b <= 120 && g - r >= 70 && g - b >= 45;
}

function resolveSearchBounds(bitmap: RobotBitmap): SearchBounds {
  return {
    minX: clamp(Math.round(bitmap.width * 0.02), 0, bitmap.width - 1),
    minY: clamp(Math.round(bitmap.height * 0.04), 0, bitmap.height - 1),
    maxX: clamp(Math.round(bitmap.width * 0.98), 0, bitmap.width - 1),
    maxY: clamp(Math.round(bitmap.height * 0.98), 0, bitmap.height - 1),
  };
}

function isInsideStatusOverlayExclusion(bitmap: RobotBitmap, x: number, y: number): boolean {
  return (
    x <= Math.max(220, Math.round(bitmap.width * STATUS_OVERLAY_MAX_X_RATIO)) &&
    y >= Math.round(bitmap.height * STATUS_OVERLAY_MIN_Y_RATIO) &&
    y <= Math.max(190, Math.round(bitmap.height * STATUS_OVERLAY_MAX_Y_RATIO))
  );
}

function detectGreenOutlinesInBounds(
  bitmap: RobotBitmap,
  bounds: SearchBounds,
  options: { excludeStatusOverlay: boolean },
): GreenOutlineDetection[] {
  const visited = new Uint8Array(bitmap.width * bitmap.height);
  const detections: GreenOutlineDetection[] = [];
  const stack: LocalPoint[] = [];

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const startIndex = y * bitmap.width + x;
      if (visited[startIndex]) {
        continue;
      }

      visited[startIndex] = 1;
      if (options.excludeStatusOverlay && isInsideStatusOverlayExclusion(bitmap, x, y)) {
        continue;
      }

      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isGreenOutlinePixel(r, g, b)) {
        continue;
      }

      stack.length = 0;
      stack.push({ x, y });
      let pixelCount = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
          break;
        }

        pixelCount += 1;
        sumX += current.x;
        sumY += current.y;
        minX = Math.min(minX, current.x);
        minY = Math.min(minY, current.y);
        maxX = Math.max(maxX, current.x);
        maxY = Math.max(maxY, current.y);

        const neighbors = [
          { x: current.x - 1, y: current.y },
          { x: current.x + 1, y: current.y },
          { x: current.x, y: current.y - 1 },
          { x: current.x, y: current.y + 1 },
        ];

        for (const neighbor of neighbors) {
          if (
            neighbor.x < bounds.minX ||
            neighbor.y < bounds.minY ||
            neighbor.x > bounds.maxX ||
            neighbor.y > bounds.maxY
          ) {
            continue;
          }

          const nextIndex = neighbor.y * bitmap.width + neighbor.x;
          if (visited[nextIndex]) {
            continue;
          }

          visited[nextIndex] = 1;
          if (options.excludeStatusOverlay && isInsideStatusOverlayExclusion(bitmap, neighbor.x, neighbor.y)) {
            continue;
          }

          const nextOffset = neighbor.y * bitmap.byteWidth + neighbor.x * bitmap.bytesPerPixel;
          const nextB = bitmap.image[nextOffset];
          const nextG = bitmap.image[nextOffset + 1];
          const nextR = bitmap.image[nextOffset + 2];
          if (isGreenOutlinePixel(nextR, nextG, nextB)) {
            stack.push(neighbor);
          }
        }
      }

      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      if (
        pixelCount < MIN_GREEN_OUTLINE_PIXELS ||
        width < MIN_GREEN_OUTLINE_SIZE_PX ||
        height < MIN_GREEN_OUTLINE_SIZE_PX
      ) {
        continue;
      }

      detections.push({
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
      });
    }
  }

  return detections.sort((a, b) => b.pixelCount - a.pixelCount);
}

export function detectGreenOutlines(bitmap: RobotBitmap): GreenOutlineDetection[] {
  return detectGreenOutlinesInBounds(bitmap, resolveSearchBounds(bitmap), {
    excludeStatusOverlay: true,
  });
}

export function detectGreenOutlinesNearPoint(
  bitmap: RobotBitmap,
  anchor: LocalPoint,
  radiusPx: number,
): GreenOutlineDetection[] {
  const radius = Math.max(1, Math.round(radiusPx));
  return detectGreenOutlinesInBounds(
    bitmap,
    {
      minX: clamp(Math.round(anchor.x) - radius, 0, bitmap.width - 1),
      minY: clamp(Math.round(anchor.y) - radius, 0, bitmap.height - 1),
      maxX: clamp(Math.round(anchor.x) + radius, 0, bitmap.width - 1),
      maxY: clamp(Math.round(anchor.y) + radius, 0, bitmap.height - 1),
    },
    {
      excludeStatusOverlay: false,
    },
  );
}

export function pickNearestGreenOutlineToPoint(
  detections: readonly GreenOutlineDetection[],
  anchor: LocalPoint,
  maxDistancePx: number,
): GreenOutlineDetection | null {
  let best: GreenOutlineDetection | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestPixelCount = Number.NEGATIVE_INFINITY;

  for (const detection of detections) {
    const distance = axisDistance(detection.centerX - anchor.x, detection.centerY - anchor.y);
    if (distance > maxDistancePx) {
      continue;
    }

    if (distance < bestDistance || (distance === bestDistance && detection.pixelCount > bestPixelCount)) {
      best = detection;
      bestDistance = distance;
      bestPixelCount = detection.pixelCount;
    }
  }

  return best;
}

export function formatGreenOutline(detection: GreenOutlineDetection): string {
  return `green center=(${detection.centerX},${detection.centerY}) size=${detection.width}x${detection.height} pixels=${detection.pixelCount}`;
}
