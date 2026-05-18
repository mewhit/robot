import type { RobotBitmap } from "./ocr-engine";
import { axisDistance, clamp, type CenteredLocalBox, type LocalPoint } from "./osrs-helper";

export type AgilityOutlineColor = "green" | "red";

export type AgilityOutlineDetection = CenteredLocalBox & {
  color: AgilityOutlineColor;
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

const MIN_OUTLINE_PIXELS = 24;
const MIN_OUTLINE_SIZE_PX = 6;
const STATUS_OVERLAY_MAX_X_RATIO = 0.16;
const STATUS_OVERLAY_MIN_Y_RATIO = 0.03;
const STATUS_OVERLAY_MAX_Y_RATIO = 0.24;

function isGreenOutlinePixel(r: number, g: number, b: number): boolean {
  return g >= 155 && r <= 85 && b <= 110 && g - r >= 90 && g - b >= 60;
}

function isRedOutlinePixel(r: number, g: number, b: number): boolean {
  return r >= 170 && g <= 100 && b <= 110 && r - g >= 80 && r - b >= 65;
}

function isOutlinePixel(color: AgilityOutlineColor, r: number, g: number, b: number): boolean {
  switch (color) {
    case "green":
      return isGreenOutlinePixel(r, g, b);
    case "red":
      return isRedOutlinePixel(r, g, b);
  }
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

function detectAgilityOutlinesForColor(
  bitmap: RobotBitmap,
  bounds: SearchBounds,
  color: AgilityOutlineColor,
  options: { excludeStatusOverlay: boolean },
): AgilityOutlineDetection[] {
  const visited = new Uint8Array(bitmap.width * bitmap.height);
  const detections: AgilityOutlineDetection[] = [];
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
      if (!isOutlinePixel(color, r, g, b)) {
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
            if (options.excludeStatusOverlay && isInsideStatusOverlayExclusion(bitmap, nextX, nextY)) {
              continue;
            }

            const nextOffset = nextY * bitmap.byteWidth + nextX * bitmap.bytesPerPixel;
            const nextB = bitmap.image[nextOffset];
            const nextG = bitmap.image[nextOffset + 1];
            const nextR = bitmap.image[nextOffset + 2];
            if (isOutlinePixel(color, nextR, nextG, nextB)) {
              stack.push({ x: nextX, y: nextY });
            }
          }
        }
      }

      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      if (pixelCount < MIN_OUTLINE_PIXELS || width < MIN_OUTLINE_SIZE_PX || height < MIN_OUTLINE_SIZE_PX) {
        continue;
      }

      detections.push({
        color,
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

  return detections;
}

function sortOutlines(outlines: AgilityOutlineDetection[]): AgilityOutlineDetection[] {
  return outlines.sort((a, b) => {
    if (b.pixelCount !== a.pixelCount) {
      return b.pixelCount - a.pixelCount;
    }
    return a.color.localeCompare(b.color);
  });
}

export function detectAgilityOutlines(
  bitmap: RobotBitmap,
  colors: readonly AgilityOutlineColor[] = ["green", "red"],
): AgilityOutlineDetection[] {
  const bounds = resolveSearchBounds(bitmap);
  return sortOutlines(
    colors.flatMap((color) =>
      detectAgilityOutlinesForColor(bitmap, bounds, color, {
        excludeStatusOverlay: true,
      }),
    ),
  );
}

export function detectAgilityOutlinesNearPoint(
  bitmap: RobotBitmap,
  anchor: LocalPoint,
  radiusPx: number,
  colors: readonly AgilityOutlineColor[] = ["green", "red"],
): AgilityOutlineDetection[] {
  const radius = Math.max(1, Math.round(radiusPx));
  const bounds = {
    minX: clamp(Math.round(anchor.x) - radius, 0, bitmap.width - 1),
    minY: clamp(Math.round(anchor.y) - radius, 0, bitmap.height - 1),
    maxX: clamp(Math.round(anchor.x) + radius, 0, bitmap.width - 1),
    maxY: clamp(Math.round(anchor.y) + radius, 0, bitmap.height - 1),
  };

  return sortOutlines(
    colors.flatMap((color) =>
      detectAgilityOutlinesForColor(bitmap, bounds, color, {
        excludeStatusOverlay: false,
      }),
    ),
  );
}

export function pickNearestAgilityOutlineToPoint(
  detections: readonly AgilityOutlineDetection[],
  anchor: LocalPoint,
  maxDistancePx: number,
): AgilityOutlineDetection | null {
  let best: AgilityOutlineDetection | null = null;
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

export function formatAgilityOutline(detection: AgilityOutlineDetection): string {
  return `${detection.color} center=(${detection.centerX},${detection.centerY}) size=${detection.width}x${detection.height} pixels=${detection.pixelCount}`;
}
