import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import type { RobotBitmap } from "./ocr-engine";

export type GuardianOfTheRiftAltarDetection = {
  centerX: number;
  centerY: number;
  pixelCount: number;
  markerColor: "yellow";
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type SearchBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const ALTAR_YELLOW_MIN_PIXELS = 3_000;
const ALTAR_SEARCH_BOUNDS = { minXRatio: 0.04, minYRatio: 0.03, maxXRatio: 0.94, maxYRatio: 0.86 };
const ALTAR_MIN_SIZE_TO_SCREEN_HEIGHT_RATIO = 0.05;
const ALTAR_MAX_SIZE_TO_SCREEN_HEIGHT_RATIO = 0.11;
const ALTAR_MAX_ASPECT_RATIO = 1.35;
const ALTAR_MIN_FILL_RATIO = 0.65;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isAltarYellowMarkerPixel(r: number, g: number, b: number): boolean {
  const redGreenDelta = r - g;
  return r >= 245 && g >= 200 && b <= 45 && redGreenDelta >= -5 && redGreenDelta <= 70;
}

function resolveAltarSearchBounds(bitmap: RobotBitmap): SearchBounds {
  return {
    minX: clamp(Math.round(bitmap.width * ALTAR_SEARCH_BOUNDS.minXRatio), 0, bitmap.width - 1),
    minY: clamp(Math.round(bitmap.height * ALTAR_SEARCH_BOUNDS.minYRatio), 0, bitmap.height - 1),
    maxX: clamp(Math.round(bitmap.width * ALTAR_SEARCH_BOUNDS.maxXRatio), 0, bitmap.width - 1),
    maxY: clamp(Math.round(bitmap.height * ALTAR_SEARCH_BOUNDS.maxYRatio), 0, bitmap.height - 1),
  };
}

function isAltarSizedComponent(bitmap: RobotBitmap, width: number, height: number, fillRatio: number): boolean {
  const minSize = bitmap.height * ALTAR_MIN_SIZE_TO_SCREEN_HEIGHT_RATIO;
  const maxSize = bitmap.height * ALTAR_MAX_SIZE_TO_SCREEN_HEIGHT_RATIO;
  const aspectRatio = Math.max(width / height, height / width);

  return (
    width >= minSize &&
    height >= minSize &&
    width <= maxSize &&
    height <= maxSize &&
    fillRatio >= ALTAR_MIN_FILL_RATIO &&
    aspectRatio <= ALTAR_MAX_ASPECT_RATIO
  );
}

export function detectGuardianOfTheRiftAltarMarkersInScreenshot(
  bitmap: RobotBitmap,
  minPixels: number = ALTAR_YELLOW_MIN_PIXELS,
): GuardianOfTheRiftAltarDetection[] {
  const width = bitmap.width;
  const height = bitmap.height;
  const bounds = resolveAltarSearchBounds(bitmap);
  const visited = new Uint8Array(width * height);
  const detections: GuardianOfTheRiftAltarDetection[] = [];

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const startIndex = y * width + x;
      if (visited[startIndex]) {
        continue;
      }

      visited[startIndex] = 1;
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (!isAltarYellowMarkerPixel(r, g, b)) {
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

            const nextIndex = nextY * width + nextX;
            if (visited[nextIndex]) {
              continue;
            }

            visited[nextIndex] = 1;
            const nextOffset = nextY * bitmap.byteWidth + nextX * bitmap.bytesPerPixel;
            const nextB = bitmap.image[nextOffset];
            const nextG = bitmap.image[nextOffset + 1];
            const nextR = bitmap.image[nextOffset + 2];
            if (isAltarYellowMarkerPixel(nextR, nextG, nextB)) {
              stack.push({ x: nextX, y: nextY });
            }
          }
        }
      }

      if (pixelCount < minPixels) {
        continue;
      }

      const componentWidth = maxX - minX + 1;
      const componentHeight = maxY - minY + 1;
      const fillRatio = pixelCount / (componentWidth * componentHeight);
      if (
        componentWidth < 4 ||
        componentHeight < 4 ||
        !isAltarSizedComponent(bitmap, componentWidth, componentHeight, fillRatio)
      ) {
        continue;
      }

      detections.push({
        centerX: Math.round(sumX / pixelCount),
        centerY: Math.round(sumY / pixelCount),
        pixelCount,
        markerColor: "yellow",
        width: componentWidth,
        height: componentHeight,
        minX,
        minY,
        maxX,
        maxY,
      });
    }
  }

  return detections.sort((a, b) => b.pixelCount - a.pixelCount);
}

export function pickNearestGuardianOfTheRiftAltarMarker(
  detections: GuardianOfTheRiftAltarDetection[],
  playerAnchor: { centerX: number; centerY: number },
): GuardianOfTheRiftAltarDetection | null {
  let best: GuardianOfTheRiftAltarDetection | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const detection of detections) {
    const nearestX = clamp(playerAnchor.centerX, detection.minX, detection.maxX);
    const nearestY = clamp(playerAnchor.centerY, detection.minY, detection.maxY);
    const edgeDistance = Math.sqrt((playerAnchor.centerX - nearestX) ** 2 + (playerAnchor.centerY - nearestY) ** 2);
    const centerDistance = Math.sqrt((playerAnchor.centerX - detection.centerX) ** 2 + (playerAnchor.centerY - detection.centerY) ** 2);
    const scoreDistance = edgeDistance + centerDistance * 0.001;

    if (scoreDistance < bestDistance) {
      best = detection;
      bestDistance = scoreDistance;
    }
  }

  return best;
}

export function formatGuardianOfTheRiftAltarCandidates(
  detections: GuardianOfTheRiftAltarDetection[],
  limit = 5,
): string {
  if (detections.length === 0) {
    return "none";
  }

  return detections
    .slice(0, limit)
    .map((detection) => `(${detection.centerX},${detection.centerY}) ${detection.markerColor} ${detection.width}x${detection.height} px=${detection.pixelCount}`)
    .join("; ");
}

function toPng(bitmap: RobotBitmap): PNG {
  const png = new PNG({ width: bitmap.width, height: bitmap.height });

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const idx = (y * bitmap.width + x) * 4;
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      png.data[idx] = bitmap.image[offset + 2];
      png.data[idx + 1] = bitmap.image[offset + 1];
      png.data[idx + 2] = bitmap.image[offset];
      png.data[idx + 3] = 255;
    }
  }

  return png;
}

function paintPixel(png: PNG, x: number, y: number, color: { r: number; g: number; b: number }): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
    return;
  }

  const idx = (y * png.width + x) * 4;
  png.data[idx] = color.r;
  png.data[idx + 1] = color.g;
  png.data[idx + 2] = color.b;
  png.data[idx + 3] = 255;
}

function drawRectangle(
  png: PNG,
  detection: GuardianOfTheRiftAltarDetection,
  color: { r: number; g: number; b: number },
  thickness: number,
): void {
  for (let t = 0; t < thickness; t += 1) {
    for (let x = detection.minX + t; x <= detection.maxX - t; x += 1) {
      paintPixel(png, x, detection.minY + t, color);
      paintPixel(png, x, detection.maxY - t, color);
    }

    for (let y = detection.minY + t; y <= detection.maxY - t; y += 1) {
      paintPixel(png, detection.minX + t, y, color);
      paintPixel(png, detection.maxX - t, y, color);
    }
  }
}

export function saveBitmapWithGuardianOfTheRiftAltarDebug(
  bitmap: RobotBitmap,
  detections: GuardianOfTheRiftAltarDetection[],
  outputPath: string,
): void {
  const png = toPng(bitmap);
  detections.forEach((detection, index) => {
    drawRectangle(png, detection, index === 0 ? { r: 0, g: 255, b: 0 } : { r: 255, g: 0, b: 0 }, index === 0 ? 3 : 1);
  });

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(outputPath));
}
