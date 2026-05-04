import type { RobotBitmap } from "./ocr-engine";

export type CompassNorthDetection = {
  centerX: number;
  centerY: number;
  redCenterX: number;
  redCenterY: number;
  northVectorX: number;
  northVectorY: number;
  pixelCount: number;
  confidence: number;
};

type Component = {
  pixelCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
};

const COMPASS_CENTER_OFFSET_X_LOGICAL = 210;
const COMPASS_CENTER_Y_LOGICAL = 49;
const COMPASS_RADIUS_LOGICAL = 28;
const COMPASS_RED_MIN_PIXELS = 8;
const COMPASS_MIN_VECTOR_DISTANCE_LOGICAL = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isCompassNorthRedPixel(r: number, g: number, b: number): boolean {
  return r >= 115 && g <= 95 && b <= 95 && r - Math.max(g, b) >= 35;
}

function getScale(windowsScalePercent: number): number {
  const scale = windowsScalePercent / 100;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function getPixelRgb(bitmap: RobotBitmap, x: number, y: number): { r: number; g: number; b: number } {
  const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
  return {
    b: bitmap.image[offset],
    g: bitmap.image[offset + 1],
    r: bitmap.image[offset + 2],
  };
}

export function detectCompassNorthDirection(
  bitmap: RobotBitmap,
  windowsScalePercent: number,
): CompassNorthDetection | null {
  const scale = getScale(windowsScalePercent);
  const centerX = bitmap.width - Math.round(COMPASS_CENTER_OFFSET_X_LOGICAL * scale);
  const centerY = Math.round(COMPASS_CENTER_Y_LOGICAL * scale);
  const radius = Math.round(COMPASS_RADIUS_LOGICAL * scale);

  if (
    centerX < 0 ||
    centerY < 0 ||
    centerX >= bitmap.width ||
    centerY >= bitmap.height ||
    radius <= 0
  ) {
    return null;
  }

  const minX = clamp(centerX - radius, 0, bitmap.width - 1);
  const minY = clamp(centerY - radius, 0, bitmap.height - 1);
  const maxX = clamp(centerX + radius, 0, bitmap.width - 1);
  const maxY = clamp(centerY + radius, 0, bitmap.height - 1);
  const radiusSquared = radius * radius;
  const visited = new Uint8Array(bitmap.width * bitmap.height);
  const components: Component[] = [];

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const index = y * bitmap.width + x;
      if (visited[index]) {
        continue;
      }

      visited[index] = 1;
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy > radiusSquared) {
        continue;
      }

      const { r, g, b } = getPixelRgb(bitmap, x, y);
      if (!isCompassNorthRedPixel(r, g, b)) {
        continue;
      }

      const stack = [{ x, y }];
      const component: Component = {
        pixelCount: 0,
        minX: x,
        minY: y,
        maxX: x,
        maxY: y,
        sumX: 0,
        sumY: 0,
      };

      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
          break;
        }

        component.pixelCount += 1;
        component.minX = Math.min(component.minX, current.x);
        component.minY = Math.min(component.minY, current.y);
        component.maxX = Math.max(component.maxX, current.x);
        component.maxY = Math.max(component.maxY, current.y);
        component.sumX += current.x;
        component.sumY += current.y;

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) {
              continue;
            }

            const nextX = current.x + offsetX;
            const nextY = current.y + offsetY;
            if (nextX < minX || nextX > maxX || nextY < minY || nextY > maxY) {
              continue;
            }

            const nextIndex = nextY * bitmap.width + nextX;
            if (visited[nextIndex]) {
              continue;
            }

            visited[nextIndex] = 1;
            const nextDx = nextX - centerX;
            const nextDy = nextY - centerY;
            if (nextDx * nextDx + nextDy * nextDy > radiusSquared) {
              continue;
            }

            const nextRgb = getPixelRgb(bitmap, nextX, nextY);
            if (isCompassNorthRedPixel(nextRgb.r, nextRgb.g, nextRgb.b)) {
              stack.push({ x: nextX, y: nextY });
            }
          }
        }
      }

      components.push(component);
    }
  }

  const minPixels = Math.max(COMPASS_RED_MIN_PIXELS, Math.round(COMPASS_RED_MIN_PIXELS * scale * scale));
  const best = components
    .filter((component) => component.pixelCount >= minPixels)
    .sort((a, b) => b.pixelCount - a.pixelCount)[0];

  if (!best) {
    return null;
  }

  const redCenterX = best.sumX / best.pixelCount;
  const redCenterY = best.sumY / best.pixelCount;
  const vectorX = redCenterX - centerX;
  const vectorY = redCenterY - centerY;
  const vectorDistance = Math.sqrt(vectorX * vectorX + vectorY * vectorY);
  const minVectorDistance = COMPASS_MIN_VECTOR_DISTANCE_LOGICAL * scale;
  if (!Number.isFinite(vectorDistance) || vectorDistance < minVectorDistance) {
    return null;
  }

  return {
    centerX,
    centerY,
    redCenterX,
    redCenterY,
    northVectorX: vectorX / vectorDistance,
    northVectorY: vectorY / vectorDistance,
    pixelCount: best.pixelCount,
    confidence: Math.min(1, (best.pixelCount / Math.max(1, 28 * scale * scale)) * Math.min(1, vectorDistance / (6 * scale))),
  };
}
